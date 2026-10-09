import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import {
  IdentitySessionService,
  isChallengeResult,
} from '../src/modules/identity-session/identity-session.service';
import { SessionCookieService } from '../src/modules/identity-session/session-cookie.service';
import { SessionOriginService } from '../src/modules/identity-session/session-origin.service';
import { SessionRateLimitGuard } from '../src/modules/identity-session/session-rate-limit.guard';
import type { CacheService } from '../src/common/cache/cache.service';
import type { IdentityProviderClient } from '../src/common/security/identity-provider.client';
import type { ExecutionContext } from '@nestjs/common';

/**
 * La frontera de sesión del navegador es la única superficie del servicio que trabaja con
 * cookies ambientales, y por eso concentra tres controles que en el resto de rutas no hacen
 * falta:
 *
 *  - la cookie de refresco es `HttpOnly` y `SameSite=Strict`, y `Secure` en producción;
 *  - el `Origin` se comprueba **aparte de CORS**, porque CORS no impide que el navegador
 *    envíe la cookie: solo impide leer la respuesta;
 *  - las rutas son públicas, así que llevan su propio límite de tasa por IP — el global
 *    salta explícitamente las rutas públicas.
 *
 * Y el token de refresco nunca sale en el cuerpo: viaja solo en la cookie.
 */
const SECRET = 'una-clave-de-auditoria-de-prueba-de-32+';

describe('Frontera de sesión de navegador', () => {
  describe('SessionCookieService', () => {
    const cookies = (env: Record<string, unknown> = {}) =>
      new SessionCookieService(new ConfigService({ AUDIT_HASH_SECRET: SECRET, ...env }));

    it('marca la cookie HttpOnly, SameSite=Strict y acotada a /v1/session', () => {
      const header = cookies({ NODE_ENV: 'development' }).serialize('tok', 0);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Path=/v1/session');
    });

    it('añade Secure solo en producción', () => {
      expect(cookies({ NODE_ENV: 'production' }).serialize('tok', 0)).toContain('; Secure');
      // En desarrollo el portal corre sobre http; exigir Secure lo dejaría sin sesión.
      expect(cookies({ NODE_ENV: 'development' }).serialize('tok', 0)).not.toContain('; Secure');
    });

    it('codifica el token, para que un carácter especial no rompa la cabecera', () => {
      const header = cookies({ NODE_ENV: 'development' }).serialize('a b;c=d', 0);
      expect(header).toContain(encodeURIComponent('.a b;c=d'));
      // Un `;` sin codificar cerraría el valor y el resto se leería como atributos.
      expect(header.split(';')[0]).not.toContain(' ');
    });

    it('limpia la cookie con Max-Age=0 y los mismos atributos', () => {
      const header = cookies({ NODE_ENV: 'production' }).clear();
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('; Secure');
    });

    it('lee la cookie de entre varias, y decodifica su valor', () => {
      const service = cookies();
      const leido = service.read(`otra=1; atlas_refresh=${encodeURIComponent('a b')}; mas=2`);
      expect(leido).toBe('a b');
    });

    it('no confunde una cookie cuyo nombre solo comparte prefijo', () => {
      // `atlas_refresh_backup` no es `atlas_refresh`: leerla sería aceptar un token ajeno.
      expect(cookies().read('atlas_refresh_backup=intruso')).toBeUndefined();
    });

    it('sin cabecera, o con un valor mal codificado, devuelve indefinido en vez de romper', () => {
      expect(cookies().read(undefined)).toBeUndefined();
      expect(cookies().read('atlas_refresh=%')).toBeUndefined();
      expect(cookies().read('sin-signo-igual')).toBeUndefined();
    });

    it('respeta el nombre de cookie configurado', () => {
      const service = cookies({ IDENTITY_REFRESH_COOKIE_NAME: 'mi_cookie' });
      expect(service.serialize('t', 0).startsWith('mi_cookie=')).toBe(true);
      expect(service.read('mi_cookie=valor')).toBe('valor');
    });

    describe('inicio de sesión firmado (MOT-08)', () => {
      const leer = (service: SessionCookieService, header: string) =>
        service.readSession(header.split(';')[0]);

      it('el inicio viaja en la cookie y se recupera tal cual, con un token que lleva puntos', () => {
        const service = cookies();
        const header = service.serialize('cabecera.cuerpo.firma', 1_700_000_000_000);
        expect(leer(service, header)).toEqual({
          refreshToken: 'cabecera.cuerpo.firma',
          startedAt: 1_700_000_000_000,
        });
        // `read` sigue dando el token desnudo: el cierre de sesión lo necesita para revocarlo.
        expect(service.read(header.split(';')[0])).toBe('cabecera.cuerpo.firma');
      });

      it('adelantar el inicio invalida la firma: no se puede rejuvenecer una sesión', () => {
        const service = cookies();
        const valor = decodeURIComponent(
          service.serialize('tok', 1_000).split(';')[0].split('=')[1],
        );
        const alterado = valor.replace('v1.1000.', 'v1.9999999999999.');
        expect(service.readSession(`atlas_refresh=${encodeURIComponent(alterado)}`)).toEqual({
          refreshToken: 'tok',
          startedAt: null,
        });
      });

      it('la firma ata el inicio a SU token: no se puede trasplantar a otra sesión', () => {
        const service = cookies();
        const valor = decodeURIComponent(
          service.serialize('tok-a', 1_000).split(';')[0].split('=')[1],
        );
        const trasplantado = valor.replace(/tok-a$/, 'tok-b');
        expect(
          service.readSession(`atlas_refresh=${encodeURIComponent(trasplantado)}`)?.startedAt,
        ).toBeNull();
      });

      it('otra clave no valida la firma', () => {
        const header = cookies().serialize('tok', 1_000);
        const otra = cookies({ AUDIT_HASH_SECRET: 'otra-clave-de-auditoria-de-32-caracteres!' });
        expect(leer(otra, header)?.startedAt).toBeNull();
        const dedicada = cookies({ IDENTITY_SESSION_SIGNING_SECRET: 'x'.repeat(32) });
        expect(leer(dedicada, header)?.startedAt).toBeNull();
        expect(leer(dedicada, dedicada.serialize('tok', 1_000))?.startedAt).toBe(1_000);
      });

      it('una cookie del formato anterior no prueba su inicio', () => {
        expect(cookies().readSession('atlas_refresh=token-viejo')).toEqual({
          refreshToken: 'token-viejo',
          startedAt: null,
        });
      });

      it('sin ningún secreto no se firma: falla cerrado', () => {
        const sinClave = new SessionCookieService(new ConfigService({}));
        expect(() => sinClave.serialize('tok', 1)).toThrow();
        expect(sinClave.readSession('atlas_refresh=v1.1.mac.tok')?.startedAt).toBeNull();
      });
    });
  });

  describe('SessionOriginService', () => {
    const origins = (env: Record<string, unknown>) =>
      new SessionOriginService(new ConfigService(env));

    it('acepta un origen de la lista', () => {
      expect(() =>
        origins({ CORS_ALLOWED_ORIGINS: 'https://portal.atlas, https://otro' }).assertAllowed(
          'https://portal.atlas',
        ),
      ).not.toThrow();
    });

    it('rechaza un origen que no está en la lista', () => {
      const error = (() => {
        try {
          origins({ CORS_ALLOWED_ORIGINS: 'https://portal.atlas' }).assertAllowed('https://malo');
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('UNTRUSTED_ORIGIN');
      expect((error as DomainException).status).toBe(403);
    });

    it('en producción exige que el origen venga; fuera de producción no', () => {
      // Una petición sin `Origin` en producción es la que hace curl o un cliente que no es
      // un navegador: no debe poder usar la sesión por cookie.
      expect(() =>
        origins({ NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://p' }).assertAllowed(
          undefined,
        ),
      ).toThrow(DomainException);
      expect(() => origins({ NODE_ENV: 'development' }).assertAllowed(undefined)).not.toThrow();
    });

    it('sin lista configurada, ningún origen es de confianza', () => {
      // Fallo cerrado: una configuración vacía no puede significar «todos valen».
      expect(() => origins({ CORS_ALLOWED_ORIGINS: '' }).assertAllowed('https://p')).toThrow(
        DomainException,
      );
    });
  });

  describe('SessionRateLimitGuard', () => {
    function context(ip = '10.0.0.1', handler = 'login') {
      const response = { setHeader: jest.fn() };
      return {
        ctx: {
          switchToHttp: () => ({
            getRequest: () => ({ ip, socket: { remoteAddress: ip } }),
            getResponse: () => response,
          }),
          getHandler: () => ({ name: handler }),
        } as unknown as ExecutionContext,
        response,
      };
    }

    function guard(count: number, env: Record<string, unknown> = {}) {
      const keys: string[] = [];
      const cache = {
        consumeFixedWindow: (key: string) => {
          keys.push(key);
          return Promise.resolve({ count, ttlSeconds: 30 });
        },
      } as unknown as CacheService;
      return {
        guard: new SessionRateLimitGuard(
          new ConfigService({ IDENTITY_SESSION_RATE_LIMIT: 20, ...env }),
          cache,
        ),
        keys,
      };
    }

    it('deja pasar mientras el presupuesto alcance, y publica las cabeceras', async () => {
      const { guard: sut } = guard(5);
      const { ctx, response } = context();
      await expect(sut.canActivate(ctx)).resolves.toBe(true);
      expect(response.setHeader).toHaveBeenCalledWith('x-ratelimit-limit', '20');
      expect(response.setHeader).toHaveBeenCalledWith('x-ratelimit-remaining', '15');
    });

    it('rechaza con 429 y Retry-After al pasarse', async () => {
      const { guard: sut } = guard(21);
      const { ctx, response } = context();
      const error = await sut.canActivate(ctx).catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('RATE_LIMIT_EXCEEDED');
      expect((error as DomainException).status).toBe(429);
      expect(response.setHeader).toHaveBeenCalledWith('retry-after', '30');
    });

    it('el presupuesto es por IP y por ruta, no uno global', async () => {
      // Compartir presupuesto entre login y refresh dejaría que un intento de fuerza bruta
      // contra login echase de la aplicación a quien solo estaba renovando su sesión.
      const { guard: sut, keys } = guard(1);
      await sut.canActivate(context('1.1.1.1', 'login').ctx);
      await sut.canActivate(context('2.2.2.2', 'login').ctx);
      await sut.canActivate(context('1.1.1.1', 'refresh').ctx);
      expect(keys).toEqual([
        'identity-session:1.1.1.1:login',
        'identity-session:2.2.2.2:login',
        'identity-session:1.1.1.1:refresh',
      ]);
    });

    it('con el limitador apagado no consulta la caché siquiera', async () => {
      const { guard: sut, keys } = guard(999, { RATE_LIMIT_ENABLED: false });
      await expect(sut.canActivate(context().ctx)).resolves.toBe(true);
      expect(keys).toEqual([]);
    });
  });

  describe('IdentitySessionService', () => {
    const config = (env: Record<string, unknown> = {}) => new ConfigService(env);
    const provider = (overrides: Record<string, unknown> = {}) =>
      ({
        login: () =>
          Promise.resolve({
            refreshToken: 'secreto-de-refresco',
            accessToken: 'acceso',
            user: { id: 'u1' },
          }),
        refresh: () =>
          Promise.resolve({ refreshToken: 'nuevo', accessToken: 'acceso2', user: { id: 'u1' } }),
        logout: jest.fn(() => Promise.resolve()),
        ...overrides,
      }) as unknown as IdentityProviderClient;

    it('el token de refresco NO viaja en el cuerpo: solo en la cookie', async () => {
      const result = await new IdentitySessionService(provider(), config()).login({
        username: 'u',
        password: 'p',
      } as never);

      if (isChallengeResult(result)) throw new Error('se esperaba una sesión, no un desafío');
      expect(result.refreshToken).toBe('secreto-de-refresco');
      // Si se colara en la sesión pública, un XSS podría leerlo — que es justo lo que la
      // cookie HttpOnly evita.
      expect(JSON.stringify(result.session)).not.toContain('secreto-de-refresco');
      expect(result.session).not.toHaveProperty('refreshToken');
    });

    /*
     * El desafío de segundo factor no es una sesión a medias: no hay token de refresco que guardar,
     * y el controlador no debe emitir cookie. Antes esto ni siquiera llegaba aquí — el cliente lo
     * convertía en un 501 y la cuenta con 2FA no podía entrar al portal.
     */
    it('un desafío de PIN se devuelve como desafío, sin token de refresco', async () => {
      const challenge = {
        pinChallengeRequired: true,
        challengeToken: 'desafio-largo-de-mas-de-20', // gitleaks:allow — fixture inventado
        expiresInMinutes: 10,
      };
      const result = await new IdentitySessionService(
        provider({ login: () => Promise.resolve(challenge) }),
        config(),
      ).login({ username: 'u', password: 'p' } as never);

      expect(isChallengeResult(result)).toBe(true);
      expect(result).toEqual({ challenge });
      expect(JSON.stringify(result)).not.toContain('secreto-de-refresco');
    });

    it('el PIN correcto sí produce sesión, y el refresco sigue fuera del cuerpo', async () => {
      const service = new IdentitySessionService(
        provider({
          verifyLoginPin: () =>
            Promise.resolve({
              refreshToken: 'secreto-de-refresco',
              accessToken: 'acceso',
              user: { id: 'u1' },
            }),
        }),
        config(),
      );

      const result = await service.verifyLoginPin({
        challengeToken: 'x'.repeat(24),
        pin: '123456',
      });
      expect(result.refreshToken).toBe('secreto-de-refresco');
      expect(result.session).not.toHaveProperty('refreshToken');
    });

    it('renovar sin cookie es 401, no un 500 ni una sesión nueva', async () => {
      const error = await new IdentitySessionService(provider(), config())
        .refresh(undefined)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('UNAUTHORIZED');
      expect((error as DomainException).status).toBe(401);
    });

    describe('vida absoluta de la sesión (MOT-08)', () => {
      const HORA = 3_600_000;
      const AHORA = 1_800_000_000_000;

      class ConReloj extends IdentitySessionService {
        protected override now(): number {
          return AHORA;
        }
      }

      function servicio(env: Record<string, unknown> = {}) {
        const logout = jest.fn(() => Promise.resolve());
        const refresh = jest.fn(() =>
          Promise.resolve({ refreshToken: 'nuevo', accessToken: 'acceso2', user: { id: 'u1' } }),
        );
        return { sut: new ConReloj(provider({ logout, refresh }), config(env)), logout, refresh };
      }

      it('dentro de las 12 h renueva y CONSERVA el inicio: refrescar no rejuvenece', async () => {
        const { sut, refresh } = servicio();
        const inicio = AHORA - 11 * HORA;
        const result = await sut.refresh({ refreshToken: 'tok', startedAt: inicio });
        expect(refresh).toHaveBeenCalledWith('tok');
        expect(result.startedAt).toBe(inicio);
        expect(result.refreshToken).toBe('nuevo');
      });

      it('pasadas las 12 h es 401 SESSION_EXPIRED, no llama a refresh y revoca la sesión', async () => {
        const { sut, refresh, logout } = servicio();
        const error = await sut
          .refresh({ refreshToken: 'tok', startedAt: AHORA - 12 * HORA - 1 })
          .catch((caught: unknown) => caught);
        expect((error as DomainException).code).toBe('SESSION_EXPIRED');
        expect((error as DomainException).status).toBe(401);
        expect(refresh).not.toHaveBeenCalled();
        expect(logout).toHaveBeenCalledWith('tok', false);
      });

      it('el tope se configura por variable', async () => {
        const { sut } = servicio({ IDENTITY_SESSION_ABSOLUTE_MAX_HOURS: 2 });
        await expect(
          sut.refresh({ refreshToken: 'tok', startedAt: AHORA - 3 * HORA }),
        ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
        await expect(
          sut.refresh({ refreshToken: 'tok', startedAt: AHORA - HORA }),
        ).resolves.toMatchObject({ startedAt: AHORA - HORA });
      });

      it('una cookie sin inicio probado, o con un inicio futuro, obliga a entrar de nuevo', async () => {
        const { sut, refresh } = servicio();
        await expect(sut.refresh({ refreshToken: 'tok', startedAt: null })).rejects.toMatchObject({
          code: 'SESSION_EXPIRED',
        });
        await expect(
          sut.refresh({ refreshToken: 'tok', startedAt: AHORA + 6 * 60_000 }),
        ).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
        expect(refresh).not.toHaveBeenCalled();
      });

      it('si el proveedor falla al revocar, sigue siendo 401 y no un 5xx', async () => {
        const logout = jest.fn(() => Promise.reject(new Error('proveedor caído')));
        const sut = new ConReloj(provider({ logout }), config());
        await expect(sut.refresh({ refreshToken: 'tok', startedAt: null })).rejects.toMatchObject({
          status: 401,
        });
      });

      it('el login fija el inicio en el instante en que se entra', async () => {
        const result = await new ConReloj(provider(), config()).login({} as never);
        if (isChallengeResult(result)) throw new Error('se esperaba una sesión');
        expect(result.startedAt).toBe(AHORA);
      });
    });

    it('cerrar sesión sin cookie no llama al proveedor ni falla', async () => {
      const logout = jest.fn(() => Promise.resolve());
      await expect(
        new IdentitySessionService(provider({ logout }), config()).logout(undefined, false),
      ).resolves.toBeUndefined();
      expect(logout).not.toHaveBeenCalled();
    });

    it('cerrar sesión en todos los dispositivos se delega tal cual', async () => {
      const logout = jest.fn(() => Promise.resolve());
      await new IdentitySessionService(provider({ logout }), config()).logout('tok', true);
      expect(logout).toHaveBeenCalledWith('tok', true);
    });
  });
});

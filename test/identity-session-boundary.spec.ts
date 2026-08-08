import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { IdentitySessionService } from '../src/modules/identity-session/identity-session.service';
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
describe('Frontera de sesión de navegador', () => {
  describe('SessionCookieService', () => {
    const cookies = (env: Record<string, unknown> = {}) =>
      new SessionCookieService(new ConfigService(env));

    it('marca la cookie HttpOnly, SameSite=Strict y acotada a /v1/session', () => {
      const header = cookies({ NODE_ENV: 'development' }).serialize('tok');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Path=/v1/session');
    });

    it('añade Secure solo en producción', () => {
      expect(cookies({ NODE_ENV: 'production' }).serialize('tok')).toContain('; Secure');
      // En desarrollo el portal corre sobre http; exigir Secure lo dejaría sin sesión.
      expect(cookies({ NODE_ENV: 'development' }).serialize('tok')).not.toContain('; Secure');
    });

    it('codifica el token, para que un carácter especial no rompa la cabecera', () => {
      const header = cookies({ NODE_ENV: 'development' }).serialize('a b;c=d');
      expect(header).toContain(encodeURIComponent('a b;c=d'));
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
      expect(service.serialize('t').startsWith('mi_cookie=')).toBe(true);
      expect(service.read('mi_cookie=valor')).toBe('valor');
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
      const result = await new IdentitySessionService(provider()).login({
        username: 'u',
        password: 'p',
      } as never);

      expect(result.refreshToken).toBe('secreto-de-refresco');
      // Si se colara en la sesión pública, un XSS podría leerlo — que es justo lo que la
      // cookie HttpOnly evita.
      expect(JSON.stringify(result.session)).not.toContain('secreto-de-refresco');
      expect(result.session).not.toHaveProperty('refreshToken');
    });

    it('renovar sin cookie es 401, no un 500 ni una sesión nueva', async () => {
      const error = await new IdentitySessionService(provider())
        .refresh(undefined)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('UNAUTHORIZED');
      expect((error as DomainException).status).toBe(401);
    });

    it('cerrar sesión sin cookie no llama al proveedor ni falla', async () => {
      const logout = jest.fn(() => Promise.resolve());
      await expect(
        new IdentitySessionService(provider({ logout })).logout(undefined, false),
      ).resolves.toBeUndefined();
      expect(logout).not.toHaveBeenCalled();
    });

    it('cerrar sesión en todos los dispositivos se delega tal cual', async () => {
      const logout = jest.fn(() => Promise.resolve());
      await new IdentitySessionService(provider({ logout })).logout('tok', true);
      expect(logout).toHaveBeenCalledWith('tok', true);
    });
  });
});

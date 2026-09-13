import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CacheService } from '../src/common/cache/cache.service';
import { DomainExceptionFilter } from '../src/common/errors/domain-exception.filter';
import { IdentitySessionController } from '../src/modules/identity-session/identity-session.controller';
import { IdentitySessionService } from '../src/modules/identity-session/identity-session.service';
import { SessionCookieService } from '../src/modules/identity-session/session-cookie.service';
import { SessionOriginService } from '../src/modules/identity-session/session-origin.service';
import { SessionRateLimitGuard } from '../src/modules/identity-session/session-rate-limit.guard';

/**
 * Contrato HTTP de las seis rutas públicas de `v1/session`.
 *
 * `identity-session-boundary.spec.ts` prueba cada pieza por separado —la cookie, el origen, el
 * limitador, el servicio—. Lo que ninguna prueba afirmaba es que el CONTROLADOR las monta en cada
 * ruta: quitar un `assertAllowed` o el `@UseGuards` deja todas esas pruebas en verde y la ruta
 * abierta. Flow Intelligence las marcaba por eso como escrituras públicas sin ninguna prueba que
 * las nombre. Aquí se levanta el controlador real con la cookie, el origen y el limitador reales,
 * el mismo `ValidationPipe` y el mismo filtro de errores que `main.ts`; sólo se sustituyen el
 * proveedor de identidad (el servicio) y el almacén del limitador.
 */

const ALLOWED_ORIGIN = 'https://portal.atlas.test';
const LIMIT = 3;

/**
 * Rutas ENTERAS y no compuestas con una plantilla: el derivador de Flow Intelligence da una
 * escritura por probada cuando alguna prueba nombra su ruta literal, y `/v1/session/${'${route}'}` no
 * la nombra. Componerlas dejaba al detector diciendo la verdad —nadie nombra esa ruta— sobre un
 * archivo que sí la prueba.
 */
const ROUTES = {
  '/v1/session/login': { tenantId: '1', email: 'persona@atlas.test', password: 'una-clave' },
  '/v1/session/login/pin': { challengeToken: 'desafio-de-mas-de-veinte-caracteres', pin: '123456' },
  '/v1/session/refresh': {},
  '/v1/session/logout': { allDevices: false },
  '/v1/session/password/change/request': { currentPassword: 'la-actual' },
  '/v1/session/password/change/confirm': {
    challengeToken: 'desafio-de-mas-de-veinte-caracteres',
    code: '123456',
    newPassword: 'una-nueva-clave-larga',
  },
} as const;
type Route = keyof typeof ROUTES;

const sessionBody = { accessToken: 'acceso-de-prueba', expiresIn: 900, user: { id: '7' } };
const REFRESH = 'refresco-que-no-debe-salir-en-el-cuerpo';

function fakeSessions() {
  return {
    login: jest.fn().mockResolvedValue({ session: sessionBody, refreshToken: REFRESH }),
    verifyLoginPin: jest.fn().mockResolvedValue({ session: sessionBody, refreshToken: REFRESH }),
    refresh: jest.fn().mockResolvedValue({ session: sessionBody, refreshToken: REFRESH }),
    logout: jest.fn().mockResolvedValue(undefined),
    requestPasswordChange: jest
      .fn()
      .mockResolvedValue({ pinChallengeRequired: true, challengeToken: 'x', expiresInMinutes: 10 }),
    confirmPasswordChange: jest.fn().mockResolvedValue({ passwordChanged: true }),
  };
}

/** Ventana fija en memoria: el mismo contrato que `CacheService.consumeFixedWindow`. */
function memoryCache() {
  const counts = new Map<string, number>();
  return {
    keys: counts,
    consumeFixedWindow: (key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve({ count, ttlSeconds: 42 });
    },
  };
}

async function buildApp(
  sessions: ReturnType<typeof fakeSessions>,
  env: Record<string, unknown> = {},
) {
  const config = new ConfigService({
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    RATE_LIMIT_ENABLED: true,
    IDENTITY_SESSION_RATE_LIMIT: LIMIT,
    ...env,
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [IdentitySessionController],
    providers: [
      SessionCookieService,
      SessionOriginService,
      SessionRateLimitGuard,
      { provide: ConfigService, useValue: config },
      { provide: CacheService, useValue: memoryCache() },
      { provide: IdentitySessionService, useValue: sessions },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter(config));
  await app.init();
  return app;
}

function post(app: INestApplication, route: Route) {
  return request(app.getHttpServer()).post(route);
}

const serviceMethod: Record<Route, keyof ReturnType<typeof fakeSessions>> = {
  '/v1/session/login': 'login',
  '/v1/session/login/pin': 'verifyLoginPin',
  '/v1/session/refresh': 'refresh',
  '/v1/session/logout': 'logout',
  '/v1/session/password/change/request': 'requestPasswordChange',
  '/v1/session/password/change/confirm': 'confirmPasswordChange',
};

describe('Contrato HTTP de v1/session', () => {
  let app: INestApplication;
  let sessions: ReturnType<typeof fakeSessions>;

  beforeEach(async () => {
    sessions = fakeSessions();
    app = await buildApp(sessions);
  });

  afterEach(async () => {
    await app.close();
  });

  const routes = Object.keys(ROUTES) as Route[];

  it.each(routes)('POST /%s con un origen de la lista se atiende sin token', async (route) => {
    const response = await post(app, route).set('Origin', ALLOWED_ORIGIN).send(ROUTES[route]);
    expect(response.status).toBe(200);
    expect(sessions[serviceMethod[route]]).toHaveBeenCalledTimes(1);
  });

  it.each(routes)(
    'POST /%s con un origen ajeno es 403 UNTRUSTED_ORIGIN y no llega al proveedor',
    async (route) => {
      const response = await post(app, route)
        .set('Origin', 'https://phishing.example')
        .send(ROUTES[route]);
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('UNTRUSTED_ORIGIN');
      expect(sessions[serviceMethod[route]]).not.toHaveBeenCalled();
    },
  );

  it.each(routes)(
    'POST /%s tiene su propio presupuesto: pasado el tope es 429 con Retry-After',
    async (route) => {
      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await post(app, route).set('Origin', ALLOWED_ORIGIN).send(ROUTES[route]).expect(200);
      }
      const blocked = await post(app, route).set('Origin', ALLOWED_ORIGIN).send(ROUTES[route]);

      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blocked.headers['retry-after']).toBe('42');
      expect(sessions[serviceMethod[route]]).toHaveBeenCalledTimes(LIMIT);
    },
  );

  it('agotar el login no bloquea el refresco: el presupuesto es por ruta', async () => {
    for (let attempt = 0; attempt <= LIMIT; attempt += 1) {
      await post(app, '/v1/session/login')
        .set('Origin', ALLOWED_ORIGIN)
        .send(ROUTES['/v1/session/login']);
    }
    await post(app, '/v1/session/refresh').set('Origin', ALLOWED_ORIGIN).send({}).expect(200);
  });

  it.each([
    [
      '/v1/session/login',
      'un campo que el contrato no declara',
      { ...ROUTES['/v1/session/login'], role: 'PLATFORM_ADMIN' },
    ],
    [
      '/v1/session/login',
      'un tenant que no es un id',
      { ...ROUTES['/v1/session/login'], tenantId: 'uno' },
    ],
    [
      '/v1/session/login',
      'un correo inválido',
      { tenantId: '1', email: 'no-es-correo', password: 'x' },
    ],
    [
      '/v1/session/login/pin',
      'un PIN que no son seis dígitos',
      { ...ROUTES['/v1/session/login/pin'], pin: '12345a' },
    ],
    [
      '/v1/session/login/pin',
      'un desafío demasiado corto',
      { ...ROUTES['/v1/session/login/pin'], challengeToken: 'corto' },
    ],
  ] as [Route, string, object][])(
    'POST /%s rechaza con 400 %s, sin llamar al proveedor',
    async (route, _motivo, body) => {
      const response = await post(app, route).set('Origin', ALLOWED_ORIGIN).send(body);
      expect(response.status).toBe(400);
      expect(sessions[serviceMethod[route]]).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it.each(['/v1/session/login', '/v1/session/login/pin', '/v1/session/refresh'] as const)(
    'POST /%s deja el refresco SOLO en una cookie HttpOnly, SameSite=Strict y acotada a /v1/session',
    async (route) => {
      const response = await post(app, route)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Cookie', `atlas_refresh=${encodeURIComponent('refresco-previo')}`)
        .send(ROUTES[route]);

      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/v1/session');
      expect(cookie).not.toContain('Secure');
      expect(JSON.stringify(response.body)).not.toContain(REFRESH);
      expect(response.body).toEqual(sessionBody);
    },
  );

  it('refresh usa el valor de la cookie, no el cuerpo', async () => {
    await post(app, '/v1/session/refresh')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', 'otra=1; atlas_refresh=el-de-la-cookie')
      .send({})
      .expect(200);
    expect(sessions.refresh).toHaveBeenCalledWith('el-de-la-cookie');
  });

  it('un desafío de PIN no emite cookie', async () => {
    const challenge = {
      pinChallengeRequired: true,
      challengeToken: 'desafio',
      expiresInMinutes: 10,
    };
    sessions.login.mockResolvedValueOnce({ challenge });

    const response = await post(app, '/v1/session/login')
      .set('Origin', ALLOWED_ORIGIN)
      .send(ROUTES['/v1/session/login']);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(challenge);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('un 401 del proveedor es 401 y no emite cookie', async () => {
    sessions.login.mockRejectedValueOnce(new UnauthorizedException('Credenciales inválidas'));
    const response = await post(app, '/v1/session/login')
      .set('Origin', ALLOWED_ORIGIN)
      .send(ROUTES['/v1/session/login']);
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('logout borra la cookie AUNQUE el proveedor falle', async () => {
    sessions.logout.mockRejectedValueOnce(new Error('proveedor caído'));
    const response = await post(app, '/v1/session/logout')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Cookie', 'atlas_refresh=a-revocar')
      .send({ allDevices: true });

    expect(response.status).toBe(500);
    expect(String(response.headers['set-cookie'])).toMatch(/^atlas_refresh=;.*Max-Age=0/);
    expect(sessions.logout).toHaveBeenCalledWith('a-revocar', true);
  });

  it('confirmar el cambio de contraseña borra la cookie: el proveedor revoca todas las sesiones', async () => {
    const response = await post(app, '/v1/session/password/change/confirm')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Authorization', 'Bearer token-del-actor')
      .send(ROUTES['/v1/session/password/change/confirm']);

    expect(response.status).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
    expect(sessions.confirmPasswordChange).toHaveBeenCalledWith(
      'token-del-actor',
      expect.objectContaining({ code: '123456' }),
    );
  });

  it('el cambio de contraseña sólo toma el actor de Authorization: Bearer', async () => {
    await post(app, '/v1/session/password/change/request')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Authorization', 'Basic dXN1YXJpbzpjbGF2ZQ==')
      .send(ROUTES['/v1/session/password/change/request'])
      .expect(200);
    expect(sessions.requestPasswordChange).toHaveBeenCalledWith(undefined, 'la-actual');
  });
});

describe('v1/session en producción', () => {
  it('sin cabecera Origin se rechaza (fuera de producción se admite, para curl y pruebas)', async () => {
    const sessions = fakeSessions();
    const app = await buildApp(sessions, { NODE_ENV: 'production' });
    try {
      const response = await post(app, '/v1/session/login').send(ROUTES['/v1/session/login']);
      expect(response.status).toBe(403);
      expect(sessions.login).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('la cookie de refresco lleva Secure', async () => {
    const sessions = fakeSessions();
    const app = await buildApp(sessions, { NODE_ENV: 'production' });
    try {
      const response = await post(app, '/v1/session/login')
        .set('Origin', ALLOWED_ORIGIN)
        .send(ROUTES['/v1/session/login']);
      expect(String(response.headers['set-cookie'])).toContain('Secure');
    } finally {
      await app.close();
    }
  });
});

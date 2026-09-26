/**
 * Frontera de autenticación: lo que ocurre ANTES de mirar ningún rol.
 *
 * Se corre una sola vez por tanda, con identidades que no son ninguno de los tres usuarios:
 * sin credencial, con una clave inventada, con la audiencia equivocada y pidiendo un tenant
 * ajeno. Son los cuatro caminos por los que un llamante intentaría entrar sin ser nadie, y
 * ninguno puede devolver datos.
 */
import { request } from '../lib/http.mjs';
import { evaluate } from '../lib/report.mjs';
import { anonymousPrincipal, invalidKeyPrincipal, runtimePrincipal } from '../lib/principals.mjs';
import { config } from '../lib/config.mjs';

/** Rutas representativas de cada audiencia y de la superficie pública. */
const PROTECTED = [
  { id: 'artifacts', method: 'GET', path: '/v1/artifacts?pageSize=1' },
  { id: 'audit-chain', method: 'GET', path: '/v1/audit/chain/verify' },
  { id: 'deployments', method: 'GET', path: '/v1/deployments?pageSize=1' },
  { id: 'workers', method: 'GET', path: '/v1/workers' },
];

export async function run({ reporter, state }) {
  reporter.startPhase('frontera de autenticación');

  // --- Sin credencial ninguna. -------------------------------------------------------
  for (const route of PROTECTED) {
    const response = await request({ ...route, auth: anonymousPrincipal() });
    evaluate(reporter, {
      id: `access.anonymous.${route.id}`,
      title: `${route.method} ${route.path} sin credencial`,
      expect: { status: 401, errorCode: 'UNAUTHORIZED' },
      response,
    });
  }

  // --- Con una clave que no existe. --------------------------------------------------
  for (const route of PROTECTED) {
    const response = await request({ ...route, auth: invalidKeyPrincipal() });
    evaluate(reporter, {
      id: `access.invalid-key.${route.id}`,
      title: `${route.method} ${route.path} con una clave inventada`,
      // El motor devuelve el MISMO 401 opaco para clave desconocida, revocada o de otra
      // audiencia: distinguirlas le diría al llamante cuál de las tres cosas acertó.
      expect: { statusIn: [401, 429], errorCode: ['UNAUTHORIZED', 'AUTH_RATE_LIMIT_EXCEEDED'] },
      response,
    });
  }

  // --- Credencial de tiempo de ejecución contra rutas de gestión. --------------------
  const runtime = runtimePrincipal();
  for (const route of PROTECTED) {
    const response = await request({ ...route, auth: runtime });
    evaluate(reporter, {
      id: `access.wrong-audience.${route.id}`,
      title: `${route.method} ${route.path} con credencial de audiencia runtime`,
      expect: { statusIn: [401, 403], errorCode: ['UNAUTHORIZED', 'FORBIDDEN'] },
      response,
    });
  }

  // --- Credencial de gestión contra la ruta de ejecución. ---------------------------
  const artifactCode = state.lifecycle?.artifactCode ?? 'SMOKE_ARTEFACTO_FANTASMA';
  const managementOnRuntime = await request({
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    auth: invalidKeyPrincipal(),
    body: {
      requestId: 'smoke-audience-check',
      idempotencyKey: 'smoke-audience-check',
      variables: { age: 30 },
    },
  });
  evaluate(reporter, {
    id: 'access.wrong-audience.decisions',
    title: 'POST /v1/decisions con una credencial que no es de runtime',
    expect: { statusIn: [401, 403, 429], errorCode: ['UNAUTHORIZED', 'FORBIDDEN', 'AUTH_RATE_LIMIT_EXCEEDED'] },
    response: managementOnRuntime,
  });

  // --- Tenant ajeno con una credencial válida. --------------------------------------
  const foreignTenant = await request({
    method: 'GET',
    path: '/v1/artifacts?pageSize=1',
    auth: { ...runtime, headers: { ...runtime.headers, 'x-tenant-id': '999999' } },
  });
  evaluate(reporter, {
    id: 'access.foreign-tenant.artifacts',
    title: 'GET /v1/artifacts pidiendo un tenant para el que la credencial no está autorizada',
    expect: { statusIn: [401, 403], errorCode: ['FORBIDDEN_TENANT', 'UNAUTHORIZED', 'FORBIDDEN'] },
    response: foreignTenant,
  });

  const malformedTenant = await request({
    method: 'GET',
    path: '/v1/artifacts?pageSize=1',
    auth: { ...runtime, headers: { ...runtime.headers, 'x-tenant-id': 'no-es-un-tenant' } },
  });
  evaluate(reporter, {
    id: 'access.malformed-tenant.artifacts',
    title: 'GET /v1/artifacts con un identificador de tenant mal formado',
    expect: { statusIn: [401, 403], errorCode: ['INVALID_SECURITY_CONTEXT', 'UNAUTHORIZED'] },
    response: malformedTenant,
  });

  // --- Cabecera Authorization mal formada. ------------------------------------------
  const malformedBearer = await request({
    method: 'GET',
    path: '/v1/artifacts?pageSize=1',
    headers: { authorization: 'Bearer', 'x-tenant-id': config.tenantId },
  });
  evaluate(reporter, {
    id: 'access.malformed-bearer.artifacts',
    title: 'GET /v1/artifacts con una cabecera Authorization mal formada',
    expect: { statusIn: [401, 429], errorCode: ['UNAUTHORIZED', 'AUTH_RATE_LIMIT_EXCEEDED'] },
    response: malformedBearer,
  });

  // --- Ruta inexistente: debe ser un 404 catalogado, no un 500. ---------------------
  const unknownRoute = await request({
    method: 'GET',
    path: '/v1/esta-ruta-no-existe',
    auth: runtime,
  });
  evaluate(reporter, {
    id: 'access.unknown-route',
    title: 'GET de una ruta inexistente responde un 404 catalogado',
    expect: { statusIn: [401, 404], errorCode: ['HTTP_404', 'UNAUTHORIZED'] },
    response: unknownRoute,
  });
}

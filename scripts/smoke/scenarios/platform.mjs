/**
 * Superficie transversal: sondas públicas, sesión de portal, catálogos de formulario,
 * buscador, tutoriales y bandeja de notificaciones.
 *
 * Todos los tipos de usuario la recorren entera. Las rutas con `@Roles(...PLATFORM_ROLES)`
 * las alcanza cualquier rol de plataforma, así que aquí no hay denegaciones esperadas: lo
 * que se comprueba es que respondan y que rechacen la entrada mal formada.
 */
import { assert } from '../lib/report.mjs';
import { config } from '../lib/config.mjs';
import * as fixture from '../lib/fixtures.mjs';

const PLATFORM_ROLES = [
  'PLATFORM_ADMIN',
  'RISK_ANALYST',
  'FRAUD_ANALYST',
  'QA_ANALYST',
  'RISK_APPROVER',
  'COMPLIANCE',
  'AUDITOR',
  'OPERATIONS',
];

const READ_ROLES = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN', 'OPERATIONS'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('plataforma');

  // --- Sondas públicas: sin credencial y sin límite de tasa. -------------------------
  for (const [id, path] of [
    ['health', '/health'],
    ['health-live', '/health/live'],
    ['health-ready', '/health/ready'],
    ['ready', '/ready'],
  ]) {
    await probe.ok({
      id,
      title: `GET ${path} responde`,
      method: 'GET',
      path,
      roles: [],
      expect: {
        // /health/ready responde 503 cuando una dependencia está caída: sigue siendo una
        // respuesta correcta de la sonda, y confundirla con un fallo del smoke ocultaría
        // cuál de las dos cosas está rota.
        statusIn: path.includes('ready') ? [200, 503] : [200],
      },
    });
  }

  // --- Sesión de portal. Es pública y valida su propia entrada. ----------------------
  await probe.invalid({
    id: 'session-login',
    case: 'malformed-email',
    title: 'POST /v1/session/login rechaza un correo mal formado',
    method: 'POST',
    path: '/v1/session/login',
    roles: [],
    headers: config.sessionOrigin ? { origin: config.sessionOrigin } : {},
    body: { tenantId: config.tenantId, email: 'no-es-un-correo', password: 'x' },
    expect: { statusIn: [400, 403], errorCode: ['HTTP_400', 'UNTRUSTED_ORIGIN'] },
  });

  await probe.invalid({
    id: 'session-login',
    case: 'missing-password',
    title: 'POST /v1/session/login exige contraseña',
    method: 'POST',
    path: '/v1/session/login',
    roles: [],
    headers: config.sessionOrigin ? { origin: config.sessionOrigin } : {},
    body: { tenantId: config.tenantId, email: 'smoke@atlas.local' },
    expect: { statusIn: [400, 403], errorCode: ['HTTP_400', 'UNTRUSTED_ORIGIN'] },
  });

  await probe.invalid({
    id: 'session-refresh',
    case: 'no-cookie',
    title: 'POST /v1/session/refresh sin cookie no renueva nada',
    method: 'POST',
    path: '/v1/session/refresh',
    roles: [],
    headers: config.sessionOrigin ? { origin: config.sessionOrigin } : {},
    expect: { statusIn: [401, 403], errorCode: ['UNAUTHORIZED', 'UNTRUSTED_ORIGIN'] },
  });

  await probe.ok({
    id: 'session-logout',
    title: 'POST /v1/session/logout sin sesión es idempotente',
    method: 'POST',
    path: '/v1/session/logout',
    roles: [],
    headers: config.sessionOrigin ? { origin: config.sessionOrigin } : {},
    body: { allDevices: false },
    expect: { statusIn: [200, 403] },
  });

  // --- Selectores y catálogos del portal. -------------------------------------------
  await probe.ok({
    id: 'views-pickers-artifacts',
    title: 'GET /v1/views/pickers/artifacts',
    path: '/v1/views/pickers/artifacts',
    roles: READ_ROLES,
  });

  await probe.ok({
    id: 'views-pickers-artifact-versions',
    title: 'GET /v1/views/pickers/artifact-versions',
    path: '/v1/views/pickers/artifact-versions',
    roles: READ_ROLES,
  });

  await probe.ok({
    id: 'views-pickers-variables',
    title: 'GET /v1/views/pickers/variables',
    path: '/v1/views/pickers/variables?search=age',
    roles: READ_ROLES,
  });

  await probe.ok({
    id: 'views-options',
    title: 'GET /v1/views/options sirve un grupo del catálogo',
    path: '/v1/views/options?group=artifactType',
    roles: READ_ROLES,
  });

  await probe.invalid({
    id: 'views-options',
    case: 'unknown-group',
    title: 'GET /v1/views/options rechaza un grupo inexistente',
    path: '/v1/views/options?group=grupo_inexistente',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'views-options',
    case: 'missing-group',
    title: 'GET /v1/views/options exige el grupo',
    path: '/v1/views/options',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.ok({
    id: 'views-pickers-test-suites',
    title: 'GET /v1/views/pickers/test-suites',
    path: '/v1/views/pickers/test-suites',
    roles: READ_ROLES,
  });

  await probe.ok({
    id: 'views-pickers-test-runs',
    title: 'GET /v1/views/pickers/test-runs',
    path: '/v1/views/pickers/test-runs',
    roles: READ_ROLES,
  });

  await probe.invalid({
    id: 'views-scripts',
    case: 'missing-version',
    title: 'GET /v1/views/scripts exige la versión',
    path: '/v1/views/scripts',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'views-artifact-inputs',
    case: 'missing-artifact-code',
    title: 'GET /v1/views/artifact-inputs exige el código de artefacto',
    path: '/v1/views/artifact-inputs',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.ok({
    id: 'views-search',
    title: 'GET /v1/views/search busca en el catálogo',
    path: '/v1/views/search?q=credit&limit=5',
    roles: READ_ROLES,
  });

  await probe.invalid({
    id: 'views-search',
    case: 'query-too-short',
    title: 'GET /v1/views/search rechaza una consulta de una letra',
    path: '/v1/views/search?q=a',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'views-search',
    case: 'limit-out-of-range',
    title: 'GET /v1/views/search acota el límite',
    path: '/v1/views/search?q=credit&limit=500',
    roles: READ_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Tutoriales: cualquier rol de plataforma. --------------------------------------
  await probe.ok({
    id: 'tutorial-progress-list',
    title: 'GET /v1/tutorial-progress',
    path: '/v1/tutorial-progress',
    roles: PLATFORM_ROLES,
  });

  const tutorialId = `smoke-${fixture.RUN}`;
  await probe.ok({
    id: 'tutorial-progress-upsert',
    title: 'PUT /v1/tutorial-progress/:tutorialId guarda el avance',
    method: 'PUT',
    path: `/v1/tutorial-progress/${tutorialId}`,
    roles: PLATFORM_ROLES,
    body: fixture.tutorialProgress(),
  });

  await probe.invalid({
    id: 'tutorial-progress-upsert',
    case: 'unknown-status',
    title: 'PUT /v1/tutorial-progress rechaza un estado fuera del catálogo',
    method: 'PUT',
    path: `/v1/tutorial-progress/${tutorialId}`,
    roles: PLATFORM_ROLES,
    body: { status: 'INVENTADO' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'tutorial-progress-upsert',
    case: 'negative-step',
    title: 'PUT /v1/tutorial-progress rechaza un paso negativo',
    method: 'PUT',
    path: `/v1/tutorial-progress/${tutorialId}`,
    roles: PLATFORM_ROLES,
    body: { status: 'STARTED', lastStep: -1 },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Bandeja de notificaciones: paginada por cursor desde el primer día. -----------
  await probe.ok({
    id: 'notifications-list',
    title: 'GET /v1/notifications lista la bandeja',
    path: '/v1/notifications?pageSize=10',
    roles: PLATFORM_ROLES,
  });

  await probe.ok({
    id: 'notifications-unread-count',
    title: 'GET /v1/notifications/unread-count',
    path: '/v1/notifications/unread-count',
    roles: PLATFORM_ROLES,
  });

  await probe.invalid({
    id: 'notifications-list',
    case: 'bad-cursor',
    title: 'GET /v1/notifications rechaza un cursor corrupto',
    path: '/v1/notifications?cursor=%21%21no-es-un-cursor%21%21',
    roles: PLATFORM_ROLES,
    expect: { statusIn: [400], errorCode: ['INVALID_CURSOR', 'HTTP_400'] },
  });

  await probe.invalid({
    id: 'notifications-list',
    case: 'unread-only-not-boolean',
    title: 'GET /v1/notifications exige true/false en unreadOnly',
    path: '/v1/notifications?unreadOnly=quizas',
    roles: PLATFORM_ROLES,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // Marcar como leída, vaciar la bandeja y leer la ejecución auditada se comprueban en la
  // SEGUNDA pasada (`scenarios/inbox.mjs`): antes de que la tanda envíe a revisión, apruebe
  // y publique, no hay nada que leer, y preguntar por una bandeja vacía no comprueba nada.

  // --- Ambientes: el smoke necesita saber contra cuál puede desplegar y simular. -----
  const environments = await probe.ok({
    id: 'environments',
    title: 'GET /v1/environments lista los ambientes activos',
    path: '/v1/environments',
    roles: ['PLATFORM_ADMIN', 'RISK_ANALYST', 'QA_ANALYST', 'AUDITOR'],
    expect: {
      assert: (body) => assert(Array.isArray(body) || Array.isArray(body?.items), 'se esperaba una colección de ambientes'),
    },
  });

  if (environments.allowed && environments.response.ok) {
    const list = Array.isArray(environments.response.body)
      ? environments.response.body
      : (environments.response.body?.items ?? []);
    const codes = list.map((item) => item.environmentCode ?? item.code).filter(Boolean);
    if (codes.length) {
      state.environmentCodes = codes;
      // Nunca PROD: el smoke no ejecuta contra producción ni por accidente.
      state.environmentCode = codes.includes(config.environmentCode)
        ? config.environmentCode
        : (codes.find((code) => code !== 'PROD') ?? codes[0]);
    }
  }
}

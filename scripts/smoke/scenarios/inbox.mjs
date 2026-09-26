/**
 * Bandeja de notificaciones y evidencia de ejecución.
 *
 * Va aparte y al final porque **depende de que la tanda ya haya ocurrido**. Las
 * notificaciones no se inventan: las proyecta el relay a partir de los eventos de gobierno,
 * y cada una tiene su destinatario natural —el envío a revisión avisa a los roles
 * revisores, la aprobación avisa al autor, la publicación avisa a operaciones—. Preguntar
 * por la bandeja antes de que nada de eso pase no comprueba nada; preguntarlo después
 * comprueba la proyección entera.
 *
 * Lo mismo con la ejecución auditada: sólo existe cuando el operador ya desplegó y el
 * cliente de tiempo de ejecución ya decidió.
 */
import { assert } from '../lib/report.mjs';
import { items, pollUntil } from '../lib/http.mjs';

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
const AUDIT = ['AUDITOR', 'COMPLIANCE', 'RISK_ANALYST', 'OPERATIONS'];
const MANUAL_REVIEW = ['OPERATIONS', 'RISK_ANALYST', 'FRAUD_ANALYST'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('bandeja y evidencia');

  // El relay proyecta desde el outbox, así que la notificación llega poco después del
  // evento, no en el mismo instante. Se espera con tope: si nunca llega, el defecto está en
  // la proyección y hay que verlo, no esperarlo indefinidamente.
  const polled = await pollUntil(
    () => probe.send({ path: '/v1/notifications?pageSize=10' }),
    (response) => ({
      finished: response.ok && (response.body?.items ?? []).length > 0,
      seen: (response.body?.items ?? []).length,
    }),
    { timeoutMs: 30_000, intervalMs: 1_000 },
  );

  await probe.ok({
    id: 'notifications-list',
    title: 'GET /v1/notifications trae lo que la tanda generó',
    path: '/v1/notifications?pageSize=10',
    roles: PLATFORM_ROLES,
    expect: {
      assert: (body) =>
        assert(
          (body?.items ?? []).length > 0,
          'la tanda envió a revisión, aprobó y publicó una versión: la bandeja de este rol no puede estar vacía',
        ),
    },
  });

  // Se relee la bandeja en vez de reutilizar la del sondeo: entre una y otra el relay pudo
  // proyectar más, y marcar como leída exige un identificador que exista de verdad.
  const inbox = await probe.send({ path: '/v1/notifications?pageSize=10' });
  const notificationId = inbox.body?.items?.[0]?.id;
  await probe.ok({
    id: 'notifications-read',
    title: 'POST /v1/notifications/:id/read marca una como leída',
    method: 'POST',
    path: `/v1/notifications/${notificationId ?? '9007199254740991'}/read`,
    roles: PLATFORM_ROLES,
    expect: { status: 200 },
  });

  await probe.ok({
    id: 'notifications-unread-count',
    title: 'GET /v1/notifications/unread-count tras marcar una',
    path: '/v1/notifications/unread-count',
    roles: PLATFORM_ROLES,
  });

  await probe.ok({
    id: 'notifications-read-all',
    title: 'POST /v1/notifications/read-all vacía la bandeja',
    method: 'POST',
    path: '/v1/notifications/read-all',
    roles: PLATFORM_ROLES,
    expect: { status: 200 },
  });

  // --- Evidencia de la ejecución que dejó el cliente de tiempo de ejecución. ----------
  await probe.ok({
    id: 'audit-executions-get',
    title: 'GET /v1/audit/executions/:executionId con su evidencia',
    path: `/v1/audit/executions/${state.executionId ?? '0'}`,
    roles: AUDIT,
    expect: {
      assert: (body) => assert(body?.id, 'la ejecución auditada debe traer su identificador'),
    },
  });

  await probe.ok({
    id: 'audit-executions-search',
    title: 'GET /v1/audit/executions filtrada por el artefacto de la tanda',
    path: `/v1/audit/executions?artifactCode=${encodeURIComponent(state.lifecycle?.artifactCode ?? '')}&pageSize=10`,
    roles: AUDIT,
    expect: {
      assert: (body) =>
        assert(
          (body?.items ?? []).length > 0,
          'la decisión ejecutada en esta tanda debe aparecer en la búsqueda de ejecuciones',
        ),
    },
  });

  // La cadena debe seguir siendo válida DESPUÉS de que la tanda escribiera en ella: es la
  // comprobación que de verdad prueba el encadenado por hash, no la del principio.
  await probe.ok({
    id: 'audit-chain-verify-after',
    title: 'GET /v1/audit/chain/verify sigue válida tras escribir la tanda',
    path: '/v1/audit/chain/verify',
    roles: AUDIT,
    expect: {
      assert: (body) =>
        assert(body?.valid === true, `la cadena quedó inválida: ${JSON.stringify(body?.invalid ?? body)}`),
    },
  });

  await manualReview({ probe, reporter, state });
}

/**
 * Ciclo de un caso de revisión manual: aparece, se asigna y se resuelve.
 *
 * El caso lo creó el motor al ejecutar el camino intermedio del grafo; por API no hay forma
 * de abrir uno, y por eso esto no puede correr antes de que la decisión se haya ejecutado.
 * La resolución sólo la acepta el MISMO principal al que se asignó, así que asignar y
 * resolver van juntos y en ese orden.
 */
async function manualReview({ probe, reporter, state }) {
  reporter.startPhase('revisión manual');

  const list = await probe.ok({
    id: 'manual-reviews-list',
    title: 'GET /v1/manual-reviews trae el caso que abrió la decisión',
    path: '/v1/manual-reviews?status=OPEN&pageSize=25',
    roles: MANUAL_REVIEW,
    expect: {
      assert: (body) =>
        assert(
          items(body).length > 0,
          'la tanda ejecutó el camino de revisión manual: debe existir al menos un caso abierto',
        ),
    },
  });

  // Cada usuario resuelve un caso DISTINTO: el que ya resolvió otro está cerrado, y volver
  // sobre él mediría el cierre en vez del ciclo.
  const open = list.response.ok ? items(list.response.body) : [];
  const target = open[0];

  if (!target) {
    // Sin caso no hay ciclo que recorrer, y decirlo aquí es más útil que dejar cuatro
    // comprobaciones fallando por separado con el mismo motivo.
    reporter.record({
      id: 'inbox.manual-reviews-lifecycle.valid',
      title: 'existe un caso de revisión manual sobre el que operar',
      expected: 'al menos un caso OPEN creado por la decisión de la tanda',
      outcome: probe.reaches(MANUAL_REVIEW) ? 'FAIL' : 'PASS',
      reason: probe.reaches(MANUAL_REVIEW)
        ? 'la decisión con edad 19 debió abrir un caso y la cola está vacía'
        : 'este rol no alcanza la cola; el ciclo lo recorre otro usuario y su 403 ya quedó registrado',
    });
    return;
  }

  await probe.ok({
    id: 'manual-reviews-get',
    title: 'GET /v1/manual-reviews/:caseId',
    path: `/v1/manual-reviews/${target.id}`,
    roles: MANUAL_REVIEW,
  });

  // Resolver antes de asignar debe fallar: es la segregación de funciones del caso.
  await probe.invalid({
    id: 'manual-reviews-resolve',
    case: 'not-assigned',
    title: 'POST /resolve sobre un caso sin asignar es rechazado',
    method: 'POST',
    path: `/v1/manual-reviews/${target.id}/resolve`,
    roles: MANUAL_REVIEW,
    body: { decision: 'APPROVE', reason: 'Sin asignar a propósito.' },
    expect: {
      statusIn: [403, 409],
      errorCode: ['MANUAL_REVIEW_NOT_ASSIGNED', 'MANUAL_REVIEW_ASSIGNEE_MISMATCH', 'MANUAL_REVIEW_CLOSED'],
    },
  });

  await probe.invalid({
    id: 'manual-reviews-assign',
    case: 'missing-assignee',
    title: 'POST /assign exige a quién se asigna',
    method: 'POST',
    path: `/v1/manual-reviews/${target.id}/assign`,
    roles: MANUAL_REVIEW,
    body: {},
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // Se asigna al propio principal porque sólo él podrá resolverlo: el motor exige que
  // quien resuelve sea exactamente el asignado.
  const assignee = probe.principalId;
  const assigned = await probe.ok({
    id: 'manual-reviews-assign',
    title: 'POST /assign toma el caso',
    method: 'POST',
    path: `/v1/manual-reviews/${target.id}/assign`,
    roles: MANUAL_REVIEW,
    body: { assignedTo: assignee },
  });

  if (assigned.allowed && assigned.response.ok) {
    await probe.invalid({
      id: 'manual-reviews-resolve',
      case: 'unknown-decision-on-real-case',
      title: 'POST /resolve rechaza una decisión fuera del catálogo sobre un caso real',
      method: 'POST',
      path: `/v1/manual-reviews/${target.id}/resolve`,
      roles: MANUAL_REVIEW,
      body: { decision: 'QUIZAS', reason: 'x' },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.ok({
      id: 'manual-reviews-resolve',
      title: 'POST /resolve cierra el caso',
      method: 'POST',
      path: `/v1/manual-reviews/${target.id}/resolve`,
      roles: MANUAL_REVIEW,
      body: { decision: 'APPROVE', reason: 'Resuelto por el smoke integral.' },
    });

    // Un caso ya resuelto no se puede volver a resolver.
    await probe.invalid({
      id: 'manual-reviews-resolve',
      case: 'already-closed',
      title: 'POST /resolve sobre un caso ya cerrado es rechazado',
      method: 'POST',
      path: `/v1/manual-reviews/${target.id}/resolve`,
      roles: MANUAL_REVIEW,
      body: { decision: 'APPROVE', reason: 'Otra vez.' },
      expect: {
        statusIn: [403, 409],
        errorCode: ['MANUAL_REVIEW_CLOSED', 'MANUAL_REVIEW_NOT_ASSIGNED', 'MANUAL_REVIEW_ASSIGNEE_MISMATCH'],
      },
    });
  }
}

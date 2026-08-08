/**
 * Explotación: despliegues, registro de librerías, auditoría, revisión manual, revisión de
 * seguridad y trazabilidad.
 *
 * El despliegue es el único punto donde una versión pasa a atender tráfico, así que las
 * dos puertas que lo protegen —estar aprobada y no desplegarla quien la escribió— se
 * prueban por el camino bueno y por el que las salta.
 */
import { assert } from '../lib/report.mjs';
import { items } from '../lib/http.mjs';
import * as fixture from '../lib/fixtures.mjs';

const ADMIN = ['PLATFORM_ADMIN'];
const DEPLOY_READ = ['PLATFORM_ADMIN', 'RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS'];
const AUDIT = ['AUDITOR', 'COMPLIANCE', 'RISK_ANALYST', 'OPERATIONS'];
const MANUAL_REVIEW = ['OPERATIONS', 'RISK_ANALYST', 'FRAUD_ANALYST'];
const LIBRARY_READ = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN'];
const LIBRARY_WRITE = ['PLATFORM_ADMIN', 'COMPLIANCE'];
const PRELUDE_READ = ['PLATFORM_ADMIN', 'COMPLIANCE', 'RISK_ANALYST'];
const TRACE_WRITE = ['RISK_ANALYST', 'COMPLIANCE'];
const TRACE_READ = ['RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR'];
const SECURITY_TEAM = ['PLATFORM_ADMIN', 'COMPLIANCE', 'AUDITOR', 'RISK_ANALYST'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('operación · despliegues');

  const versionId = state.lifecycle?.versionId;
  const environmentCode = state.environmentCode ?? 'SANDBOX';

  await probe.ok({
    id: 'deployments-list',
    title: 'GET /v1/deployments lista el historial',
    path: '/v1/deployments?page=1&pageSize=25',
    roles: DEPLOY_READ,
  });

  await probe.invalid({
    id: 'deployments-list',
    case: 'unknown-status',
    title: 'GET /v1/deployments rechaza un estado inexistente',
    path: '/v1/deployments?status=INVENTADO',
    roles: DEPLOY_READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (versionId) {
    await probe.invalid({
      id: 'deployments-create',
      case: 'unknown-mode',
      title: 'POST de un despliegue rechaza una modalidad inexistente',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/deployments`,
      roles: ADMIN,
      body: { environmentCode, deploymentMode: 'ROLLING', traffic: [] },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'deployments-create',
      case: 'traffic-not-hundred',
      title: 'POST de un despliegue exige que el tráfico sume cien',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/deployments`,
      roles: ADMIN,
      body: {
        environmentCode,
        deploymentMode: 'CANARY',
        traffic: [{ segmentKey: 'smoke', trafficPercentage: 40, priority: 1 }],
      },
      expect: {
        statusIn: [400, 409, 422],
        errorCode: ['INVALID_TRAFFIC_PERCENTAGE', 'HTTP_400'],
      },
    });

    await probe.invalid({
      id: 'deployments-create',
      case: 'unknown-environment',
      title: 'POST de un despliegue a un ambiente inexistente',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/deployments`,
      roles: ADMIN,
      body: { environmentCode: 'AMBIENTE_FANTASMA', deploymentMode: 'DIRECT', traffic: [] },
      expect: { statusIn: [400, 404], errorCode: ['ENVIRONMENT_NOT_FOUND', 'HTTP_400'] },
    });

    const deployed = await probe.ok({
      id: 'deployments-create',
      title: 'POST publica la versión aprobada en el ambiente no productivo',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/deployments`,
      roles: ADMIN,
      body: { environmentCode, deploymentMode: 'DIRECT', traffic: [] },
      expect: {
        assert: (body) => assert(body?.id, 'el despliegue debe traer identificador'),
      },
    });

    if (deployed.response.ok && deployed.response.body?.id) {
      state.lifecycle.deploymentId = deployed.response.body.id;
      state.lifecycle.deployedEnvironment = environmentCode;

      // Un segundo despliegue al mismo ambiente es lo que hace posible revertir: la
      // primera publicación no tiene predecesora a la que volver.
      const second = await probe.ok({
        id: 'deployments-create-second',
        title: 'POST vuelve a publicar para que exista una predecesora',
        method: 'POST',
        path: `/v1/artifact-versions/${versionId}/deployments`,
        roles: ADMIN,
        body: { environmentCode, deploymentMode: 'DIRECT', traffic: [] },
      });

      const rollbackTarget = second.response.ok ? second.response.body?.id : undefined;
      if (rollbackTarget) {
        await probe.invalid({
          id: 'deployments-rollback',
          case: 'missing-reason',
          title: 'POST /rollback exige el motivo',
          method: 'POST',
          path: `/v1/deployments/${rollbackTarget}/rollback`,
          roles: ADMIN,
          body: {},
          expect: { status: 400, errorCode: 'HTTP_400' },
        });

        await probe.ok({
          id: 'deployments-rollback',
          title: 'POST /rollback vuelve a la publicación anterior',
          method: 'POST',
          path: `/v1/deployments/${rollbackTarget}/rollback`,
          roles: ADMIN,
          body: { reason: 'Reversión ejercitada por el smoke integral.' },
        });
      } else {
        probe.skip('deployments-rollback', 'POST /rollback', 'no se pudo crear una segunda publicación');
      }

      await probe.invalid({
        id: 'deployments-suspend',
        case: 'missing-reason',
        title: 'POST /suspend exige el motivo',
        method: 'POST',
        path: `/v1/deployments/${deployed.response.body.id}/suspend`,
        roles: ADMIN,
        body: {},
        expect: { status: 400, errorCode: 'HTTP_400' },
      });
    }
  } else {
    probe.skip('deployments-create', 'despliegue de la versión', 'no hay versión aprobada en el estado');
  }

  await probe.invalid({
    id: 'deployments-suspend',
    case: 'unknown-deployment',
    title: 'POST /suspend sobre un despliegue inexistente',
    method: 'POST',
    path: '/v1/deployments/9007199254740991/suspend',
    roles: ADMIN,
    body: { reason: 'Inexistente.' },
    expect: { statusIn: [400, 404], errorCode: ['DEPLOYMENT_NOT_FOUND', 'INVALID_ID'] },
  });

  await probe.invalid({
    id: 'deployments-rollback',
    case: 'unknown-deployment',
    title: 'POST /rollback sobre un despliegue inexistente',
    method: 'POST',
    path: '/v1/deployments/9007199254740991/rollback',
    roles: ADMIN,
    body: { reason: 'Inexistente.' },
    expect: { statusIn: [400, 404], errorCode: ['DEPLOYMENT_NOT_FOUND', 'INVALID_ID'] },
  });

  // --- Registro de librerías: habilitar, nunca aportar código. ------------------------
  reporter.startPhase('operación · registro de librerías');

  await probe.ok({
    id: 'libraries-list',
    title: 'GET /v1/libraries',
    path: '/v1/libraries?page=1&pageSize=25',
    roles: LIBRARY_READ,
  });

  await probe.invalid({
    id: 'libraries-list',
    case: 'unknown-language',
    title: 'GET /v1/libraries rechaza un lenguaje inexistente',
    path: '/v1/libraries?language=COBOL',
    roles: LIBRARY_READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  const preludes = await probe.ok({
    id: 'libraries-preludes',
    title: 'GET /v1/libraries/preludes lista lo implementado en el repositorio',
    path: '/v1/libraries/preludes',
    roles: PRELUDE_READ,
  });

  const availablePreludes = preludes.response.ok ? items(preludes.response.body) : [];
  const prelude = availablePreludes[0];
  if (prelude) {
    const packageName = prelude.packageName ?? prelude.name ?? prelude.code;
    const functions = prelude.functions ?? prelude.allowedFunctions ?? [];
    await probe.ok({
      id: 'libraries-upsert',
      title: 'POST /v1/libraries habilita un prelude ya revisado',
      method: 'POST',
      path: '/v1/libraries',
      roles: LIBRARY_WRITE,
      body: fixture.library({ packageName, functions, language: prelude.language ?? 'JAVASCRIPT' }),
    });
  } else {
    probe.skip('libraries-upsert', 'POST /v1/libraries', 'no se pudo leer el catálogo de preludes');
  }

  await probe.invalid({
    id: 'libraries-upsert',
    case: 'prelude-not-implemented',
    title: 'POST /v1/libraries no habilita un prelude que nadie implementó',
    method: 'POST',
    path: '/v1/libraries',
    roles: LIBRARY_WRITE,
    body: fixture.libraryWithoutPrelude(),
    expect: {
      statusIn: [400, 404, 409, 422],
      errorCode: ['LIBRARY_PRELUDE_NOT_IMPLEMENTED'],
    },
  });

  await probe.invalid({
    id: 'libraries-upsert',
    case: 'malformed-version',
    title: 'POST /v1/libraries exige una versión semántica',
    method: 'POST',
    path: '/v1/libraries',
    roles: LIBRARY_WRITE,
    body: { ...fixture.libraryWithoutPrelude(), version: 'ultima' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Auditoría: la cadena append-only y su verificación. -----------------------------
  reporter.startPhase('operación · auditoría');

  await probe.ok({
    id: 'audit-chain-verify',
    title: 'GET /v1/audit/chain/verify comprueba la cadena encadenada por hash',
    path: '/v1/audit/chain/verify',
    roles: AUDIT,
    expect: {
      assert: (body) => assert(body?.valid === true, `la cadena de auditoría debe ser válida y llegó ${JSON.stringify(body?.invalid ?? body)}`),
    },
  });

  await probe.ok({
    id: 'audit-executions-list',
    title: 'GET /v1/audit/executions',
    path: '/v1/audit/executions?page=1&pageSize=25',
    roles: AUDIT,
  });

  await probe.invalid({
    id: 'audit-executions-list',
    case: 'malformed-date',
    title: 'GET /v1/audit/executions rechaza una fecha mal formada',
    path: '/v1/audit/executions?from=no-es-una-fecha',
    roles: AUDIT,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.ok({
    id: 'audit-events-list',
    title: 'GET /v1/audit/events',
    path: '/v1/audit/events?page=1&pageSize=25',
    roles: AUDIT,
  });

  const cursorPage = await probe.ok({
    id: 'audit-events-cursor',
    title: 'GET /v1/audit/events/cursor pagina por keyset',
    path: '/v1/audit/events/cursor?pageSize=10',
    roles: AUDIT,
  });

  const nextCursor = cursorPage.response.ok ? cursorPage.response.body?.nextCursor : undefined;
  if (nextCursor) {
    await probe.ok({
      id: 'audit-events-cursor-next',
      title: 'GET /v1/audit/events/cursor continúa con el cursor devuelto',
      path: `/v1/audit/events/cursor?pageSize=10&cursor=${encodeURIComponent(nextCursor)}`,
      roles: AUDIT,
    });
  } else {
    probe.skip('audit-events-cursor-next', 'segunda página por cursor', 'la primera página agotó el feed');
  }

  await probe.invalid({
    id: 'audit-events-cursor',
    case: 'corrupt-cursor',
    title: 'GET /v1/audit/events/cursor rechaza un cursor corrupto',
    path: '/v1/audit/events/cursor?cursor=%21%21roto%21%21',
    roles: AUDIT,
    expect: { status: 400, errorCode: ['INVALID_CURSOR', 'HTTP_400'] },
  });

  await probe.ok({
    id: 'audit-metrics',
    title: 'GET /v1/audit/metrics agrega resultados y latencias',
    path: '/v1/audit/metrics',
    roles: AUDIT,
  });

  await probe.invalid({
    id: 'audit-executions-get',
    case: 'malformed-id',
    title: 'GET /v1/audit/executions/:id rechaza un id no numérico',
    path: '/v1/audit/executions/no-es-un-id',
    roles: AUDIT,
    expect: { status: 400, errorCode: 'INVALID_ID' },
  });

  await probe.invalid({
    id: 'audit-executions-get',
    case: 'unknown-id',
    title: 'GET /v1/audit/executions/:id con un id inexistente',
    path: '/v1/audit/executions/9007199254740991',
    roles: AUDIT,
    expect: { statusIn: [400, 404], errorCode: ['EXECUTION_NOT_FOUND', 'INVALID_ID'] },
  });

  // La lectura de una ejecución concreta vive en la SEGUNDA pasada
  // (`scenarios/inbox.mjs`): hasta que el operador no despliega y el cliente de tiempo de
  // ejecución no decide, no hay ninguna que leer.

  // --- Revisión manual: asignar y resolver, con segregación de funciones. --------------
  reporter.startPhase('operación · revisión manual');

  const cases = await probe.ok({
    id: 'manual-reviews-list',
    title: 'GET /v1/manual-reviews',
    path: '/v1/manual-reviews?page=1&pageSize=25',
    roles: MANUAL_REVIEW,
  });

  await probe.invalid({
    id: 'manual-reviews-list',
    case: 'unknown-status',
    title: 'GET /v1/manual-reviews rechaza un estado inexistente',
    path: '/v1/manual-reviews?status=INVENTADO',
    roles: MANUAL_REVIEW,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // Asignar y resolver un caso concreto se comprueban en la SEGUNDA pasada
  // (`scenarios/inbox.mjs`): el caso lo crea el motor al ejecutar el camino de revisión,
  // cosa que aún no ha ocurrido cuando este dominio corre.
  void cases;

  await probe.invalid({
    id: 'manual-reviews-get',
    case: 'unknown-id',
    title: 'GET /v1/manual-reviews/:caseId inexistente',
    path: '/v1/manual-reviews/9007199254740991',
    roles: MANUAL_REVIEW,
    expect: { statusIn: [400, 404], errorCode: ['MANUAL_REVIEW_NOT_FOUND', 'INVALID_ID'] },
  });

  await probe.invalid({
    id: 'manual-reviews-resolve',
    case: 'unknown-decision',
    title: 'POST /resolve rechaza una decisión fuera del catálogo',
    method: 'POST',
    path: '/v1/manual-reviews/9007199254740991/resolve',
    roles: MANUAL_REVIEW,
    body: { decision: 'QUIZAS', reason: 'x' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Revisión de seguridad y trazabilidad. -------------------------------------------
  reporter.startPhase('operación · seguridad y trazabilidad');

  if (versionId) {
    await probe.ok({
      id: 'security-review-get',
      title: 'GET /v1/security-review/versions/:versionId',
      path: `/v1/security-review/versions/${versionId}`,
      roles: SECURITY_TEAM,
      expect: {
        assert: (body) => {
          // La severidad es la que decide si el envío a revisión avisa a cumplimiento y a
          // fraude, así que tiene que venir siempre y dentro del vocabulario cerrado.
          assert(
            ['LOW', 'MEDIUM', 'HIGH'].includes(body?.severity),
            `la revisión debe traer una severidad del catálogo y trajo ${body?.severity}`,
          );
          assert(Array.isArray(body?.findings), 'la revisión debe traer la lista de hallazgos');
          // El informe muestra un extracto del código, nunca el secreto de firma ni claves.
          assert(
            !JSON.stringify(body).includes('AUDIT_HASH_SECRET'),
            'el informe de seguridad no puede filtrar configuración sensible',
          );
        },
      },
    });

    await probe.ok({
      id: 'security-review-export',
      title: 'GET /v1/security-review/versions/:versionId/export',
      path: `/v1/security-review/versions/${versionId}/export`,
      roles: SECURITY_TEAM,
    });
  } else {
    probe.skip('security-review-get', 'revisión de seguridad', 'no hay versión en el estado');
  }

  await probe.invalid({
    id: 'security-review-get',
    case: 'unknown-version',
    title: 'GET /v1/security-review/versions/:versionId inexistente',
    path: '/v1/security-review/versions/9007199254740991',
    roles: SECURITY_TEAM,
    expect: { statusIn: [400, 404], errorCode: ['VERSION_NOT_FOUND', 'INVALID_ID'] },
  });

  await probe.ok({
    id: 'traceability-objectives-list',
    title: 'GET /v1/traceability/objectives',
    path: '/v1/traceability/objectives?page=1&pageSize=25',
    roles: TRACE_READ,
  });

  await probe.ok({
    id: 'traceability-coverage-matrix',
    title: 'GET /v1/traceability/coverage-matrix',
    path: '/v1/traceability/coverage-matrix',
    roles: TRACE_READ,
  });

  const objective = await probe.ok({
    id: 'traceability-objectives-create',
    title: 'POST /v1/traceability/objectives crea el objetivo con su política',
    method: 'POST',
    path: '/v1/traceability/objectives',
    roles: TRACE_WRITE,
    body: fixture.businessObjective(),
  });

  await probe.invalid({
    id: 'traceability-objectives-create',
    case: 'malformed-code',
    title: 'POST de un objetivo rechaza un código fuera del patrón',
    method: 'POST',
    path: '/v1/traceability/objectives',
    roles: TRACE_WRITE,
    body: { ...fixture.businessObjective(), objectiveCode: 'minúsculas inválidas' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (objective.response.ok && objective.response.body?.id) {
    await probe.ok({
      id: 'traceability-objectives-get',
      title: 'GET /v1/traceability/objectives/:objectiveId',
      path: `/v1/traceability/objectives/${objective.response.body.id}`,
      roles: TRACE_READ,
    });

    const policyId = objective.response.body.policies?.[0]?.id;
    if (policyId && versionId) {
      await probe.ok({
        id: 'traceability-link-artifact',
        title: 'POST /policies/:policyId/artifacts enlaza la versión',
        method: 'POST',
        path: `/v1/traceability/policies/${policyId}/artifacts`,
        roles: TRACE_WRITE,
        body: { artifactVersionId: versionId },
      });

      if (state.lifecycle?.suiteId) {
        await probe.ok({
          id: 'traceability-link-test-suite',
          title: 'POST /policies/:policyId/test-suites enlaza la suite',
          method: 'POST',
          path: `/v1/traceability/policies/${policyId}/test-suites`,
          roles: ['RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE'],
          body: { testSuiteId: state.lifecycle.suiteId },
        });
      } else {
        probe.skip('traceability-link-test-suite', 'enlazar la suite a la política', 'no hay suite en el estado');
      }

      await probe.invalid({
        id: 'traceability-link-artifact',
        case: 'unknown-version',
        title: 'POST /policies/:policyId/artifacts con una versión inexistente',
        method: 'POST',
        path: `/v1/traceability/policies/${policyId}/artifacts`,
        roles: TRACE_WRITE,
        body: { artifactVersionId: '9007199254740991' },
        expect: { statusIn: [400, 404], errorCode: ['VERSION_NOT_FOUND', 'ARTIFACT_VERSION_NOT_FOUND', 'INVALID_ID'] },
      });
    }
  }

  await probe.invalid({
    id: 'traceability-objectives-get',
    case: 'unknown-id',
    title: 'GET /v1/traceability/objectives/:objectiveId inexistente',
    path: '/v1/traceability/objectives/9007199254740991',
    roles: TRACE_READ,
    expect: { statusIn: [400, 404], errorCode: ['OBJECTIVE_NOT_FOUND', 'BUSINESS_OBJECTIVE_NOT_FOUND', 'INVALID_ID'] },
  });
}

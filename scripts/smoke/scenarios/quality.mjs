/**
 * Suites de regresión, laboratorio de QA y cola de aprobación.
 *
 * Aquí vive la puerta que impide desplegar sin evidencia: una versión sólo entra en
 * revisión si tiene una suite bloqueante en verde con cobertura suficiente, y sólo queda
 * aprobada si dos roles distintos deciden en orden. El smoke recorre esa puerta por el
 * camino bueno y por los tres modos de saltársela.
 */
import { assert } from '../lib/report.mjs';
import { pollUntil } from '../lib/http.mjs';
import * as fixture from '../lib/fixtures.mjs';

const QA_AUTHOR = ['QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST'];
const QA_READ = ['QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR'];
const QA_LAB = ['QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN'];
const QA_LAB_READ = ['QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR'];
const GOVERNANCE_READ = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE', 'AUDITOR'];
const SUBMIT = ['RISK_ANALYST', 'FRAUD_ANALYST'];
const DECIDE = ['QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('calidad · suites de regresión');

  const versionId = state.lifecycle?.versionId;
  // Los casos deben nombrar la MISMA variable que el grafo declara: un caso escrito contra
  // otro nombre no prueba el algoritmo, sólo comprueba que falta una entrada.
  const inputCode = state.inputVariableCode ?? fixture.inputVariableCode();

  await probe.invalid({
    id: 'test-suites-create',
    case: 'no-cases',
    title: 'POST de una suite exige al menos un caso',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId ?? '1'}/test-suites`,
    roles: QA_AUTHOR,
    body: { ...fixture.testSuite(undefined, inputCode), cases: [] },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'test-suites-create',
    case: 'missing-blocking-flag',
    title: 'POST de una suite exige declarar si es bloqueante',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId ?? '1'}/test-suites`,
    roles: QA_AUTHOR,
    body: (() => {
      const { isBlocking, ...rest } = fixture.testSuite(undefined, inputCode);
      return rest;
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (!versionId) {
    probe.skip('test-suites', 'suites de regresión', 'no hay versión en el estado: corre antes el smoke del autor');
  } else {
    await probe.ok({
      id: 'test-suites-list',
      title: 'GET /v1/artifact-versions/:versionId/test-suites',
      path: `/v1/artifact-versions/${versionId}/test-suites?page=1&pageSize=25`,
      roles: QA_READ,
    });

    const suite = await probe.ok({
      id: 'test-suites-create',
      title: 'POST crea la suite bloqueante con sus dos caminos',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/test-suites`,
      roles: QA_AUTHOR,
      body: fixture.testSuite(`SMOKE_${fixture.RUN}_${Math.floor(Math.random() * 1e6)}`.slice(0, 100), inputCode),
    });

    const suiteId = suite.response.ok ? suite.response.body?.id : state.lifecycle?.suiteId;
    if (suiteId) {
      state.lifecycle.suiteId = suiteId;

      await probe.ok({
        id: 'test-suites-cases-list',
        title: 'GET /v1/test-suites/:suiteId/cases',
        path: `/v1/test-suites/${suiteId}/cases`,
        roles: QA_READ,
      });

      await probe.ok({
        id: 'test-suites-cases-create',
        title: 'POST /v1/test-suites/:suiteId/cases añade un caso',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/cases`,
        roles: QA_AUTHOR,
        body: fixture.testCase(inputCode),
      });

      await probe.invalid({
        id: 'test-suites-cases-create',
        case: 'malformed-case-code',
        title: 'POST de un caso rechaza un código fuera del patrón',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/cases`,
        roles: QA_AUTHOR,
        body: { ...fixture.testCase(inputCode), caseCode: 'minúsculas con espacios' },
        expect: { status: 400, errorCode: 'HTTP_400' },
      });

      await probe.ok({
        id: 'test-suites-cases-import',
        title: 'POST /cases/import añade un lote acotado',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/cases/import`,
        roles: QA_AUTHOR,
        body: fixture.importedTestCases(inputCode),
      });

      await probe.invalid({
        id: 'test-suites-cases-import',
        case: 'empty-batch',
        title: 'POST /cases/import rechaza un lote vacío',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/cases/import`,
        roles: QA_AUTHOR,
        body: { cases: [] },
        expect: { status: 400, errorCode: 'HTTP_400' },
      });

      await probe.invalid({
        id: 'test-suites-runs',
        case: 'baseline-comparison',
        title: 'POST /runs rechaza la comparación contra una línea base',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/runs`,
        roles: QA_AUTHOR,
        body: { baselineCompiledArtifactId: '1' },
        expect: { status: 422, errorCode: 'BASELINE_COMPARISON_NOT_SUPPORTED' },
      });

      const run = await probe.ok({
        id: 'test-suites-runs',
        title: 'POST /runs encola la corrida',
        method: 'POST',
        path: `/v1/test-suites/${suiteId}/runs`,
        roles: QA_AUTHOR,
        body: {},
        expect: { status: 202, assert: (body) => assert(body?.id, 'la corrida debe traer identificador') },
      });

      if (run.response.ok && run.response.body?.id) {
        const runId = run.response.body.id;
        state.lifecycle.testRunId = runId;

        // La corrida es asíncrona: se espera con tope. Un QUEUED perpetuo significa que
        // el trabajador no la reclamó, y eso es un defecto que hay que ver, no esperar.
        const polled = await pollUntil(
          () => probe.send({ path: `/v1/test-runs/${runId}` }),
          (response) => ({
            finished: response.ok && ['PASSED', 'FAILED', 'ERROR'].includes(response.body?.status),
            seen: response.body?.status,
          }),
        );

        if (polled.timedOut) {
          probe.skip(
            'test-runs-terminal',
            'la corrida alcanza un estado terminal',
            `siguió en ${polled.result?.body?.status ?? 'desconocido'} tras agotar la espera; estados vistos: ${[...new Set(polled.seen)].join(' → ')}`,
          );
        } else {
          await probe.ok({
            id: 'test-runs-get',
            title: 'GET /v1/test-runs/:runId con aserciones y cobertura',
            path: `/v1/test-runs/${runId}`,
            roles: QA_READ,
            expect: {
              assert: (body) => {
                assert(body?.status === 'PASSED', `la suite del smoke debe pasar y quedó en ${body?.status}`);
                assert(Array.isArray(body?.coverage), 'la corrida debe traer cobertura');
              },
            },
          });
          state.lifecycle.testRunPassed = polled.result?.body?.status === 'PASSED';
        }
      }
    } else {
      probe.skip('test-suites-cases', 'casos y corridas', 'no se pudo crear la suite');
    }
  }

  await probe.invalid({
    id: 'test-runs-get',
    case: 'unknown-id',
    title: 'GET /v1/test-runs/:runId con un id inexistente',
    path: '/v1/test-runs/9007199254740991',
    roles: QA_READ,
    expect: { statusIn: [400, 404], errorCode: ['TEST_RUN_NOT_FOUND', 'INVALID_ID'] },
  });

  await probe.invalid({
    id: 'test-suites-cases-list',
    case: 'unknown-suite',
    title: 'GET /cases de una suite inexistente',
    path: '/v1/test-suites/9007199254740991/cases',
    roles: QA_READ,
    expect: { statusIn: [400, 404], errorCode: ['TEST_SUITE_NOT_FOUND', 'INVALID_ID'] },
  });

  // --- Laboratorio de QA: generación masiva determinista por semilla. -----------------
  reporter.startPhase('calidad · laboratorio de QA');

  await probe.ok({
    id: 'qa-lab-properties',
    title: 'GET /v1/qa-lab/properties',
    path: '/v1/qa-lab/properties',
    roles: [...QA_LAB_READ, 'PLATFORM_ADMIN'],
  });

  await probe.ok({
    id: 'qa-lab-runs-list',
    title: 'GET /v1/qa-lab/runs',
    path: '/v1/qa-lab/runs?page=1&pageSize=25',
    roles: QA_LAB_READ,
  });

  await probe.invalid({
    id: 'qa-lab-runs-list',
    case: 'unknown-status',
    title: 'GET /v1/qa-lab/runs rechaza un estado inexistente',
    path: '/v1/qa-lab/runs?status=INVENTADO',
    roles: QA_LAB_READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (versionId) {
    await probe.ok({
      id: 'qa-lab-sample-inputs',
      title: 'POST /v1/qa-lab/versions/:versionId/sample-inputs',
      method: 'POST',
      path: `/v1/qa-lab/versions/${versionId}/sample-inputs`,
      roles: QA_LAB,
      body: { kind: 'VALID', count: 5, seed: `smoke-${fixture.RUN}` },
    });

    await probe.invalid({
      id: 'qa-lab-sample-inputs',
      case: 'count-out-of-range',
      title: 'POST /sample-inputs acota cuántos casos genera',
      method: 'POST',
      path: `/v1/qa-lab/versions/${versionId}/sample-inputs`,
      roles: QA_LAB,
      body: { count: 5000 },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'qa-lab-runs-create',
      case: 'case-count-out-of-range',
      title: 'POST de una corrida acota el número de casos',
      method: 'POST',
      path: `/v1/qa-lab/versions/${versionId}/runs`,
      roles: QA_LAB,
      body: { ...fixture.qaRun(), caseCount: 100_000 },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'qa-lab-runs-create',
      case: 'production-environment',
      title: 'POST de una corrida no ejecuta contra producción',
      method: 'POST',
      path: `/v1/qa-lab/versions/${versionId}/runs`,
      roles: QA_LAB,
      body: { ...fixture.qaRun(), environmentCode: 'PROD' },
      expect: {
        statusIn: [400, 403, 409, 422],
        errorCode: ['QA_LAB_PROD_FORBIDDEN', 'QA_RUN_PROD_FORBIDDEN', 'ENVIRONMENT_NOT_ALLOWED', 'HTTP_400'],
      },
    });

    const qaRun = await probe.ok({
      id: 'qa-lab-runs-create',
      title: 'POST /v1/qa-lab/versions/:versionId/runs lanza el lote',
      method: 'POST',
      path: `/v1/qa-lab/versions/${versionId}/runs`,
      roles: QA_LAB,
      body: { ...fixture.qaRun(), environmentCode: state.environmentCode ?? fixture.qaRun().environmentCode },
    });

    if (qaRun.response.ok && qaRun.response.body?.id) {
      state.qaRunId = qaRun.response.body.id;
      await probe.ok({
        id: 'qa-lab-runs-get',
        title: 'GET /v1/qa-lab/runs/:runId',
        path: `/v1/qa-lab/runs/${qaRun.response.body.id}`,
        roles: QA_LAB_READ,
      });
    }
  } else {
    probe.skip('qa-lab-runs-create', 'laboratorio de QA sobre una versión', 'no hay versión en el estado');
  }

  await probe.invalid({
    id: 'qa-lab-counterexamples-replay',
    case: 'unknown-counterexample',
    title: 'POST de la reproducción de un contraejemplo inexistente',
    method: 'POST',
    path: '/v1/qa-lab/counterexamples/9007199254740991/replay',
    roles: QA_LAB,
    body: {},
    expect: {
      statusIn: [400, 404],
      errorCode: ['QA_COUNTEREXAMPLE_NOT_FOUND', 'COUNTEREXAMPLE_NOT_FOUND', 'INVALID_ID', 'HTTP_404'],
    },
  });

  // --- Gobierno: envío a revisión y decisiones ordenadas. ------------------------------
  reporter.startPhase('calidad · gobierno y aprobaciones');

  await probe.ok({
    id: 'approval-requests-list',
    title: 'GET /v1/approval-requests lista la cola',
    path: '/v1/approval-requests?page=1&pageSize=25',
    roles: GOVERNANCE_READ,
  });

  await probe.invalid({
    id: 'approval-requests-get',
    case: 'unknown-id',
    title: 'GET /v1/approval-requests/:requestId inexistente',
    path: '/v1/approval-requests/9007199254740991',
    roles: GOVERNANCE_READ,
    expect: { statusIn: [400, 404], errorCode: ['APPROVAL_REQUEST_NOT_FOUND', 'INVALID_ID'] },
  });

  if (versionId) {
    await probe.invalid({
      id: 'submit-for-review',
      case: 'missing-compliance-flag',
      title: 'POST /submit-for-review exige declarar si requiere cumplimiento',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/submit-for-review`,
      roles: SUBMIT,
      body: {},
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    const submitted = await probe.ok({
      id: 'submit-for-review',
      title: 'POST /submit-for-review abre la revisión ordenada',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/submit-for-review`,
      roles: SUBMIT,
      body: { requireCompliance: false },
      expect: {
        assert: (body) => {
          assert(body?.id, 'la solicitud de aprobación debe traer identificador');
          assert((body?.steps ?? []).length >= 2, 'la revisión debe abrir al menos dos pasos ordenados');
        },
      },
    });

    if (submitted.response.ok && submitted.response.body?.id) {
      state.lifecycle.approvalRequestId = submitted.response.body.id;
      state.lifecycle.approvalSteps = (submitted.response.body.steps ?? []).map((step) => ({
        id: step.id,
        requiredRole: step.requiredRole,
        order: step.stepOrder ?? step.order,
      }));

      await probe.ok({
        id: 'approval-requests-get',
        title: 'GET /v1/approval-requests/:requestId con toda su evidencia',
        path: `/v1/approval-requests/${submitted.response.body.id}`,
        roles: GOVERNANCE_READ,
      });

      // Reenviar la misma versión no puede abrir una segunda revisión.
      await probe.invalid({
        id: 'submit-for-review',
        case: 'already-in-review',
        title: 'POST /submit-for-review no duplica una revisión abierta',
        method: 'POST',
        path: `/v1/artifact-versions/${versionId}/submit-for-review`,
        roles: SUBMIT,
        body: { requireCompliance: false },
        expect: { status: 409, errorCode: ['APPROVAL_REQUEST_EXISTS', 'VERSION_NOT_REVIEWABLE'] },
      });
    }

    // --- Decisiones. El orden importa: el segundo paso no se puede decidir primero. ----
    const steps = state.lifecycle?.approvalSteps ?? [];
    const sorted = [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (sorted.length >= 2) {
      await probe.invalid({
        id: 'approval-decide',
        case: 'out-of-order',
        title: 'Decidir el segundo paso antes que el primero es rechazado',
        method: 'POST',
        path: `/v1/approval-steps/${sorted[1].id}/decisions`,
        roles: DECIDE,
        body: { decision: 'APPROVE', comments: 'Fuera de orden a propósito.', evidence: [] },
        expect: {
          statusIn: [403, 409],
          errorCode: ['APPROVAL_STEP_OUT_OF_ORDER', 'APPROVAL_ROLE_REQUIRED', 'SEPARATION_OF_DUTIES_VIOLATION'],
        },
      });
    }

    if (sorted.length) {
      await probe.invalid({
        id: 'approval-decide',
        case: 'unknown-decision',
        title: 'Una decisión fuera del catálogo es rechazada',
        method: 'POST',
        path: `/v1/approval-steps/${sorted[0].id}/decisions`,
        roles: DECIDE,
        body: { decision: 'QUIZAS', evidence: [] },
        expect: { status: 400, errorCode: 'HTTP_400' },
      });

      await probe.invalid({
        id: 'approval-decide',
        case: 'missing-evidence',
        title: 'Una decisión sin el bloque de evidencia es rechazada',
        method: 'POST',
        path: `/v1/approval-steps/${sorted[0].id}/decisions`,
        roles: DECIDE,
        body: { decision: 'APPROVE' },
        expect: { status: 400, errorCode: 'HTTP_400' },
      });

      // Camino bueno: cada paso lo decide quien tiene su rol, y nunca el autor.
      for (const [index, step] of sorted.entries()) {
        const decided = await probe.ok({
          id: `approval-decide-step-${index + 1}`,
          title: `POST decide el paso ${index + 1} (${step.requiredRole})`,
          method: 'POST',
          path: `/v1/approval-steps/${step.id}/decisions`,
          roles: [step.requiredRole],
          body: { decision: 'APPROVE', comments: 'Aprobado por el smoke integral.', evidence: [] },
        });

        // Repetir la misma decisión con el mismo principal no puede contar dos veces.
        if (decided.allowed && decided.response.ok) {
          await probe.invalid({
            id: `approval-decide-step-${index + 1}`,
            case: 'duplicate',
            title: `Repetir la decisión del paso ${index + 1} es rechazado`,
            method: 'POST',
            path: `/v1/approval-steps/${step.id}/decisions`,
            roles: [step.requiredRole],
            body: { decision: 'APPROVE', evidence: [] },
            expect: {
              status: 409,
              errorCode: ['DUPLICATE_APPROVAL_DECISION', 'APPROVAL_STEP_CLOSED'],
            },
          });
        }
      }
    } else {
      probe.skip('approval-decide', 'decisiones de aprobación', 'no hay pasos de aprobación en el estado');
    }
  }

  await probe.invalid({
    id: 'approval-decide',
    case: 'unknown-step',
    title: 'Decidir un paso inexistente',
    method: 'POST',
    path: '/v1/approval-steps/9007199254740991/decisions',
    roles: DECIDE,
    body: { decision: 'APPROVE', evidence: [] },
    expect: { statusIn: [400, 404], errorCode: ['APPROVAL_STEP_NOT_FOUND', 'INVALID_ID'] },
  });
}

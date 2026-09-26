/**
 * Ejecución de decisiones: simulación de gestión, ejecución en línea y traza en vivo.
 *
 * La ejecución en línea es de OTRA audiencia (`runtime`): una credencial de gestión no
 * puede ejecutar decisiones aunque tenga todos los roles, y una de tiempo de ejecución no
 * puede administrar nada. Ese corte se comprueba explícitamente, porque una credencial que
 * atraviesa las dos audiencias es un agujero, no una comodidad.
 */
import { assert } from '../lib/report.mjs';
import * as fixture from '../lib/fixtures.mjs';

const SIMULATE = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST'];
const LIVE = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('ejecución · simulación');

  const artifactCode = state.lifecycle?.artifactCode;
  const environmentCode = state.lifecycle?.deployedEnvironment ?? state.environmentCode ?? 'DEV';
  // La misma variable que el grafo declara: una entrada con otro nombre no ejercita el
  // algoritmo, sólo comprueba que falta un dato.
  const inputCode = state.inputVariableCode ?? fixture.inputVariableCode();
  const vars = (age) => fixture.decisionVariables(age, inputCode);

  if (!artifactCode || !state.lifecycle?.deploymentId) {
    probe.skip(
      'simulations',
      'simulación sobre el artefacto del smoke',
      'no hay un artefacto desplegado en el estado: corre antes los smokes de autor, aprobador y operador',
    );
  } else {
    await probe.ok({
      id: 'simulations-sample-inputs',
      title: 'POST /v1/simulations/:artifactCode/sample-inputs genera entradas del contrato',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}/sample-inputs`,
      roles: SIMULATE,
      body: { environmentCode, kind: 'VALID', count: 3, seed: `smoke-${fixture.RUN}` },
    });

    await probe.invalid({
      id: 'simulations-sample-inputs',
      case: 'count-out-of-range',
      title: 'POST /sample-inputs acota cuántos valores genera',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}/sample-inputs`,
      roles: SIMULATE,
      body: { environmentCode, count: 500 },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.ok({
      id: 'simulations-simulate',
      title: 'POST /v1/simulations/:artifactCode simula sin persistir nada',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: { ...fixture.simulation(vars(30)), environmentCode },
      expect: {
        assert: (body) => assert(body?.outcome, 'la simulación debe devolver un resultado'),
      },
    });

    await probe.ok({
      id: 'simulations-simulate-declined',
      title: 'POST /v1/simulations recorre también el camino de rechazo',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: { ...fixture.simulation(vars(15)), requestId: `smoke-sim-declined-${fixture.RUN}`, environmentCode },
      expect: {
        assert: (body) => assert(body?.outcome === 'DECLINED', `con edad 15 se esperaba DECLINED y llegó ${body?.outcome}`),
      },
    });

    await probe.invalid({
      id: 'simulations-simulate',
      case: 'missing-variables',
      title: 'POST /v1/simulations exige el bloque de variables',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: { requestId: `smoke-sim-novars-${fixture.RUN}`, environmentCode },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'simulations-simulate',
      case: 'malformed-environment',
      title: 'POST /v1/simulations rechaza un ambiente fuera del patrón',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: { ...fixture.simulation(), environmentCode: 'ambiente en minúsculas' },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.ok({
      id: 'simulations-simulate-manual-review',
      title: 'POST /v1/simulations deriva la franja intermedia a revisión manual',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: { ...fixture.simulation(vars(19)), requestId: `smoke-sim-review-${fixture.RUN}`, environmentCode },
      expect: {
        assert: (body) =>
          assert(body?.outcome === 'MANUAL_REVIEW', `con edad 19 se esperaba MANUAL_REVIEW y llegó ${body?.outcome}`),
      },
    });

    /**
     * Entrada que incumple el contrato.
     *
     * La simulación responde 201: la simulación en sí funcionó, y lo que informa es QUÉ
     * habría pasado —`NO_DECISION` con el motivo catalogado—. No es un error de protocolo
     * sino el resultado, que es justo lo que se le pide a un simulador. La ejecución en
     * línea sí devuelve 422 para el mismo caso, porque allí no hay decisión que entregar.
     */
    await probe.ok({
      id: 'simulations-simulate-contract-violation',
      title: 'POST /v1/simulations informa NO_DECISION ante una entrada que incumple el contrato',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: {
        ...fixture.simulation(vars('no-soy-un-numero')),
        requestId: `smoke-sim-bad-${fixture.RUN}`,
        environmentCode,
      },
      expect: {
        assert: (body) => {
          assert(body?.outcome === 'NO_DECISION', `se esperaba NO_DECISION y llegó ${body?.outcome}`);
          assert(
            (body?.errors ?? []).some((issue) => issue.code === 'VARIABLE_MISSING_OR_INVALID'),
            `se esperaba el motivo VARIABLE_MISSING_OR_INVALID y llegaron ${JSON.stringify(body?.errors)}`,
          );
        },
      },
    });

    // Un valor fuera del rango declarado se rechaza igual que uno de otro tipo: la
    // restricción la reevalúa el motor, nunca se da por buena porque el frontend la mirara.
    await probe.ok({
      id: 'simulations-simulate-out-of-range',
      title: 'POST /v1/simulations informa NO_DECISION ante un valor fuera de rango',
      method: 'POST',
      path: `/v1/simulations/${artifactCode}`,
      roles: SIMULATE,
      body: {
        ...fixture.simulation(vars(999)),
        requestId: `smoke-sim-range-${fixture.RUN}`,
        environmentCode,
      },
      expect: {
        assert: (body) =>
          assert(body?.outcome === 'NO_DECISION', `con edad 999 se esperaba NO_DECISION y llegó ${body?.outcome}`),
      },
    });
  }

  await probe.invalid({
    id: 'simulations-simulate',
    case: 'unknown-artifact',
    title: 'POST /v1/simulations de un artefacto inexistente',
    method: 'POST',
    path: '/v1/simulations/SMOKE_ARTEFACTO_FANTASMA',
    roles: SIMULATE,
    body: { ...fixture.simulation(), environmentCode },
    expect: {
      statusIn: [404, 409],
      errorCode: ['DEPLOYMENT_NOT_FOUND', 'ARTIFACT_NOT_FOUND', 'ACTIVE_DEPLOYMENT_NOT_FOUND', 'NO_ACTIVE_DEPLOYMENT'],
    },
  });

  // --- Traza en vivo. Es SSE: la mayoría de sus fallos llegan como evento, no como
  //     estado HTTP, porque la cabecera 200 ya salió. Lo que SÍ es un 400 de verdad es la
  //     validación del DTO, que ocurre antes de abrir el flujo. -----------------------
  reporter.startPhase('ejecución · traza en vivo');

  await probe.invalid({
    id: 'live-executions-stream',
    case: 'missing-required-query',
    title: 'GET /v1/live-executions/stream exige sus parámetros antes de abrir el flujo',
    path: '/v1/live-executions/stream',
    roles: LIVE,
    expect: { statusIn: [400, 503], errorCode: ['HTTP_400', 'LIVE_EXECUTION_DISABLED'] },
  });

  await probe.invalid({
    id: 'live-executions-stream',
    case: 'malformed-request-id',
    title: 'GET /stream rechaza un identificador de petición fuera del patrón',
    path: `/v1/live-executions/stream?artifactCode=${artifactCode ?? 'X'}&environmentCode=${environmentCode}&requestId=corto&variables=%7B%22age%22%3A30%7D`,
    roles: LIVE,
    expect: { statusIn: [400, 503], errorCode: ['HTTP_400', 'LIVE_EXECUTION_DISABLED'] },
  });

  if (artifactCode && state.lifecycle?.deploymentId) {
    const stream = await probe.ok({
      id: 'live-executions-stream',
      title: 'GET /stream emite el recorrido paso a paso',
      path:
        `/v1/live-executions/stream?artifactCode=${encodeURIComponent(artifactCode)}` +
        `&environmentCode=${encodeURIComponent(environmentCode)}` +
        `&requestId=smoke-live-${fixture.RUN}` +
        `&variables=${encodeURIComponent(JSON.stringify(vars(30)))}`,
      roles: LIVE,
      raw: true,
      expect: { statusIn: [200, 503] },
    });

    if (stream.allowed && stream.response.status === 200) {
      // El flujo puede terminar bien o con un fallo declarado; ambas cosas son observables
      // en el cuerpo. Lo que no puede es no decir nada.
      const frames = stream.response.text ?? '';
      const spoke =
        frames.includes('node_step') ||
        frames.includes('execution_completed') ||
        frames.includes('execution_failed');
      reporter.record({
        id: 'runtime.live-executions-frames.valid',
        title: 'el flujo SSE emite pasos y un evento de cierre',
        expected: 'al menos un node_step, execution_completed o execution_failed',
        outcome: spoke ? 'PASS' : 'FAIL',
        reason: spoke ? undefined : 'el flujo se abrió pero no emitió ningún evento',
        extra: { bytes: frames.length },
      });
    }

    // PROD nunca se ejecuta por esta vía. El rechazo llega como EVENTO, no como estado
    // HTTP, porque la cabecera 200 del flujo ya salió cuando el motor lo comprueba.
    if (probe.reaches(LIVE)) {
      const prodStream = await probe.send({
        path:
          `/v1/live-executions/stream?artifactCode=${encodeURIComponent(artifactCode)}` +
          `&environmentCode=PROD&requestId=smoke-live-prod-${fixture.RUN}` +
          `&variables=${encodeURIComponent(JSON.stringify(vars(30)))}`,
        raw: true,
      });
      const denied =
        prodStream.status === 503 ||
        (prodStream.text ?? '').includes('LIVE_EXECUTION_PROD_FORBIDDEN') ||
        (prodStream.text ?? '').includes('execution_failed');
      reporter.record({
        id: 'runtime.live-executions-stream.invalid.production-forbidden',
        title: 'GET /stream no ejecuta contra producción',
        expected: 'evento execution_failed con LIVE_EXECUTION_PROD_FORBIDDEN, o 503 si la traza está deshabilitada',
        response: prodStream,
        outcome: denied ? 'PASS' : 'FAIL',
        reason: denied ? undefined : 'el flujo no rechazó el ambiente de producción',
      });
    }
  } else {
    probe.skip('live-executions-stream', 'traza en vivo sobre el artefacto del smoke', 'no hay artefacto desplegado en el estado');
  }
}

/**
 * Ejecución en línea con la credencial de tiempo de ejecución.
 *
 * Va aparte porque usa OTRA identidad: `@Audience('runtime')` significa que ninguna de las
 * tres credenciales de gestión puede llegar aquí, por muchos roles que tengan.
 */
export async function runRuntimeAudience({ probe, reporter, state }) {
  reporter.startPhase('ejecución · decisiones en línea (audiencia runtime)');

  const artifactCode = state.lifecycle?.artifactCode;
  const environmentCode = state.lifecycle?.deployedEnvironment ?? state.environmentCode ?? 'DEV';
  const inputCode = state.inputVariableCode ?? fixture.inputVariableCode();
  const vars = (age) => fixture.decisionVariables(age, inputCode);

  if (!artifactCode || !state.lifecycle?.deploymentId) {
    probe.skip('decisions-execute', 'ejecución en línea', 'no hay artefacto desplegado en el estado');
    return;
  }

  const idempotencyKey = `smoke-decision-${fixture.RUN}`;

  const first = await probe.ok({
    id: 'decisions-execute',
    title: 'POST /v1/decisions/:artifactCode ejecuta contra el despliegue activo',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: { ...fixture.decisionRequest(idempotencyKey, vars(30)), environmentCode },
    expect: {
      status: 200,
      assert: (body) => {
        assert(body?.executionId, 'la ejecución debe traer identificador');
        assert(body?.outcome === 'APPROVED', `con edad 30 se esperaba APPROVED y llegó ${body?.outcome}`);
      },
    },
  });

  if (first.response.ok) state.executionId = first.response.body?.executionId;

  await probe.ok({
    id: 'decisions-execute-idempotent',
    title: 'Repetir la misma clave de idempotencia devuelve la misma ejecución',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: { ...fixture.decisionRequest(idempotencyKey, vars(30)), environmentCode },
    expect: {
      status: 200,
      assert: (body) =>
        assert(
          body?.executionId === first.response.body?.executionId,
          `la reejecución debe devolver ${first.response.body?.executionId} y devolvió ${body?.executionId}`,
        ),
    },
  });

  await probe.ok({
    id: 'decisions-execute-declined',
    title: 'POST /v1/decisions recorre también el camino de rechazo',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: { ...fixture.decisionRequest(`smoke-decision-declined-${fixture.RUN}`, vars(15)), environmentCode },
    expect: {
      status: 200,
      assert: (body) => assert(body?.outcome === 'DECLINED', `con edad 15 se esperaba DECLINED y llegó ${body?.outcome}`),
    },
  });

  /**
   * Tercer camino: deriva a revisión manual.
   *
   * Además de cubrir la rama, es lo que CREA el caso que el dominio de operación va a
   * asignar y resolver después. Los casos de revisión no se crean por API: los produce el
   * motor al ejecutar esta acción, así que sin esta llamada no habría ninguno que probar.
   */
  // Uno por tipo de usuario: cada uno tomará y resolverá el suyo, y un caso ya resuelto por
  // otro mediría el cierre en vez del ciclo. La idempotencia obliga a claves distintas.
  for (const [index, owner] of ['author', 'approver', 'operator'].entries()) {
    const age = 18 + index; // 18, 19 y 20: las tres edades de la franja que va a revisión.
    const key = `smoke-decision-review-${fixture.RUN}-${owner}`;
    const review = await probe.ok({
      id: `decisions-execute-manual-review-${owner}`,
      title: `POST /v1/decisions abre el caso de revisión de ${owner}`,
      method: 'POST',
      path: `/v1/decisions/${artifactCode}`,
      roles: [],
      body: { ...fixture.decisionRequest(key, vars(age)), environmentCode },
      expect: {
        status: 200,
        assert: (body) =>
          assert(
            body?.outcome === 'MANUAL_REVIEW',
            `con edad ${age} se esperaba MANUAL_REVIEW y llegó ${body?.outcome}`,
          ),
      },
    });
    if (review.response.ok && !state.manualReviewExecutionId) {
      state.manualReviewExecutionId = review.response.body?.executionId;
    }
  }

  await probe.invalid({
    id: 'decisions-execute',
    case: 'missing-idempotency-key',
    title: 'POST /v1/decisions exige la clave de idempotencia',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: (() => {
      const { idempotencyKey: _drop, ...rest } = fixture.decisionRequest(`smoke-nokey-${fixture.RUN}`);
      return { ...rest, environmentCode };
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'decisions-execute',
    case: 'missing-variables',
    title: 'POST /v1/decisions exige el bloque de variables',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: {
      requestId: `smoke-novars-${fixture.RUN}`,
      idempotencyKey: `smoke-novars-${fixture.RUN}`,
      environmentCode,
    },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'decisions-execute',
    case: 'contract-violation',
    title: 'POST /v1/decisions rechaza una entrada que incumple el contrato',
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    roles: [],
    body: {
      ...fixture.decisionRequest(`smoke-badinput-${fixture.RUN}`, vars('no-soy-un-numero')),
      environmentCode,
    },
    expect: {
      statusIn: [400, 422],
      errorCode: [
        // El motor no lanza: ejecuta, concluye NO_DECISION y devuelve el motivo
        // catalogado dentro del sobre de la decisión, que además se persiste y audita.
        'VARIABLE_MISSING_OR_INVALID',
        'VARIABLE_CONTRACT_VIOLATION',
        'HTTP_400',
      ],
    },
  });

  await probe.invalid({
    id: 'decisions-execute',
    case: 'unknown-artifact',
    title: 'POST /v1/decisions de un artefacto sin despliegue activo',
    method: 'POST',
    path: '/v1/decisions/SMOKE_ARTEFACTO_FANTASMA',
    roles: [],
    body: { ...fixture.decisionRequest(`smoke-ghost-${fixture.RUN}`), environmentCode },
    expect: {
      statusIn: [404, 409],
      errorCode: ['DEPLOYMENT_NOT_FOUND', 'ARTIFACT_NOT_FOUND', 'ACTIVE_DEPLOYMENT_NOT_FOUND', 'NO_ACTIVE_DEPLOYMENT'],
    },
  });
}

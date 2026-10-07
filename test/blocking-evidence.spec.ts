import { judgeBlockingSuites, type BlockingSuite } from '../src/modules/testing/blocking-evidence';
import { expectedResultOf } from '../src/modules/testing/coverage-suite.service';
import { readWorkerDoubles, withWorkerDoubles } from '../src/modules/testing/worker-doubles';

const NODOS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

function suite(code: string, status: string | null, cubiertos: string[]): BlockingSuite {
  return {
    suiteId: code,
    suiteCode: code,
    latestRun: status
      ? {
          id: `run-${code}`,
          status,
          coveredNodes: cubiertos,
          missingNodes: NODOS.filter((nodo) => !cubiertos.includes(nodo)),
          nodeCoverage: (cubiertos.length / NODOS.length) * 100,
        }
      : null,
  };
}

describe('pruebas bloqueantes · la regla de la revisión', () => {
  it('sin ninguna suite bloqueante no pasa, y dice por qué', () => {
    expect(judgeBlockingSuites([])).toEqual({
      passed: false,
      evidence: [{ reason: 'NO_BLOCKING_TEST_SUITE' }],
    });
  });

  it('una suite en verde que recorre el 80 % pasa', () => {
    const veredicto = judgeBlockingSuites([suite('S1', 'PASSED', NODOS.slice(0, 8))]);

    expect(veredicto.passed).toBe(true);
    expect(veredicto.evidence.at(-1)).toMatchObject({
      reason: 'NODE_COVERAGE_OK',
      unionNodeCoverage: 80,
    });
  });

  it('la ÚLTIMA corrida manda: una verde vieja no tapa a la roja de hoy', () => {
    // Antes se buscaba la última corrida EN VERDE, así que la suite seguía «aprobada».
    const veredicto = judgeBlockingSuites([suite('S1', 'FAILED', NODOS)]);

    expect(veredicto.passed).toBe(false);
    expect(veredicto.evidence[0]).toMatchObject({
      latestRunStatus: 'FAILED',
      latestPassingRunId: null,
      passed: false,
    });
  });

  it('la cobertura es del CONJUNTO: dos suites que juntas recorren el grafo pasan', () => {
    // Antes cada suite necesitaba su propio 80 %: una suite de cinco casos puntuales bloqueaba.
    const veredicto = judgeBlockingSuites([
      suite('GRANDE', 'PASSED', NODOS.slice(0, 6)),
      suite('PUNTUAL', 'PASSED', NODOS.slice(6, 9)),
    ]);

    expect(veredicto.passed).toBe(true);
    expect(veredicto.evidence.at(-1)).toMatchObject({ unionNodeCoverage: 90, missingNodes: ['J'] });
  });

  it('lo que recorre una corrida fallida no suma cobertura', () => {
    const veredicto = judgeBlockingSuites([
      suite('VERDE', 'PASSED', NODOS.slice(0, 5)),
      suite('ROJA', 'FAILED', NODOS.slice(5)),
    ]);

    expect(veredicto.passed).toBe(false);
    expect(veredicto.evidence.at(-1)).toMatchObject({
      reason: 'NODE_COVERAGE_BELOW_MINIMUM',
      unionNodeCoverage: 50,
    });
  });

  it('una suite que nunca corrió no pasa', () => {
    expect(judgeBlockingSuites([suite('S1', null, [])]).passed).toBe(false);
  });
});

describe('dobles de worker de un caso de prueba', () => {
  const peticion = {
    service: 'identity',
    operation: 'verify',
    nodeKey: 'VERIFICAR',
    arguments: {},
  };

  it('sin dobles se usa el invocador real, sin tocarlo', () => {
    const real = { invoke: jest.fn() };

    expect(withWorkerDoubles({}, real)).toBe(real);
  });

  it('el doble responde por su nodo y el resto sigue llamando al servicio real', async () => {
    const real = {
      invoke: jest.fn().mockResolvedValue({
        status: 'SUCCEEDED',
        result: { real: true },
        warnings: [],
        durationMs: 1,
      }),
    };
    const invocador = withWorkerDoubles(
      readWorkerDoubles({ workerDoubles: { VERIFICAR: { result: { decision: 'VERIFIED' } } } }),
      real,
    )!;

    await expect(invocador.invoke(peticion)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      result: { decision: 'VERIFIED' },
    });
    await invocador.invoke({ ...peticion, nodeKey: 'OTRO' });
    expect(real.invoke).toHaveBeenCalledTimes(1);
  });

  it('un doble FAILED lanza el error de dominio con su código, como el servicio de verdad', async () => {
    const invocador = withWorkerDoubles(
      readWorkerDoubles({
        workerDoubles: {
          VERIFICAR: { status: 'FAILED', errorCode: 'IDENTITY_DOCUMENT_NOT_IDENTITY' },
        },
      }),
      undefined,
    )!;

    await expect(invocador.invoke(peticion)).rejects.toMatchObject({
      code: 'IDENTITY_DOCUMENT_NOT_IDENTITY',
    });
  });

  it('lo que no tiene forma de doble se ignora', () => {
    expect(readWorkerDoubles({ workerDoubles: 'no' })).toEqual({});
    expect(readWorkerDoubles({ workerDoubles: { N: 5 } })).toEqual({});
  });
});

describe('lo que comprueba un caso generado', () => {
  it('fija la terminal, el desenlace, los motivos y las salidas simples; no la traza entera', () => {
    const esperado = expectedResultOf({
      usable: true,
      visitedNodeKeys: ['START', 'RECHAZAR'],
      traversedEdgeKeys: ['E1'],
      terminalNodeKey: 'RECHAZAR',
      actual: {
        outcome: 'DECLINE',
        reasonCodes: ['MORA_VIGENTE'],
        reasons: ['MORA_VIGENTE'],
        approved_credit_limit: 0,
        primaryResult: { code: 'decision_outcome', value: 'DECLINE' },
        trace: { nodes: ['START', 'RECHAZAR'], edges: ['E1'], terminal: 'RECHAZAR' },
      },
    });

    expect(esperado).toEqual({
      trace: { terminal: 'RECHAZAR' },
      outcome: 'DECLINE',
      reasonCodes: ['MORA_VIGENTE'],
      approved_credit_limit: 0,
    });
  });
});

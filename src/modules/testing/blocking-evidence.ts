/**
 * ¿Pasan las pruebas bloqueantes de una versión? La regla, sin base de datos.
 *
 * Tres defectos de la regla anterior (revisión del 2026-10-07):
 *
 * 1. Miraba la última corrida EN VERDE de cada suite, no la última. Una suite que pasó ayer y hoy
 *    falla seguía contando como aprobada: bastaba no borrar la corrida vieja.
 * 2. Exigía el 80 % de nodos a CADA suite por separado. Una segunda suite bloqueante con cinco
 *    casos muy concretos —que es como se prueba un cambio puntual— bloqueaba la revisión aunque
 *    entre todas recorrieran el grafo entero. La cobertura es del conjunto: se unen los nodos.
 * 3. Un caso sin nada esperado pasaba siempre; eso se corrige en `TestCaseExecutorService`.
 *
 * Ahora: cada suite bloqueante tiene que tener su ÚLTIMA corrida terminada en verde, y entre
 * todas tienen que recorrer al menos `MIN_NODE_COVERAGE` de los nodos.
 */
export const MIN_NODE_COVERAGE = 80;

export interface BlockingSuiteRun {
  id: string;
  status: string;
  /** Nodos recorridos y nodos sin recorrer, tal como los archivó la corrida. */
  coveredNodes: string[];
  missingNodes: string[];
  nodeCoverage: number | null;
}

export interface BlockingSuite {
  suiteId: string;
  suiteCode: string;
  /** La corrida terminada más reciente, o `null` si nunca terminó ninguna. */
  latestRun: BlockingSuiteRun | null;
}

export interface BlockingSuiteEvidence {
  suiteId: string;
  suiteCode: string;
  latestRunId: string | null;
  latestRunStatus: string | null;
  /** Se conserva por compatibilidad: el id de la última corrida si quedó en verde. */
  latestPassingRunId: string | null;
  nodeCoverage: number | null;
  passed: boolean;
}

export interface BlockingVerdict {
  passed: boolean;
  evidence: Array<BlockingSuiteEvidence | Record<string, unknown>>;
}

export function judgeBlockingSuites(suites: readonly BlockingSuite[]): BlockingVerdict {
  if (!suites.length) return { passed: false, evidence: [{ reason: 'NO_BLOCKING_TEST_SUITE' }] };

  const evidence: BlockingSuiteEvidence[] = suites.map((suite) => {
    const run = suite.latestRun;
    const green = run?.status === 'PASSED';
    return {
      suiteId: suite.suiteId,
      suiteCode: suite.suiteCode,
      latestRunId: run?.id ?? null,
      latestRunStatus: run?.status ?? null,
      latestPassingRunId: green ? (run?.id ?? null) : null,
      nodeCoverage: run?.nodeCoverage ?? null,
      passed: green,
    };
  });

  const covered = new Set<string>();
  const all = new Set<string>();
  for (const suite of suites) {
    const run = suite.latestRun;
    if (!run) continue;
    for (const node of run.coveredNodes) {
      all.add(node);
      // Sólo suma lo que recorrió una corrida EN VERDE: lo que recorre una corrida fallida no
      // respalda nada.
      if (run.status === 'PASSED') covered.add(node);
    }
    for (const node of run.missingNodes) all.add(node);
  }
  const unionNodeCoverage = all.size ? (covered.size / all.size) * 100 : 0;
  const coverageOk = unionNodeCoverage >= MIN_NODE_COVERAGE;
  const allGreen = evidence.every((item) => item.passed);

  return {
    passed: allGreen && coverageOk,
    evidence: [
      ...evidence,
      {
        reason: coverageOk ? 'NODE_COVERAGE_OK' : 'NODE_COVERAGE_BELOW_MINIMUM',
        unionNodeCoverage: Math.round(unionNodeCoverage * 100) / 100,
        minimum: MIN_NODE_COVERAGE,
        missingNodes: [...all].filter((node) => !covered.has(node)).sort(),
      },
    ],
  };
}

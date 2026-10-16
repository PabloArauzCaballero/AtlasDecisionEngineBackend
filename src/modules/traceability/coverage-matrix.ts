/** Lo mínimo que la matriz lee de un objetivo de negocio con sus políticas y enlaces. */
export interface MatrixObjective {
  id: bigint;
  objectiveCode: string;
  name: string;
  policyRequirements: Array<{
    id: bigint;
    policyCode: string;
    artifactLinks: unknown[];
    testLinks: unknown[];
  }>;
}

/** Arma la matriz política × objetivo: qué cruces están completos, parciales o abiertos. */
export function buildCoverageMatrix(objectives: MatrixObjective[]) {
  const policyMap = new Map<string, { id: string; policyCode: string }>();
  for (const objective of objectives) {
    for (const policy of objective.policyRequirements) {
      policyMap.set(policy.policyCode, {
        id: policy.id.toString(),
        policyCode: policy.policyCode,
      });
    }
  }
  const policies = [...policyMap.values()];
  let covered = 0;
  // Denominador: los cruces que SON un requisito, no las celdas de la rejilla. Ver la
  // nota de `NOT_APPLICABLE` más abajo.
  let required = 0;
  const matrixObjectives = objectives.map((objective) => {
    const requirements = new Map(
      objective.policyRequirements.map((policy) => [policy.policyCode, policy]),
    );
    const coverage = Object.fromEntries(
      policies.map((policy) => {
        const requirement = requirements.get(policy.policyCode);
        /*
         * La celda existe pero el cruce NO.
         *
         * Una política pertenece a UN objetivo (`policyRequirement.businessObjectiveId`),
         * y la matriz publica una columna por cada código del tenant. Estas celdas se
         * devolvían como `GAP` y se contaban en `total`, así que el porcentaje no podía
         * llegar a 100: con 27 objetivos de una política cada uno, sólo 27 de las 729
         * celdas eran cubribles y un tenant con TODA su evidencia enlazada leía 4 %.
         * Se mantiene la celda —la matriz sigue siendo rectangular, que es lo que la
         * hace legible— pero se dice que no aplica en vez de acusar un hueco que nadie
         * puede cerrar.
         */
        if (!requirement) return [policy.policyCode, 'NOT_APPLICABLE'];
        required += 1;
        const hasArtifact = Boolean(requirement.artifactLinks.length);
        const hasTest = Boolean(requirement.testLinks.length);
        const state =
          hasArtifact && hasTest ? 'COMPLETE' : hasArtifact || hasTest ? 'PARTIAL' : 'GAP';
        if (state === 'COMPLETE') covered += 1;
        return [policy.policyCode, state];
      }),
    );
    return {
      id: objective.id,
      objectiveCode: objective.objectiveCode,
      name: objective.name,
      coverage,
    };
  });
  return {
    policies,
    objectives: matrixObjectives,
    covered,
    total: required,
  };
}

import { Logger } from '@nestjs/common';
import { VersionStatus, type PrismaClient } from '@prisma/client';
import { buildDemoGraph } from './demo-graph';
import { resetDemoArtifact } from './demo-reset';
import { buildDemoSnapshots, type DemoReason, type DemoVariable } from './demo-snapshots';
import { seedDemoWorkflow } from './demo-workflow';

const logger = new Logger('SeedDemoArtifact');

const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';

/**
 * Versión semántica que produce ESTA siembra. Como el sembrado sólo crea el demo
 * si no existe, una base sembrada con un seeder anterior se quedaba con los datos
 * viejos (grafo en línea recta, sin variables de salida, casos que el motor no
 * podía cumplir) y ninguna corrección llegaba a verse. Al cambiar el contenido
 * sembrado se sube esta versión: la demo desfasada se borra y se rehace.
 *
 * 2.1.0 — el compilado guardado llevaba dentro `nullable: false` para las salidas de
 * etapas tardías (`fraud_score`, `credit_risk_score`…), copiado de unas filas de catálogo
 * desfasadas. Con eso, toda decisión que declinaba temprano en KYC moría con
 * REQUIRED_OUTPUT_MISSING en vez de devolver DECLINED.
 *
 * 2.2.0 — el contrato de `age` exigía mínimo 18, así que un menor de edad se
 * rechazaba como DATO INVÁLIDO antes de que el algoritmo pudiera evaluarlo: la
 * regla de elegibilidad y su motivo `AGE_NOT_ELIGIBLE` no se alcanzaban nunca y el
 * caso DECLINE_ELIGIBILITY_AGE fallaba en cada corrida. El umbral es política y
 * vive en la regla; el contrato sólo acota el dato. El compilado lleva el contrato
 * embebido, así que el cambio no llega sin volver a sembrar.
 */
const DEMO_SEMANTIC_VERSION = '2.2.0';

export interface DemoArtifactSummary {
  artifactCode: string;
  version: string;
  productionEnvironmentId: string;
  deploymentId: string;
  compiledChecksum: string;
}

/**
 * Seeds the BNPL_CREDIT_DECISION demonstration artifact end to end: draft version,
 * rule graph, compiled snapshot, passing regression suite, completed governance
 * approval and an active PROD deployment. Idempotent — skips if already present.
 */
export async function seedDemoArtifact(
  prisma: PrismaClient,
  tenantId: bigint,
  environments: { sandbox: { id: bigint }; test: { id: bigint }; prod: { id: bigint } },
  inputVariables: DemoVariable[],
  outputVariables: DemoVariable[],
  reasonByCode: Record<string, DemoReason>,
): Promise<DemoArtifactSummary | undefined> {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId, artifactCode: ARTIFACT_CODE } },
    include: { versions: true },
  });
  if (existing?.versions.length) {
    const seeded = existing.versions.some(
      (version) => version.semanticVersion === DEMO_SEMANTIC_VERSION,
    );
    if (seeded) {
      logger.log(`Seed already present: ${ARTIFACT_CODE} version ${DEMO_SEMANTIC_VERSION}`);
      return undefined;
    }
    logger.warn(
      `Demo ${ARTIFACT_CODE} seeded by an older seeder (${existing.versions[0].semanticVersion}); re-seeding as ${DEMO_SEMANTIC_VERSION}`,
    );
    try {
      await resetDemoArtifact(prisma, tenantId, ARTIFACT_CODE);
    } catch (error) {
      // Si algo real (una decisión productiva, una revisión abierta) impide
      // borrarlo, la aplicación debe arrancar igual: se avisa y se deja lo que hay.
      logger.error(
        `Could not refresh the demo artifact; keeping the existing data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId,
      artifactCode: ARTIFACT_CODE,
      artifactType: 'CREDIT_POLICY',
      name: 'Decisión inicial de crédito BNPL',
      description:
        'Política semilla para originación BNPL: KYC, consentimiento, fraude, elegibilidad y riesgo.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose:
        'Emitir una decisión consistente, explicable, versionada y auditable para solicitudes de crédito BNPL.',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: DEMO_SEMANTIC_VERSION,
      status: VersionStatus.DRAFT,
      changeSummary: 'Versión inicial productiva del flujo BNPL de ATLAS.',
      createdBy: 'seed.system',
    },
  });

  // `decision_outcome` is the single OUTPUT_PRIMARY the graph-structure validator requires
  // (graph-structure.validator.ts): exactly one, scalar, and it drives the engine's legacy
  // `outcome`. Every other target is a plain OUTPUT. Output dependencies MUST use the
  // `output.<code>` path (validated), while inputs use `input.<code>`.
  const PRIMARY_OUTPUT_CODE = 'decision_outcome';
  await prisma.decisionArtifactVariableDependency.createMany({
    data: [
      ...inputVariables.map(({ version: variable, definition }) => ({
        artifactVersionId: version.id,
        variableVersionId: variable.id,
        usageType: 'INPUT',
        isRequired: true,
        fallbackPolicy: 'FAIL_CLOSED',
        dependencyPath: `input.${definition.variableCode}`,
      })),
      ...outputVariables.map(({ version: variable, definition }) => ({
        artifactVersionId: version.id,
        variableVersionId: variable.id,
        usageType: definition.variableCode === PRIMARY_OUTPUT_CODE ? 'OUTPUT_PRIMARY' : 'OUTPUT',
        isRequired: true,
        fallbackPolicy: 'NOT_APPLICABLE',
        dependencyPath: `output.${definition.variableCode}`,
      })),
    ],
  });

  const graph = await buildDemoGraph(prisma, version.id, reasonByCode);
  const { compiledChecksum, canonicalChecksum, compiledArtifact } = await buildDemoSnapshots(
    prisma,
    artifact,
    version,
    inputVariables,
    outputVariables,
    reasonByCode,
    graph,
  );
  const { deployment } = await seedDemoWorkflow(
    prisma,
    tenantId,
    version,
    compiledArtifact,
    environments,
    canonicalChecksum,
    {
      nodes: graph.nodeDefinitions.length,
      edges: graph.edgeDefinitions.length,
      terminals: graph.nodeDefinitions.filter((node) => node.terminal).length,
    },
  );

  return {
    artifactCode: ARTIFACT_CODE,
    version: DEMO_SEMANTIC_VERSION,
    productionEnvironmentId: environments.prod.id.toString(),
    deploymentId: deployment.id.toString(),
    compiledChecksum,
  };
}

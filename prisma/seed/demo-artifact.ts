import { VersionStatus, type PrismaClient } from '@prisma/client';
import { buildDemoGraph } from './demo-graph';
import { buildDemoSnapshots, type DemoReason, type DemoVariable } from './demo-snapshots';
import { seedDemoWorkflow } from './demo-workflow';

const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';

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
  prodEnvironment: { id: bigint },
  variables: DemoVariable[],
  reasonByCode: Record<string, DemoReason>,
): Promise<DemoArtifactSummary | undefined> {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId, artifactCode: ARTIFACT_CODE } },
    include: { versions: true },
  });
  if (existing?.versions.length) {
    console.log(`Seed already present: ${ARTIFACT_CODE} version ${existing.versions[0].semanticVersion}`);
    return undefined;
  }

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId,
      artifactCode: ARTIFACT_CODE,
      artifactType: 'CREDIT_POLICY',
      name: 'Decisión inicial de crédito BNPL',
      description: 'Política semilla para originación BNPL: KYC, consentimiento, fraude, elegibilidad y riesgo.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose: 'Emitir una decisión consistente, explicable, versionada y auditable para solicitudes de crédito BNPL.',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: '1.0.0',
      status: VersionStatus.DRAFT,
      changeSummary: 'Versión inicial productiva del flujo BNPL de ATLAS.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: variables.map(({ version: variable, definition }) => ({
      artifactVersionId: version.id,
      variableVersionId: variable.id,
      usageType: 'INPUT',
      isRequired: true,
      fallbackPolicy: 'FAIL_CLOSED',
      dependencyPath: `input.${definition.variableCode}`,
    })),
  });

  const graph = await buildDemoGraph(prisma, version.id, reasonByCode);
  const { compiledChecksum, canonicalChecksum, compiledArtifact } = await buildDemoSnapshots(
    prisma,
    artifact,
    version,
    variables,
    reasonByCode,
    graph,
  );
  const { deployment } = await seedDemoWorkflow(prisma, tenantId, version, compiledArtifact, prodEnvironment, canonicalChecksum);

  return {
    artifactCode: ARTIFACT_CODE,
    version: '1.0.0',
    productionEnvironmentId: prodEnvironment.id.toString(),
    deploymentId: deployment.id.toString(),
    compiledChecksum,
  };
}

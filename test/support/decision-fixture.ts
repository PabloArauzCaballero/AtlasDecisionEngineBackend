/**
 * Filas mínimas para escribir ejecuciones de verdad contra Postgres.
 *
 * `decision_execution` cuelga de un despliegue, una versión y un ambiente con claves foráneas
 * `RESTRICT`: una prueba de integración que quiera medir consentimientos, créditos o desenlaces
 * necesita esa cadena aunque no ejecute ningún grafo. Se crea aquí una vez, con códigos únicos por
 * corrida, para que cada suite no reinvente —y desincronice— su propia versión.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ResolvedDeployment } from '../../src/modules/deployments/deployment-resolver.service';
import type { CompiledDecisionArtifact } from '../../src/modules/graph/graph.types';

export interface DecisionFixture {
  artifactId: bigint;
  versionId: bigint;
  compiledId: bigint;
  environmentId: bigint;
  environmentCode: string;
  deploymentId: bigint;
  artifactCode: string;
  deployment: ResolvedDeployment;
}

export async function createDecisionFixture(
  prisma: PrismaClient,
  tenantId: bigint,
  options: {
    riskDomain?: string;
    isProduction?: boolean;
    legalBasis?: 'CONSENT' | 'CREDIT_PROTECTION' | null;
    enablingBasisPolicy?: Prisma.InputJsonValue | null;
  } = {},
): Promise<DecisionFixture> {
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const artifactCode = `FIX_${suffix}`.toUpperCase();
  const environmentCode = `E${suffix}`.toUpperCase().slice(0, 40);
  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId,
      artifactCode,
      artifactType: 'CREDIT_POLICY',
      name: 'Fixture',
      ownerTeam: 'risk',
      businessPurpose: 'integration fixture',
      riskDomain: options.riskDomain ?? 'CREDIT_ORIGINATION',
    },
  });
  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      status: 'APPROVED',
      semanticVersion: '1.0.0',
      createdBy: 'fixture',
      legalBasis: options.legalBasis ?? null,
      enablingBasisPolicy:
        options.enablingBasisPolicy === undefined || options.enablingBasisPolicy === null
          ? Prisma.DbNull
          : options.enablingBasisPolicy,
    },
  });
  const compiled = await prisma.decisionCompiledArtifact.create({
    data: {
      artifactVersionId: version.id,
      compilerVersion: 'fixture',
      runtimeSchemaVersion: '1',
      compiledPayloadJson: {},
      compiledChecksum: `sha-${suffix}`,
      compileStatus: 'SUCCESS',
    },
  });
  const environment = await prisma.decisionEnvironment.create({
    data: {
      code: environmentCode,
      name: environmentCode,
      environmentType: options.isProduction === false ? 'DEVELOPMENT' : 'PRODUCTION',
      isProduction: options.isProduction !== false,
    },
  });
  const deployment = await prisma.decisionDeployment.create({
    data: {
      artifactVersionId: version.id,
      compiledArtifactId: compiled.id,
      environmentId: environment.id,
      deploymentMode: 'FULL',
      deploymentStatus: 'ACTIVE',
      effectiveFrom: new Date(Date.now() - 60_000),
      isActive: true,
      deployedBy: 'fixture',
    },
  });
  return {
    artifactId: artifact.id,
    versionId: version.id,
    compiledId: compiled.id,
    environmentId: environment.id,
    environmentCode,
    deploymentId: deployment.id,
    artifactCode,
    deployment: {
      deploymentId: deployment.id,
      artifactVersionId: version.id,
      environmentId: environment.id,
      environmentCode,
      compiledArtifactId: compiled.id,
      compiledChecksum: compiled.compiledChecksum,
      compiled: { variables: [] } as unknown as CompiledDecisionArtifact,
      subjectPolicy: 'WARN',
      riskDomain: options.riskDomain ?? 'CREDIT_ORIGINATION',
      isProductionEnvironment: options.isProduction !== false,
      legalBasis: options.legalBasis ?? null,
      enablingBasisPolicy: options.enablingBasisPolicy ?? null,
    },
  };
}

/** Una ejecución ya escrita, con o sin sujeto, para colgarle créditos y desenlaces. */
export async function createExecution(
  prisma: PrismaClient,
  tenantId: bigint,
  fixture: DecisionFixture,
  input: {
    requestId: string;
    subjectId?: bigint | null;
    decisionStatus?: 'SUCCEEDED' | 'NO_DECISION' | 'FAILED';
  },
) {
  return prisma.decisionExecution.create({
    data: {
      tenantId,
      deploymentId: fixture.deploymentId,
      artifactVersionId: fixture.versionId,
      environmentId: fixture.environmentId,
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      subjectId: input.subjectId ?? null,
      inputSnapshotJson: {},
      decisionStatus: input.decisionStatus ?? 'SUCCEEDED',
      businessOutcome: 'APPROVED',
      durationMs: 1,
    },
  });
}

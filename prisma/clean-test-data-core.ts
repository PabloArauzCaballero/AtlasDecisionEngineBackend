import type { PrismaClient } from '@prisma/client';

/** Codes that must NEVER be removed (the real demo + the documented logic algos). */
export const KEEP_ARTIFACT_CODES = new Set([
  'BNPL_CREDIT_DECISION',
  'SCORING_CREDITO_CONSUMO',
  'TRIAGE_FRAUDE_TRANSACCION',
  'ELEGIBILIDAD_ONBOARDING_KYC',
  'ASIGNACION_LIMITE_TARJETA',
]);

export interface CleanupResult {
  artifacts: number;
  references: number;
  bindings: number;
  codes: string[];
}

/**
 * Removes test-generated artifacts (the ones E2E/Playwright specs create) and every
 * dependent row, in dependency order because several FKs are audit-preserving (no
 * cascade at the DB level): nested-tree references (child artifact), deployments and
 * test runs must go before the artifacts/versions. Idempotent and safe: it never
 * touches KEEP_ARTIFACT_CODES or user data. Shared by the CLI script and the e2e
 * global teardown so both do exactly the same thing.
 */
export async function cleanTestArtifacts(
  prisma: PrismaClient,
  options: { tenantId?: bigint; dryRun?: boolean } = {},
): Promise<CleanupResult> {
  const tenantId = options.tenantId ?? BigInt(process.env.SEED_TENANT_ID ?? '1');
  const candidates = await prisma.decisionArtifact.findMany({
    where: {
      tenantId,
      OR: [
        { artifactCode: { startsWith: 'E2E_' } },
        { artifactCode: { startsWith: 'TEST_' } },
        { artifactCode: { startsWith: 'PW_' } },
        { artifactCode: { startsWith: 'SMOKE_' } },
        { artifactCode: { startsWith: 'SHOULD_' } },
        { artifactCode: { contains: 'BLOCKED' } },
        { artifactCode: { contains: 'FIXTURE' } },
        { artifactCode: { contains: 'SHOULD_NOT' } },
      ],
    },
    select: { id: true, artifactCode: true },
  });
  const junk = candidates.filter((artifact) => !KEEP_ARTIFACT_CODES.has(artifact.artifactCode));
  const codes = junk.map((artifact) => artifact.artifactCode);
  if (!junk.length || options.dryRun) {
    return { artifacts: 0, references: 0, bindings: 0, codes };
  }

  const ids = junk.map((artifact) => artifact.id);
  const versions = await prisma.decisionArtifactVersion.findMany({
    where: { artifactId: { in: ids } },
    select: { id: true },
  });
  const versionIds = versions.map((version) => version.id);

  const refs = await prisma.decisionArtifactReference.deleteMany({
    where: {
      OR: [{ childArtifactId: { in: ids } }, { parentArtifactVersionId: { in: versionIds } }],
    },
  });
  const bindings = await prisma.decisionRuntimeBinding.deleteMany({
    where: { tenantId, artifactCode: { in: codes } },
  });
  // Las ejecuciones van ANTES que los despliegues a los que apuntan.
  //
  // El smoke integral ejecuta decisiones de verdad contra el artefacto que crea, así que
  // sus despliegues quedan referenciados por filas de ejecución. Borrar el despliegue
  // primero violaba `decision_execution_deployment_id_fkey` y abortaba la limpieza entera:
  // la basura se acumulaba en la base compartida y hacía fallar corridas posteriores por
  // motivos que no tenían nada que ver con el cambio que se estaba probando.
  //
  // La evidencia, los pasos y los casos de revisión manual cuelgan de la ejecución en
  // cascada, así que se van con ella.
  await prisma.decisionExecution.deleteMany({ where: { artifactVersionId: { in: versionIds } } });
  await prisma.decisionDeployment.deleteMany({ where: { artifactVersionId: { in: versionIds } } });

  const suites = await prisma.decisionTestSuite.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  const compiled = await prisma.decisionCompiledArtifact.findMany({
    where: { artifactVersionId: { in: versionIds } },
    select: { id: true },
  });
  await prisma.decisionTestRun.deleteMany({
    where: {
      OR: [
        { testSuiteId: { in: suites.map((suite) => suite.id) } },
        { compiledArtifactId: { in: compiled.map((row) => row.id) } },
      ],
    },
  });

  const deleted = await prisma.decisionArtifact.deleteMany({ where: { id: { in: ids } } });
  return { artifacts: deleted.count, references: refs.count, bindings: bindings.count, codes };
}

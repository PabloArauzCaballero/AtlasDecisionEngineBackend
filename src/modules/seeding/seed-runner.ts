import type { PrismaClient } from '@prisma/client';
import { atlasBackendCatalog } from './data/atlas-backend-catalog.data';
import { seedDemoArtifact } from './data/demo-artifact';
import { ensureEnvironment, ensureReason, ensureVariable, TENANT_ID } from './data/helpers';
import { seedIntegrationClients } from './data/integration-clients';
import { reasonCodeCatalog } from './data/reason-code-catalog.data';
import { scoringCatalog } from './data/scoring-catalog.data';
import type { VariableSeed } from './data/types';
import { variableCatalog } from './data/variable-catalog.data';

// Variables referenced by the BNPL_CREDIT_DECISION demonstration graph. A small subset of the
// full bootstrap catalog, not a separate list.
const DEMO_VARIABLE_CODES = [
  'kyc_status',
  'consent_active',
  'age',
  'fraud_signal',
  'bureau_score',
  'monthly_income',
  'requested_amount',
];

/**
 * The complete master variable catalog seeded on every boot: domain INPUT variables, the
 * target/scoring OUTPUT variables, and the variables injected from AtlasBackend. Deduplicated by
 * code (first declaration wins) so a code shared across catalogs is seeded exactly once.
 */
export const fullVariableCatalog: VariableSeed[] = dedupeByCode([
  ...variableCatalog,
  ...scoringCatalog,
  ...atlasBackendCatalog,
]);

function dedupeByCode(seeds: VariableSeed[]): VariableSeed[] {
  const byCode = new Map<string, VariableSeed>();
  for (const seed of seeds) if (!byCode.has(seed.code)) byCode.set(seed.code, seed);
  return [...byCode.values()];
}

export interface BootstrapContext {
  environments: { sandbox: { id: bigint }; test: { id: bigint }; prod: { id: bigint } };
  variableByCode: Record<string, Awaited<ReturnType<typeof ensureVariable>>>;
  reasonByCode: Record<string, Awaited<ReturnType<typeof ensureReason>>>;
  counts: { variables: number; reasonCodes: number; integrationClients: number };
}

/**
 * BOOTSTRAP seeds — reference data that MUST exist in every environment (dev, test, prod):
 * decision environments, the full variable catalog (inputs + scoring targets + AtlasBackend),
 * the reason-code catalog, and the bootstrap integration clients. Fully idempotent (upserts).
 */
export async function runBootstrapSeeds(prisma: PrismaClient): Promise<BootstrapContext> {
  const [sandbox, test, prod] = await Promise.all([
    ensureEnvironment(prisma, 'SANDBOX', 'Sandbox', false),
    ensureEnvironment(prisma, 'TEST', 'Testing', false),
    ensureEnvironment(prisma, 'PROD', 'Production', true),
  ]);

  const seededVariables = await Promise.all(
    fullVariableCatalog.map((seed) => ensureVariable(prisma, seed)),
  );
  const variableByCode = Object.fromEntries(
    seededVariables.map((item) => [item.definition.variableCode, item]),
  );

  const seededReasons = await Promise.all(
    reasonCodeCatalog.map((seed) => ensureReason(prisma, seed)),
  );
  const reasonByCode = Object.fromEntries(seededReasons.map((item) => [item.reasonCode, item]));

  const integrationClients = await seedIntegrationClients(prisma);

  return {
    environments: { sandbox, test, prod },
    variableByCode,
    reasonByCode,
    counts: {
      variables: seededVariables.length,
      reasonCodes: seededReasons.length,
      integrationClients: integrationClients.length,
    },
  };
}

/**
 * MOCKUP seeds — demonstration data that only makes sense in a development environment: the
 * end-to-end BNPL_CREDIT_DECISION demo artifact (graph, compiled snapshot, regression suite,
 * governance approval and an active PROD deployment). Idempotent — skips if already present.
 */
export async function runMockupSeeds(prisma: PrismaClient, context: BootstrapContext) {
  const demoVariables = DEMO_VARIABLE_CODES.map((code) => context.variableByCode[code]);
  return seedDemoArtifact(
    prisma,
    TENANT_ID,
    context.environments.prod,
    demoVariables,
    context.reasonByCode,
  );
}

export interface SeedSummary {
  bootstrap: BootstrapContext['counts'];
  environments: { sandboxId: string; testId: string; prodId: string };
  mockup?: Awaited<ReturnType<typeof seedDemoArtifact>>;
  mockupSkipped: boolean;
}

/**
 * Runs the bootstrap seeds always, and the mockup seeds only when `includeMockup` is set
 * (development). Shared by the CLI (`prisma db seed`) and the startup {@link SeedingService}.
 */
export async function runSeeds(
  prisma: PrismaClient,
  options: { includeMockup: boolean },
): Promise<SeedSummary> {
  const bootstrap = await runBootstrapSeeds(prisma);
  const summary: SeedSummary = {
    bootstrap: bootstrap.counts,
    environments: {
      sandboxId: bootstrap.environments.sandbox.id.toString(),
      testId: bootstrap.environments.test.id.toString(),
      prodId: bootstrap.environments.prod.id.toString(),
    },
    mockupSkipped: !options.includeMockup,
  };
  if (options.includeMockup) {
    summary.mockup = await runMockupSeeds(prisma, bootstrap);
  }
  return summary;
}

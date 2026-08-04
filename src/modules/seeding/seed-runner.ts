import type { PrismaClient } from '@prisma/client';
import { atlasBackendCatalog } from './data/atlas-backend-catalog.data';
import { seedCalculatedFields } from './data/calculated-field-catalog.data';
import { seedCollectionsDemoArtifact } from './data/collections-demo.seed';
import { seedContractDemoArtifact } from './data/contract-demo.seed';
import { seedGovernanceScenarios } from './data/governance-scenarios.seed';
import { seedApprovedLibraries } from './data/library-catalog.data';
import { seedDemoArtifact } from './data/demo-artifact';
import { ensureEnvironment, ensureReason, ensureVariable, TENANT_ID } from './data/helpers';
import { seedIntegrationClients } from './data/integration-clients';
import { reasonCodeCatalog } from './data/reason-code-catalog.data';
import { scoringCatalog } from './data/scoring-catalog.data';
import type { VariableSeed } from './data/types';
import { variableCatalog } from './data/variable-catalog.data';

// INPUT variables the BNPL_CREDIT_DECISION demonstration graph resolves before executing —
// a curated subset of the full bootstrap catalog (see src/modules/seeding/data/demo-graph.ts
// for the formulas that consume each one), not a separate list.
const DEMO_INPUT_CODES = [
  // Identidad / KYC
  'kyc_status',
  'consent_active',
  'age',
  'national_id_verified',
  'biometric_match_score',
  'liveness_check_passed',
  'address_verified',
  'phone_verified',
  'email_verified',
  'pep_status',
  'identity_confidence_score',
  // Fraude / dispositivo / comportamiento
  'fraud_signal',
  'device_reputation',
  'device_risk_score',
  'ip_address_risk_score',
  'ip_tor_detected',
  'velocity_applications_24h',
  'synthetic_identity_score',
  'sim_swap_detected',
  'geolocation_mismatch_flag',
  'known_fraud_device_flag',
  'known_fraud_email_flag',
  'known_fraud_phone_flag',
  'previous_fraud_case_flag',
  'account_takeover_risk_score',
  'browser_automation_detected',
  // Elegibilidad / afordabilidad (monto y plazo también alimentan riesgo/pricing)
  'employment_status',
  'requested_amount',
  'requested_term_months',
  // Buró de crédito
  'bureau_score',
  'delinquency_count_12m',
  'worst_delinquency_status',
  'revolving_utilization_ratio',
  'inquiries_last_6m',
  'public_records_count',
  'bankruptcy_flag',
  'charge_off_count',
  'payment_history_score',
  'debt_to_income_ratio',
  'credit_mix_score',
  'thin_file_flag',
  'no_hit_flag',
  'oldest_trade_age_months',
  // Capacidad de pago
  'disposable_income',
  'affordability_ratio',
  'income_stability_score',
  'bank_statement_nsf_count',
  'self_employed_flag',
  'tax_return_verified',
  // AML / sanciones
  'pep_relationship_type',
  'ofac_screening_result',
  'sanctions_screening_result',
  'high_risk_jurisdiction_flag',
  'adverse_media_hit',
  'source_of_funds_verified',
  // Regulatorio (tope de tasa para el pricing final)
  'usury_cap_rate',
];

// OUTPUT variables this graph's RESULT/SET_FIELD nodes produce (see scoring-catalog.data.ts —
// excludes the collections_* scoring outputs, which belong to a future servicing/collections
// artifact, not to BNPL origination).
const DEMO_OUTPUT_CODES = [
  'identity_verification_score',
  'kyc_decision',
  'fraud_score',
  'fraud_risk_band',
  'fraud_decision',
  'eligibility_score',
  'eligibility_decision',
  'credit_risk_score',
  'risk_band',
  'probability_of_default',
  'expected_loss_amount',
  'credit_risk_decision',
  'affordability_score',
  'max_affordable_installment',
  'affordability_decision',
  'aml_risk_score',
  'aml_decision',
  'compliance_decision',
  'scoring',
  'decision_outcome',
  'decision_confidence',
  'approved_amount',
  'approved_credit_limit',
  'approved_term_months',
  'annual_percentage_rate',
  'pricing_tier',
  'adverse_action_reason_codes',
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
  counts: {
    variables: number;
    reasonCodes: number;
    integrationClients: number;
    approvedLibraries: number;
    calculatedFields: number;
  };
}

/**
 * BOOTSTRAP seeds — reference data that MUST exist in every environment (dev, test, prod):
 * decision environments, the full variable catalog (inputs + scoring targets + AtlasBackend),
 * the reason-code catalog, the bootstrap integration clients, the approved-library registry
 * and the reusable calculated fields. Fully idempotent (upserts).
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
  // Las librerías van antes que los campos calculados: un campo que selecciona `math`
  // no puede sembrarse si la librería todavía no existe (falla cerrado a propósito).
  const approvedLibraries = await seedApprovedLibraries(prisma);
  const calculatedFields = await seedCalculatedFields(prisma);

  return {
    environments: { sandbox, test, prod },
    variableByCode,
    reasonByCode,
    counts: {
      variables: seededVariables.length,
      reasonCodes: seededReasons.length,
      integrationClients: integrationClients.length,
      approvedLibraries: approvedLibraries.length,
      calculatedFields: calculatedFields.length,
    },
  };
}

/**
 * MOCKUP seeds — demonstration data that only makes sense in a development environment: the
 * end-to-end BNPL_CREDIT_DECISION demo artifact (graph, compiled snapshot, regression suite,
 * governance approval and an active PROD deployment). Idempotent — skips if already present.
 */
export async function runMockupSeeds(prisma: PrismaClient, context: BootstrapContext) {
  const inputVariables = DEMO_INPUT_CODES.map((code) => context.variableByCode[code]);
  const outputVariables = DEMO_OUTPUT_CODES.map((code) => context.variableByCode[code]);
  // Demo de contratos (§11): pequeño, completo y verificado contra el motor real por
  // `contract-demo-seed.spec.ts`. Se siembra aparte del demo BNPL para que cada uno
  // pueda evolucionar sin arrastrar al otro.
  await seedContractDemoArtifact(prisma, context.environments);
  // Segundo algoritmo: el único que ejercita nodos de CONDICIÓN y SWITCH, que el
  // demo BNPL no usa en ninguna parte (allí las bifurcaciones viven en aristas).
  await seedCollectionsDemoArtifact(prisma);
  // Escenarios negativos de gobierno (§11): ciclo, versión no disponible, contrato
  // incompatible y una corrida de QA con su contraejemplo.
  await seedGovernanceScenarios(prisma);
  return seedDemoArtifact(
    prisma,
    TENANT_ID,
    context.environments,
    inputVariables,
    outputVariables,
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

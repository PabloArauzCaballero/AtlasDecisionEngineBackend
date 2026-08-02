import { MetricsService } from '../src/common/observability/metrics.service';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import type {
  ArtifactGraphSnapshot,
  CompiledDecisionArtifact,
} from '../src/modules/graph/graph.types';
import { buildDemoGraph } from '../src/modules/seeding/data/demo-graph';
import { buildDemoSnapshots, type DemoVariable } from '../src/modules/seeding/data/demo-snapshots';
import { scoringCatalog } from '../src/modules/seeding/data/scoring-catalog.data';
import { variableCatalog } from '../src/modules/seeding/data/variable-catalog.data';
import { reasonCodeCatalog } from '../src/modules/seeding/data/reason-code-catalog.data';
import type { VariableSeed } from '../src/modules/seeding/data/types';

// End-to-end verification of the seeded BNPL_CREDIT_DECISION graph WITHOUT a database: an
// in-memory Prisma stub captures every row buildDemoGraph/buildDemoSnapshots would persist,
// then the compiled snapshot is (a) run through the real GraphValidatorService (structure +
// expressions + determinism) and (b) executed by the real ExecutionEngineService for a set of
// applicants that must each land on a specific terminal. This is what makes the seed's
// "PASSED" regression suite honest — the graph is proven to compile and decide, not just to
// insert rows.

interface StubRow {
  id: bigint;
}
function makeStubPrisma() {
  let nextId = 0n;
  let compiledPayload: CompiledDecisionArtifact | undefined;
  const create = () => async (): Promise<StubRow> => {
    nextId += 1n;
    return { id: nextId };
  };
  const prisma = {
    decisionRuleCondition: { create: create() },
    decisionRuleAction: { create: create() },
    decisionActionReasonMapping: { create: create() },
    decisionRuleNode: { create: create() },
    decisionNodeAction: { create: create() },
    decisionRuleEdge: { create: create() },
    decisionEdgeCondition: { create: create() },
    decisionCompiledArtifact: {
      create: async ({ data }: { data: { compiledPayloadJson: CompiledDecisionArtifact } }) => {
        compiledPayload = data.compiledPayloadJson;
        nextId += 1n;
        return { id: nextId };
      },
    },
  };
  return { prisma, getCompiled: () => compiledPayload };
}

/** Turns a seed variable into the DemoVariable shape the snapshot builder consumes. */
function demoVariable(seed: VariableSeed, id: bigint): DemoVariable {
  return {
    definition: { variableCode: seed.code, isSensitive: seed.sensitive ?? false },
    version: {
      id,
      versionNumber: 1,
      dataType: seed.type,
      unitCode: seed.unit ?? null,
      nullable: seed.nullable ?? false,
      validationSchemaJson: seed.validation ?? null,
    },
  };
}

async function buildCompiledArtifact(): Promise<{
  compiled: CompiledDecisionArtifact;
  snapshot: ArtifactGraphSnapshot;
}> {
  const { prisma, getCompiled } = makeStubPrisma();
  const reasonByCode = Object.fromEntries(
    reasonCodeCatalog.map((reason, index) => [reason.code, { id: BigInt(index + 1) }]),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graph = await buildDemoGraph(prisma as any, 1n, reasonByCode);

  const inputCodes = new Set(
    variableCatalog.filter((seed) => seed.kind !== 'OUTPUT').map((seed) => seed.code),
  );
  const referenced = new Set<string>();
  const collectVars = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach(collectVars);
    const node = value as Record<string, unknown>;
    if (typeof node.var === 'string' && !node.var.startsWith('output.')) referenced.add(node.var);
    Object.values(node).forEach(collectVars);
  };
  graph.conditionDefinitions.forEach((c) => collectVars(c.expression));
  graph.actionDefinitions.forEach((a) => collectVars(a.payload));

  let idCounter = 1000n;
  const inputVariables = variableCatalog
    .filter((seed) => inputCodes.has(seed.code) && referenced.has(seed.code))
    .map((seed) => demoVariable(seed, (idCounter += 1n)));
  const outputVariables = scoringCatalog
    .filter((seed) => seed.kind === 'OUTPUT')
    .map((seed) => demoVariable(seed, (idCounter += 1n)));

  const reasonSnapshots = Object.fromEntries(
    reasonCodeCatalog.map((reason, index) => [
      reason.code,
      {
        id: BigInt(index + 1),
        category: reason.category,
        publicMessage: reason.publicMessage,
        internalMessage: reason.internalMessage,
        severity: reason.adverseAction ? 'HIGH' : 'INFO',
        isAdverseAction: reason.adverseAction,
      },
    ]),
  );

  await buildDemoSnapshots(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma as any,
    {
      id: 1n,
      tenantId: 1n,
      artifactCode: 'BNPL_CREDIT_DECISION',
      artifactType: 'CREDIT_POLICY',
      name: 'demo',
      riskDomain: 'CREDIT_ORIGINATION',
    },
    { id: 1n, semanticVersion: '2.0.0' },
    inputVariables,
    outputVariables,
    reasonSnapshots,
    graph,
  );

  const compiled = getCompiled();
  if (!compiled) throw new Error('compiled payload was not captured');

  const snapshot: ArtifactGraphSnapshot = {
    artifact: compiled.artifact,
    version: { ...compiled.version, status: 'STRUCTURAL' },
    variables: compiled.variables,
    intermediates: compiled.intermediates ?? [],
    outputContract: compiled.outputContract ?? [],
    conditions: Object.values(compiled.conditions),
    actions: Object.values(compiled.actions),
    nodes: Object.values(compiled.nodes),
    edges: Object.values(compiled.edgesByNode).flat(),
  };
  return { compiled, snapshot };
}

const BASE_APPLICANT: Record<string, unknown> = {
  kyc_status: 'VERIFIED',
  consent_active: true,
  age: 34,
  national_id_verified: true,
  biometric_match_score: 96,
  liveness_check_passed: true,
  address_verified: true,
  phone_verified: true,
  email_verified: true,
  pep_status: false,
  identity_confidence_score: 92,
  fraud_signal: false,
  device_reputation: 'TRUSTED',
  device_risk_score: 4,
  ip_address_risk_score: 5,
  ip_tor_detected: false,
  velocity_applications_24h: 1,
  synthetic_identity_score: 2,
  sim_swap_detected: false,
  geolocation_mismatch_flag: false,
  known_fraud_device_flag: false,
  known_fraud_email_flag: false,
  known_fraud_phone_flag: false,
  previous_fraud_case_flag: false,
  account_takeover_risk_score: 3,
  browser_automation_detected: false,
  employment_status: 'EMPLOYED',
  requested_amount: 2500,
  requested_term_months: 12,
  bureau_score: 820,
  delinquency_count_12m: 0,
  worst_delinquency_status: 'CURRENT',
  revolving_utilization_ratio: 0.2,
  inquiries_last_6m: 1,
  public_records_count: 0,
  bankruptcy_flag: false,
  charge_off_count: 0,
  payment_history_score: 95,
  debt_to_income_ratio: 0.15,
  credit_mix_score: 72,
  thin_file_flag: false,
  no_hit_flag: false,
  oldest_trade_age_months: 84,
  disposable_income: 4200,
  affordability_ratio: 0.15,
  income_stability_score: 88,
  bank_statement_nsf_count: 0,
  self_employed_flag: false,
  tax_return_verified: false,
  pep_relationship_type: 'NONE',
  ofac_screening_result: 'CLEAR',
  sanctions_screening_result: 'CLEAR',
  high_risk_jurisdiction_flag: false,
  adverse_media_hit: false,
  source_of_funds_verified: true,
  usury_cap_rate: 0.6,
};
const applicant = (overrides: Record<string, unknown>) => ({ ...BASE_APPLICANT, ...overrides });

describe('BNPL_CREDIT_DECISION seed graph', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 256 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  it('compiles into a structurally valid, deterministic graph', async () => {
    const { snapshot } = await buildCompiledArtifact();
    const validator = new GraphValidatorService(
      new ExpressionEvaluator(),
      new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'x'.repeat(32) })),
    );
    const report = validator.validate(snapshot);
    if (!report.valid) {
      throw new Error(
        `Graph invalid:\n${report.errors.map((e) => `  ${e.code}: ${e.message}`).join('\n')}`,
      );
    }
    expect(report.valid).toBe(true);
    expect(report.metrics.terminalNodeCount).toBe(3);
  });

  it('siembra los nodos como un árbol dentro del lienzo y sin solaparse', async () => {
    const { snapshot } = await buildCompiledArtifact();
    // Coordenadas = porcentaje del lienzo del editor (1680x1020 px). Antes se
    // sembraban en píxeles (order*160, y=100): fuera de rango y todas en una fila.
    for (const node of snapshot.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(100);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(100);
    }
    // Dos nodos nunca comparten hueco (el lienzo agranda su "mundo" cuando el
    // grafo es denso, así que basta con que las posiciones sean distintas).
    const slots = snapshot.nodes.map((node) => `${node.x}:${node.y}`);
    expect(new Set(slots).size).toBe(slots.length);
    // Y el flujo avanza: el inicio queda a la izquierda de todo terminal.
    const start = snapshot.nodes.find((node) => node.type === 'START')!;
    for (const terminal of snapshot.nodes.filter((node) => node.terminal)) {
      expect(terminal.x).toBeGreaterThan(start.x);
    }
  });

  const cases: Array<{
    name: string;
    input: Record<string, unknown>;
    outcome: string;
    reason?: string;
  }> = [
    {
      name: 'approves a clean low-risk applicant',
      input: applicant({}),
      outcome: 'APPROVED',
      reason: 'APPROVED_POLICY',
    },
    {
      name: 'declines invalid KYC/consent',
      input: applicant({ kyc_status: 'REJECTED' }),
      outcome: 'DECLINED',
      reason: 'KYC_OR_CONSENT_INVALID',
    },
    {
      name: 'declines a known-fraud device',
      input: applicant({ known_fraud_device_flag: true }),
      outcome: 'DECLINED',
      reason: 'KNOWN_FRAUD_DEVICE',
    },
    {
      name: 'declines an under-age applicant',
      input: applicant({ age: 16 }),
      outcome: 'DECLINED',
      reason: 'AGE_NOT_ELIGIBLE',
    },
    {
      name: 'declines low credit-risk score',
      input: applicant({
        bureau_score: 300,
        payment_history_score: 40,
        debt_to_income_ratio: 0.6,
        revolving_utilization_ratio: 0.95,
        delinquency_count_12m: 5,
        inquiries_last_6m: 8,
      }),
      outcome: 'DECLINED',
      reason: 'BUREAU_SCORE_TOO_LOW',
    },
    {
      name: 'declines insufficient affordability',
      input: applicant({ affordability_ratio: 0.6 }),
      outcome: 'DECLINED',
      reason: 'AFFORDABILITY_RATIO_EXCEEDED',
    },
    {
      name: 'blocks a confirmed sanctions match',
      input: applicant({ ofac_screening_result: 'MATCH' }),
      outcome: 'DECLINED',
      reason: 'SANCTIONS_CONFIRMED_MATCH',
    },
    {
      name: 'routes a PEP to manual review',
      input: applicant({ pep_status: true, pep_relationship_type: 'FAMILY' }),
      outcome: 'MANUAL_REVIEW',
      reason: 'SCORE_BAND_BORDERLINE',
    },
  ];

  it.each(cases)('$name', async ({ input, outcome, reason }) => {
    const { compiled } = await buildCompiledArtifact();
    const result = await engine.execute(compiled, input);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output.decision_outcome).toBe(outcome);
    if (reason) {
      expect(result.reasons.map((r) => r.code)).toContain(reason);
    }
  });

  it('produces every declared required output on the approval path (fail-closed contract)', async () => {
    const { compiled } = await buildCompiledArtifact();
    const result = await engine.execute(compiled, applicant({}));
    // finalizeOutputContract throws REQUIRED_OUTPUT_MISSING if any required non-nullable output
    // is unset, so a SUCCEEDED status already proves the contract held — assert the headline
    // financial outputs are present and typed.
    expect(typeof result.output.scoring).toBe('number');
    expect(typeof result.output.approved_amount).toBe('number');
    expect(typeof result.output.annual_percentage_rate).toBe('number');
    expect(result.output.pricing_tier).toBeDefined();
  });
});

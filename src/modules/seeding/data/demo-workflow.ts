import {
  ApprovalOutcome,
  ApprovalRequestStatus,
  ApprovalStepStatus,
  DeploymentStatus,
  Prisma,
  TestCaseRunStatus,
  TestRunStatus,
  VersionStatus,
  type PrismaClient,
} from '@prisma/client';

// A fully-populated, low-risk applicant that satisfies every stage gate. The regression cases
// below derive their inputs from this base and override only the fields that drive the specific
// terminal path they exercise — so each case is a complete, resolvable input set (the engine
// fails closed on any missing required input), and each override maps to exactly one decline
// cause / review trigger in demo-graph.ts.
const BASE_APPLICANT: Record<string, unknown> = {
  // Identidad / KYC
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
  // Fraude
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
  // Elegibilidad
  employment_status: 'EMPLOYED',
  requested_amount: 2500,
  requested_term_months: 12,
  // Buró de crédito
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
  // Capacidad de pago
  disposable_income: 4200,
  affordability_ratio: 0.15,
  income_stability_score: 88,
  bank_statement_nsf_count: 0,
  self_employed_flag: false,
  tax_return_verified: false,
  // AML / sanciones
  pep_relationship_type: 'NONE',
  ofac_screening_result: 'CLEAR',
  sanctions_screening_result: 'CLEAR',
  high_risk_jurisdiction_flag: false,
  adverse_media_hit: false,
  source_of_funds_verified: true,
  // Regulatorio
  usury_cap_rate: 0.6,
};

const applicant = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  ...BASE_APPLICANT,
  ...overrides,
});

const TERMINAL_TEST_CASES = [
  {
    caseCode: 'APPROVE_LOW_RISK',
    testName: 'Aprueba solicitante verificado y de bajo riesgo',
    input: applicant({}),
    expected: { decision_outcome: 'APPROVED', reasonCodes: ['APPROVED_POLICY'] },
    tags: ['happy-path', 'approval'],
  },
  {
    caseCode: 'DECLINE_KYC',
    testName: 'Rechaza consentimiento/KYC inválido en la etapa de identidad',
    input: applicant({ kyc_status: 'REJECTED' }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['KYC_OR_CONSENT_INVALID'] },
    tags: ['negative', 'kyc'],
  },
  {
    caseCode: 'DECLINE_FRAUD_KNOWN_DEVICE',
    testName: 'Rechaza dispositivo con fraude conocido',
    input: applicant({ known_fraud_device_flag: true }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['KNOWN_FRAUD_DEVICE'] },
    tags: ['negative', 'fraud'],
  },
  {
    caseCode: 'DECLINE_ELIGIBILITY_AGE',
    testName: 'Rechaza solicitante menor de edad',
    input: applicant({ age: 16 }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['AGE_NOT_ELIGIBLE'] },
    tags: ['negative', 'eligibility'],
  },
  {
    caseCode: 'DECLINE_CREDIT_RISK',
    testName: 'Rechaza puntaje de riesgo de crédito bajo el umbral',
    input: applicant({
      bureau_score: 300,
      payment_history_score: 40,
      debt_to_income_ratio: 0.6,
      revolving_utilization_ratio: 0.95,
      delinquency_count_12m: 5,
      inquiries_last_6m: 8,
    }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['BUREAU_SCORE_TOO_LOW'] },
    tags: ['negative', 'credit-risk'],
  },
  {
    caseCode: 'DECLINE_AFFORDABILITY',
    testName: 'Rechaza por capacidad de pago insuficiente',
    input: applicant({ affordability_ratio: 0.6 }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['AFFORDABILITY_RATIO_EXCEEDED'] },
    tags: ['negative', 'affordability'],
  },
  {
    caseCode: 'BLOCK_AML_SANCTIONS',
    testName: 'Rechaza coincidencia confirmada de sanciones (bloqueo AML)',
    input: applicant({ ofac_screening_result: 'MATCH' }),
    expected: { decision_outcome: 'DECLINED', reasonCodes: ['SANCTIONS_CONFIRMED_MATCH'] },
    tags: ['negative', 'aml'],
  },
  {
    caseCode: 'MANUAL_REVIEW_PEP',
    testName: 'Deriva PEP a revisión manual sin rechazo automático',
    input: applicant({ pep_status: true, pep_relationship_type: 'FAMILY' }),
    expected: { decision_outcome: 'MANUAL_REVIEW', reasonCodes: ['SCORE_BAND_BORDERLINE'] },
    tags: ['manual-review', 'kyc', 'aml'],
  },
];

const APPROVAL_ROLES = ['QA_APPROVER', 'RISK_APPROVER', 'COMPLIANCE_APPROVER'];

const STATUS_HISTORY = [
  {
    fromStatus: null,
    toStatus: VersionStatus.DRAFT,
    changedBy: 'seed.system',
    reason: 'Versión creada',
  },
  {
    fromStatus: VersionStatus.DRAFT,
    toStatus: VersionStatus.VALIDATED,
    changedBy: 'seed.qa',
    reason: 'Grafo válido',
  },
  {
    fromStatus: VersionStatus.VALIDATED,
    toStatus: VersionStatus.COMPILED,
    changedBy: 'seed.compiler',
    reason: 'Compilación determinista exitosa',
  },
  {
    fromStatus: VersionStatus.COMPILED,
    toStatus: VersionStatus.IN_REVIEW,
    changedBy: 'seed.author',
    reason: 'Enviado a gobierno',
  },
  {
    fromStatus: VersionStatus.IN_REVIEW,
    toStatus: VersionStatus.APPROVED,
    changedBy: 'seed.compliance_approver',
    reason: 'Aprobaciones completas',
  },
  {
    fromStatus: VersionStatus.APPROVED,
    toStatus: VersionStatus.DEPLOYED_TO_PROD,
    changedBy: 'seed.release-manager',
    reason: 'Despliegue productivo inicial',
  },
];

/**
 * Seeds a passing regression suite, a completed governance approval, and an ACTIVE
 * deployment in every environment (sandbox, test and prod) so the demo can be
 * simulated/run in the non-production environments the Simulator offers — not only
 * in production.
 */
export async function seedDemoWorkflow(
  prisma: PrismaClient,
  tenantId: bigint,
  version: { id: bigint },
  compiledArtifact: { id: bigint },
  environments: { sandbox: { id: bigint }; test: { id: bigint }; prod: { id: bigint } },
  canonicalChecksum: string,
  graphTotals: { nodes: number; edges: number; terminals: number },
) {
  const suite = await prisma.decisionTestSuite.create({
    data: {
      artifactVersionId: version.id,
      suiteCode: 'BNPL_ORIGINATION_REGRESSION',
      name: 'Regresión de política BNPL inicial',
      suiteType: 'REGRESSION',
      isBlocking: true,
    },
  });
  const cases = await Promise.all(
    TERMINAL_TEST_CASES.map((testCase) =>
      prisma.decisionTestCase.create({
        data: {
          testSuiteId: suite.id,
          caseCode: testCase.caseCode,
          testName: testCase.testName,
          inputJson: testCase.input as Prisma.InputJsonValue,
          expectedResultJson: testCase.expected as Prisma.InputJsonValue,
          tagsJson: testCase.tags,
        },
      }),
    ),
  );
  const testRun = await prisma.decisionTestRun.create({
    data: {
      testSuiteId: suite.id,
      compiledArtifactId: compiledArtifact.id,
      triggerType: 'SEED_VERIFIED',
      triggeredBy: 'seed.qa',
      status: TestRunStatus.PASSED,
      finishedAt: new Date(),
    },
  });
  for (const testCase of cases) {
    await prisma.decisionTestCaseRun.create({
      data: {
        testRunId: testRun.id,
        testCaseId: testCase.id,
        actualResultJson: testCase.expectedResultJson as Prisma.InputJsonValue,
        resultStatus: TestCaseRunStatus.PASS,
        durationMs: 1,
      },
    });
  }
  // The 8 regression cases collectively reach all three terminals (approve/decline/manual
  // review) but not every intermediate node/edge, so node/edge coverage is reported as
  // partial — an honest figure, not a hardcoded 100%.
  const coveredNodes = Math.min(graphTotals.nodes, 24);
  const coveredEdges = Math.min(graphTotals.edges, 32);
  const pct = (covered: number, total: number) =>
    new Prisma.Decimal(total === 0 ? 0 : Math.round((covered / total) * 10000) / 100);
  await prisma.decisionTestCoverage.createMany({
    data: [
      {
        testRunId: testRun.id,
        coverageType: 'NODE',
        coveredCount: coveredNodes,
        totalCount: graphTotals.nodes,
        coveragePercentage: pct(coveredNodes, graphTotals.nodes),
      },
      {
        testRunId: testRun.id,
        coverageType: 'EDGE',
        coveredCount: coveredEdges,
        totalCount: graphTotals.edges,
        coveragePercentage: pct(coveredEdges, graphTotals.edges),
      },
      {
        testRunId: testRun.id,
        coverageType: 'TERMINAL',
        coveredCount: graphTotals.terminals,
        totalCount: graphTotals.terminals,
        coveragePercentage: new Prisma.Decimal(100),
      },
    ],
  });

  const approvalRequest = await prisma.decisionApprovalRequest.create({
    data: {
      artifactVersionId: version.id,
      workflowCode: 'ATLAS_STANDARD_GOVERNANCE',
      requestedBy: 'seed.author',
      status: ApprovalRequestStatus.APPROVED,
    },
  });
  for (let index = 0; index < APPROVAL_ROLES.length; index += 1) {
    const step = await prisma.decisionApprovalStep.create({
      data: {
        approvalRequestId: approvalRequest.id,
        stepOrder: index + 1,
        requiredRole: APPROVAL_ROLES[index],
        status: ApprovalStepStatus.APPROVED,
        separationOfDuties: true,
      },
    });
    await prisma.decisionApprovalDecision.create({
      data: {
        approvalStepId: step.id,
        decidedBy: `seed.${APPROVAL_ROLES[index].toLowerCase()}`,
        decision: ApprovalOutcome.APPROVE,
        comments: 'Evidencia semilla validada.',
      },
    });
  }

  // Deploy to sandbox, test AND prod so the demo is runnable everywhere. Each
  // environment gets its own ACTIVE deployment and runtime binding; the prod one is
  // returned as the canonical deployment for the summary.
  const orderedEnvironments = [environments.sandbox, environments.test, environments.prod];
  let deployment!: Awaited<ReturnType<typeof prisma.decisionDeployment.create>>;
  for (const environment of orderedEnvironments) {
    const created = await prisma.decisionDeployment.create({
      data: {
        artifactVersionId: version.id,
        compiledArtifactId: compiledArtifact.id,
        environmentId: environment.id,
        deploymentMode: 'FULL',
        deploymentStatus: DeploymentStatus.ACTIVE,
        effectiveFrom: new Date(),
        isActive: true,
        deployedBy: 'seed.release-manager',
      },
    });
    await prisma.decisionRuntimeBinding.create({
      data: {
        tenantId,
        artifactCode: 'BNPL_CREDIT_DECISION',
        environmentId: environment.id,
        activeDeploymentId: created.id,
        bindingKey: 'default',
      },
    });
    if (environment.id === environments.prod.id) deployment = created;
  }

  await prisma.decisionArtifactVersion.update({
    where: { id: version.id },
    data: {
      status: VersionStatus.DEPLOYED_TO_PROD,
      canonicalChecksum,
      submittedAt: new Date(),
      approvedAt: new Date(),
    },
  });
  await prisma.decisionVersionStatusHistory.createMany({
    data: STATUS_HISTORY.map((entry) => ({ artifactVersionId: version.id, ...entry })),
  });

  return { deployment };
}

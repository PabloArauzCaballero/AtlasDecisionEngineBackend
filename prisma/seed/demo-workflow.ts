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

const TERMINAL_TEST_CASES = [
  { caseCode: 'APPROVE_LOW_RISK', testName: 'Aprueba solicitante verificado y de bajo riesgo', input: { kyc_status: 'VERIFIED', consent_active: true, age: 30, fraud_signal: false, bureau_score: 760, monthly_income: 8000, requested_amount: 2500 }, expected: { outcome: 'APPROVED', riskBand: 'LOW', limit: 2800 }, tags: ['happy-path', 'approval'] },
  { caseCode: 'DECLINE_KYC', testName: 'Rechaza KYC no verificado', input: { kyc_status: 'PENDING', consent_active: true, age: 30, fraud_signal: false, bureau_score: 760, monthly_income: 8000, requested_amount: 2500 }, expected: { outcome: 'DECLINED', reasonCodes: ['KYC_OR_CONSENT_INVALID'] }, tags: ['negative', 'kyc'] },
  { caseCode: 'MANUAL_FRAUD_REVIEW', testName: 'Deriva señal de fraude a revisión manual', input: { kyc_status: 'VERIFIED', consent_active: true, age: 30, fraud_signal: true, bureau_score: 760, monthly_income: 8000, requested_amount: 2500 }, expected: { outcome: 'MANUAL_REVIEW', reasonCodes: ['FRAUD_REVIEW_REQUIRED'] }, tags: ['manual-review', 'fraud'] },
  { caseCode: 'DECLINE_RISK', testName: 'Rechaza puntaje inferior al umbral', input: { kyc_status: 'VERIFIED', consent_active: true, age: 30, fraud_signal: false, bureau_score: 500, monthly_income: 8000, requested_amount: 2500 }, expected: { outcome: 'DECLINED', reasonCodes: ['RISK_THRESHOLD_NOT_MET'] }, tags: ['negative', 'risk'] },
];

const APPROVAL_ROLES = ['QA_APPROVER', 'RISK_APPROVER', 'COMPLIANCE_APPROVER'];

const STATUS_HISTORY = [
  { fromStatus: null, toStatus: VersionStatus.DRAFT, changedBy: 'seed.system', reason: 'Versión creada' },
  { fromStatus: VersionStatus.DRAFT, toStatus: VersionStatus.VALIDATED, changedBy: 'seed.qa', reason: 'Grafo válido' },
  { fromStatus: VersionStatus.VALIDATED, toStatus: VersionStatus.COMPILED, changedBy: 'seed.compiler', reason: 'Compilación determinista exitosa' },
  { fromStatus: VersionStatus.COMPILED, toStatus: VersionStatus.IN_REVIEW, changedBy: 'seed.author', reason: 'Enviado a gobierno' },
  { fromStatus: VersionStatus.IN_REVIEW, toStatus: VersionStatus.APPROVED, changedBy: 'seed.compliance_approver', reason: 'Aprobaciones completas' },
  { fromStatus: VersionStatus.APPROVED, toStatus: VersionStatus.DEPLOYED_TO_PROD, changedBy: 'seed.release-manager', reason: 'Despliegue productivo inicial' },
];

/** Seeds a passing regression suite, a completed governance approval, and an active PROD deployment. */
export async function seedDemoWorkflow(
  prisma: PrismaClient,
  tenantId: bigint,
  version: { id: bigint },
  compiledArtifact: { id: bigint },
  prodEnvironment: { id: bigint },
  canonicalChecksum: string,
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
  const cases = await Promise.all(TERMINAL_TEST_CASES.map((testCase) => prisma.decisionTestCase.create({
    data: {
      testSuiteId: suite.id,
      caseCode: testCase.caseCode,
      testName: testCase.testName,
      inputJson: testCase.input,
      expectedResultJson: testCase.expected,
      tagsJson: testCase.tags,
    },
  })));
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
  await prisma.decisionTestCoverage.createMany({
    data: [
      { testRunId: testRun.id, coverageType: 'NODE', coveredCount: 11, totalCount: 11, coveragePercentage: new Prisma.Decimal(100) },
      { testRunId: testRun.id, coverageType: 'EDGE', coveredCount: 10, totalCount: 10, coveragePercentage: new Prisma.Decimal(100) },
      { testRunId: testRun.id, coverageType: 'TERMINAL', coveredCount: 5, totalCount: 5, coveragePercentage: new Prisma.Decimal(100) },
    ],
  });

  const approvalRequest = await prisma.decisionApprovalRequest.create({
    data: { artifactVersionId: version.id, workflowCode: 'ATLAS_STANDARD_GOVERNANCE', requestedBy: 'seed.author', status: ApprovalRequestStatus.APPROVED },
  });
  for (let index = 0; index < APPROVAL_ROLES.length; index += 1) {
    const step = await prisma.decisionApprovalStep.create({
      data: { approvalRequestId: approvalRequest.id, stepOrder: index + 1, requiredRole: APPROVAL_ROLES[index], status: ApprovalStepStatus.APPROVED, separationOfDuties: true },
    });
    await prisma.decisionApprovalDecision.create({
      data: { approvalStepId: step.id, decidedBy: `seed.${APPROVAL_ROLES[index].toLowerCase()}`, decision: ApprovalOutcome.APPROVE, comments: 'Evidencia semilla validada.' },
    });
  }

  const deployment = await prisma.decisionDeployment.create({
    data: {
      artifactVersionId: version.id,
      compiledArtifactId: compiledArtifact.id,
      environmentId: prodEnvironment.id,
      deploymentMode: 'FULL',
      deploymentStatus: DeploymentStatus.ACTIVE,
      effectiveFrom: new Date(),
      isActive: true,
      deployedBy: 'seed.release-manager',
    },
  });
  await prisma.decisionRuntimeBinding.create({
    data: { tenantId, artifactCode: 'BNPL_CREDIT_DECISION', environmentId: prodEnvironment.id, activeDeploymentId: deployment.id, bindingKey: 'default' },
  });

  await prisma.decisionArtifactVersion.update({
    where: { id: version.id },
    data: { status: VersionStatus.DEPLOYED_TO_PROD, canonicalChecksum, submittedAt: new Date(), approvedAt: new Date() },
  });
  await prisma.decisionVersionStatusHistory.createMany({
    data: STATUS_HISTORY.map((entry) => ({ artifactVersionId: version.id, ...entry })),
  });

  return { deployment };
}

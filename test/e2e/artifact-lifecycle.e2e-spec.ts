import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';
import { seededVariableVersionId } from './support/seeded-variables';

/**
 * Exercises the full authoring-to-production golden path against a real Postgres/Redis:
 * create artifact -> author graph -> validate -> compile -> test suite -> governance
 * approval (with separation of duties) -> deployment. Each run uses a unique artifact
 * code so it can be re-run against persistent data without colliding with prior runs.
 */
describe('Artifact lifecycle (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const artifactCode = `E2E_LIFECYCLE_${runId}`;
  const author = managementHeaders('e2e.author', ['RISK_ANALYST']);
  const qaApprover = managementHeaders('e2e.qa-approver', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.risk-approver', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.platform-admin', ['PLATFORM_ADMIN']);

  let versionId: string;
  let ageVariableVersionId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds the seeded "age" variable to use as a graph dependency', async () => {
    ageVariableVersionId = await seededVariableVersionId(app, author, 'age');
    expect(ageVariableVersionId).toBeTruthy();
  });

  it('creates an artifact with an initial DRAFT version', async () => {
    const response = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E lifecycle artifact',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Exercises the full lifecycle end to end.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    expect(response.body.artifactCode).toBe(artifactCode);
    expect(response.body.versions).toHaveLength(1);
    expect(response.body.versions[0].status).toBe('DRAFT');
    versionId = response.body.versions[0].id;
  });

  it('rejects a graph write without If-Match', async () => {
    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set(author)
      .send({
        dependencies: [],
        conditions: [],
        actions: [],
        nodes: [
          {
            key: 'START',
            type: 'START',
            label: 'Start',
            config: {},
            x: 0,
            y: 0,
            order: 1,
            terminal: false,
            conditions: [],
            actions: [],
          },
        ],
        edges: [],
      })
      .expect(428);
  });

  it('replaces the draft graph with a minimal age-eligibility decision', async () => {
    const body = {
      dependencies: [
        {
          variableVersionId: ageVariableVersionId,
          usageType: 'INPUT',
          isRequired: true,
          fallbackPolicy: 'FAIL_CLOSED',
          dependencyPath: 'input.age',
        },
      ],
      conditions: [
        {
          code: 'AGE_OK',
          name: 'Age is at least 21',
          expressionType: 'JSON_AST',
          expression: { op: 'gte', left: { var: 'age' }, right: { value: 21 } },
          severity: 'BLOCKING',
          reusable: true,
        },
      ],
      actions: [
        {
          code: 'SET_APPROVED',
          type: 'SET_OUTCOME',
          payload: { outcome: 'APPROVED' },
          terminal: true,
          reasonCodes: [],
        },
        {
          code: 'SET_DECLINED',
          type: 'SET_OUTCOME',
          payload: { outcome: 'DECLINED' },
          terminal: true,
          reasonCodes: [],
        },
      ],
      nodes: [
        {
          key: 'START',
          type: 'START',
          label: 'Start',
          config: {},
          x: 0,
          y: 0,
          order: 1,
          terminal: false,
          conditions: [],
          actions: [],
        },
        {
          key: 'CHECK',
          type: 'CONDITION',
          label: 'Check age',
          config: {},
          x: 100,
          y: 0,
          order: 2,
          terminal: false,
          conditions: [],
          actions: [],
        },
        {
          key: 'APPROVE',
          type: 'ACTION',
          label: 'Approve',
          config: {},
          x: 200,
          y: -50,
          order: 3,
          terminal: true,
          conditions: [],
          actions: [{ actionCode: 'SET_APPROVED', order: 1 }],
        },
        {
          key: 'DECLINE',
          type: 'ACTION',
          label: 'Decline',
          config: {},
          x: 200,
          y: 50,
          order: 4,
          terminal: true,
          conditions: [],
          actions: [{ actionCode: 'SET_DECLINED', order: 1 }],
        },
      ],
      edges: [
        {
          key: 'START_CHECK',
          from: 'START',
          to: 'CHECK',
          type: 'DEFAULT',
          priority: 1,
          default: true,
          conditions: [],
        },
        {
          key: 'CHECK_APPROVE',
          from: 'CHECK',
          to: 'APPROVE',
          type: 'CONDITIONAL',
          priority: 1,
          default: false,
          conditions: [{ conditionCode: 'AGE_OK', order: 1 }],
        },
        {
          key: 'CHECK_DECLINE',
          from: 'CHECK',
          to: 'DECLINE',
          type: 'DEFAULT',
          priority: 999,
          default: true,
          conditions: [],
        },
      ],
    };
    const response = await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send(body)
      .expect(200);
    expect(response.body.status).toBe('DRAFT');
    expect(response.body.lockVersion).toBe(2);
  });

  it('validates the graph deterministically', async () => {
    const response = await request(server())
      .post(`/v1/artifact-versions/${versionId}/validate`)
      .set(author)
      .expect(201);
    expect(response.body.valid).toBe(true);
    expect(response.body.metrics.terminalPathCount).toBe(2);
  });

  it('compiles the validated graph', async () => {
    const response = await request(server())
      .post(`/v1/artifact-versions/${versionId}/compile`)
      .set(author)
      .expect(201);
    expect(response.body.compileStatus).toBe('SUCCESS');
  });

  it('creates and runs a blocking regression suite covering every terminal path', async () => {
    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESSION`,
        name: 'Age eligibility regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'APPROVE_ADULT',
            testName: 'Approves an adult',
            input: { age: 30 },
            expectedResult: { outcome: 'APPROVED' },
          },
          {
            caseCode: 'DECLINE_YOUNG_ADULT',
            testName: 'Declines a young adult under 21',
            input: { age: 19 },
            expectedResult: { outcome: 'DECLINED' },
          },
        ],
      })
      .expect(201);

    const queued = await request(server())
      .post(`/v1/test-suites/${suite.body.id}/runs`)
      .set(author)
      .send({})
      .expect(202);
    expect(queued.body.status).toBe('QUEUED');
    expect(queued.body.caseRuns).toEqual([]);

    const deadline = Date.now() + 15_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(run.body.status).toBe('PASSED');
    const nodeCoverage = run.body.coverage.find(
      (item: { coverageType: string }) => item.coverageType === 'NODE',
    );
    expect(Number(nodeCoverage.coveragePercentage)).toBe(100);
  }, 20_000);

  it('submits for governed review and rejects self-approval', async () => {
    const submitted = await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    expect(submitted.body.status).toBe('IN_REVIEW');

    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    expect(qaStep.requiredRole).toBe('QA_ANALYST');
    expect(riskStep.requiredRole).toBe('RISK_APPROVER');

    await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(managementHeaders('e2e.author', ['QA_ANALYST']))
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(403);

    const qaDecision = await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(qaApprover)
      .send({ decision: 'APPROVE', comments: 'Looks correct', evidence: [] })
      .expect(201);
    expect(qaDecision.body.decision).toBe('APPROVE');

    const riskDecision = await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    expect(riskDecision.body.decision).toBe('APPROVE');

    const version = await request(server())
      .get(`/v1/artifact-versions/${versionId}`)
      .set(author)
      .expect(200);
    expect(version.body.status).toBe('APPROVED');
  });

  it('deploys the approved version to DEV', async () => {
    const response = await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({
        environmentCode: 'DEV',
        deploymentMode: 'DIRECT',
        traffic: [],
      })
      .expect(201);
    expect(response.body.deploymentStatus).toBe('ACTIVE');
    expect(response.body.isActive).toBe(true);
  });
});

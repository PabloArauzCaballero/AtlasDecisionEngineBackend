import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';
import { seededVariableVersionId } from './support/seeded-variables';

/**
 * Exercises nested decision trees end to end (Fase 7): compile a child artifact,
 * reference it from a parent's RESULT node (mode=REFERENCE), and confirm the
 * simulator's output actually threads through the nested execution.
 */
describe('Nested decision trees (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const childCode = `E2E_NESTED_CHILD_${runId}`;
  const parentCode = `E2E_NESTED_PARENT_${runId}`;
  const author = managementHeaders('e2e.nested-author', ['RISK_ANALYST']);
  const qaApprover = managementHeaders('e2e.nested-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.nested-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.nested-deployer', ['PLATFORM_ADMIN']);

  let ageVariableVersionId: string;
  let childArtifactId: string;
  let childVersionId: string;
  let parentArtifactId: string;
  let parentVersionId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds the seeded "age" variable', async () => {
    ageVariableVersionId = await seededVariableVersionId(app, author, 'age');
    expect(ageVariableVersionId).toBeTruthy();
  });

  it('creates and compiles the child artifact (age-eligibility)', async () => {
    const created = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: childCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E nested child',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Child artifact referenced by a parent nested decision tree.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    childArtifactId = created.body.id;
    childVersionId = created.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${childVersionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send({
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
            name: 'Age at least 21',
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
      })
      .expect(200);

    await request(server())
      .post(`/v1/artifact-versions/${childVersionId}/validate`)
      .set(author)
      .expect(201);
    const compiled = await request(server())
      .post(`/v1/artifact-versions/${childVersionId}/compile`)
      .set(author)
      .expect(201);
    expect(compiled.body.compileStatus).toBe('SUCCESS');
  });

  const outputVariableCode = `nestedChildOutcome_${runId}`;

  it('creates the parent artifact with a REFERENCE-mode RESULT node (still DRAFT)', async () => {
    const outputVariable = await request(server())
      .post('/v1/variables')
      .set(author)
      .send({
        variableCode: outputVariableCode,
        canonicalName: 'Nested child outcome',
        businessDescription: 'Outcome pulled from a nested artifact reference.',
        dataClassification: 'INTERNAL',
        ownerTeam: 'RISK_DECISIONING',
        isSensitive: false,
        initialVersion: { dataType: 'STRING', nullable: false, sources: [], validationRules: [] },
      })
      .expect(201);
    const outputVariableVersionId = outputVariable.body.versions[0].id;

    const created = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: parentCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E nested parent',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Parent artifact that nests a decision tree reference.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    parentArtifactId = created.body.id;
    parentVersionId = created.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${parentVersionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send({
        dependencies: [
          {
            variableVersionId: ageVariableVersionId,
            usageType: 'INPUT',
            isRequired: true,
            fallbackPolicy: 'FAIL_CLOSED',
            dependencyPath: 'input.age',
          },
          {
            variableVersionId: outputVariableVersionId,
            usageType: 'OUTPUT_PRIMARY',
            isRequired: true,
            fallbackPolicy: 'FAIL_CLOSED',
            dependencyPath: `output.${outputVariableCode}`,
          },
        ],
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
          {
            key: 'NESTED_CHECK',
            type: 'RESULT',
            label: 'Nested eligibility check',
            config: {
              mode: 'REFERENCE',
              outputAssignments: [{ outputCode: outputVariableCode, childOutputCode: 'outcome' }],
            }, // childOutputCode must match the reference's outputMapping allowlist above
            x: 100,
            y: 0,
            order: 2,
            terminal: true,
            conditions: [],
            actions: [],
          },
        ],
        edges: [
          {
            key: 'START_NESTED',
            from: 'START',
            to: 'NESTED_CHECK',
            type: 'DEFAULT',
            priority: 1,
            default: true,
            conditions: [],
          },
        ],
      })
      .expect(200);
  });

  it('rejects a self-reference on the still-DRAFT parent version', async () => {
    await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/references`)
      .set(author)
      .send({
        nodeKey: 'NESTED_CHECK',
        childArtifactId: parentArtifactId,
        childArtifactVersionId: parentVersionId,
        inputMapping: [],
        outputMapping: [],
      })
      .expect(400);
  });

  it('rejects referencing a child version with no successful compiled artifact', async () => {
    const draftChild = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: `${childCode}_UNCOMPILED`,
        artifactType: 'CREDIT_POLICY',
        name: 'Uncompiled child',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Never compiled; must be rejected as a reference target.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);

    await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/references`)
      .set(author)
      .send({
        nodeKey: 'NESTED_CHECK',
        childArtifactId: draftChild.body.id,
        childArtifactVersionId: draftChild.body.versions[0].id,
        inputMapping: [],
        outputMapping: [],
      })
      .expect(409);
  });

  it('creates the real reference to the compiled child', async () => {
    const response = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/references`)
      .set(author)
      .send({
        nodeKey: 'NESTED_CHECK',
        childArtifactId,
        childArtifactVersionId: childVersionId,
        inputMapping: [{ childVariableCode: 'age', source: 'VARIABLE', path: 'age' }],
        outputMapping: [{ childOutputCode: 'outcome' }],
        timeoutMs: 2000,
        onErrorPolicy: 'FAIL',
      })
      .expect(201);
    expect(response.body.nodeKey).toBe('NESTED_CHECK');
  });

  it('lists the reference and the dependency graph', async () => {
    const list = await request(server())
      .get(`/v1/artifact-versions/${parentVersionId}/references`)
      .set(author)
      .expect(200);
    expect(list.body).toHaveLength(1);

    const graph = await request(server())
      .get(`/v1/artifacts/${parentArtifactId}/dependency-graph`)
      .set(author)
      .expect(200);
    expect(graph.body.edges).toEqual([
      expect.objectContaining({ parentArtifactId, childArtifactId }),
    ]);
  });

  it('validates and compiles the parent now that its reference is wired', async () => {
    const validated = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/validate`)
      .set(author)
      .expect(201);
    expect(validated.body.valid).toBe(true);

    const compiled = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/compile`)
      .set(author)
      .expect(201);
    expect(compiled.body.compileStatus).toBe('SUCCESS');
  });

  it('passes a blocking regression suite so the parent can enter governance', async () => {
    const suite = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${parentCode}_REGRESSION`,
        name: 'Nested reference regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'APPROVE_ADULT',
            testName: 'Nested-approves an adult',
            input: { age: 30 },
            expectedResult: { [outputVariableCode]: 'APPROVED' },
          },
          {
            caseCode: 'DECLINE_YOUNG_ADULT',
            testName: 'Nested-declines a young adult under 21',
            input: { age: 19 },
            expectedResult: { [outputVariableCode]: 'DECLINED' },
          },
        ],
      })
      .expect(201);

    const queued = await request(server())
      .post(`/v1/test-suites/${suite.body.id}/runs`)
      .set(author)
      .send({})
      .expect(202);

    const deadline = Date.now() + 15_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(run.body.status).toBe('PASSED');
  }, 20_000);

  it('governs and deploys the parent to SANDBOX', async () => {
    const submitted = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(qaApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);

    const deployed = await request(server())
      .post(`/v1/artifact-versions/${parentVersionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'SANDBOX', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);
    expect(deployed.body.deploymentStatus).toBe('ACTIVE');
  });

  it('executes the parent through the simulator and threads the nested output through', async () => {
    const response = await request(server())
      .post(`/v1/simulations/${parentCode}`)
      .set(author)
      .send({
        requestId: `nested-sim-${runId}`,
        environmentCode: 'SANDBOX',
        variables: { age: 30 },
      })
      .expect(201);

    expect(response.body.output[outputVariableCode]).toBe('APPROVED');
    expect(response.body.trace.nested).toEqual([
      expect.objectContaining({
        nodeKey: 'NESTED_CHECK',
        status: 'SUCCEEDED',
        childArtifactVersionId: childVersionId,
      }),
    ]);
  });

  it('threads a DECLINED nested outcome through for an ineligible age', async () => {
    const response = await request(server())
      .post(`/v1/simulations/${parentCode}`)
      .set(author)
      .send({
        requestId: `nested-sim-decline-${runId}`,
        environmentCode: 'SANDBOX',
        variables: { age: 19 },
      })
      .expect(201);

    expect(response.body.output[outputVariableCode]).toBe('DECLINED');
  });
});

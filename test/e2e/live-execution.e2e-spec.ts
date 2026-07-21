import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Exercises live execution (Fase 8) end to end: a real deployed artifact
 * streams node-by-node progress over SSE while it actually executes.
 */
describe('Live execution (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const author = managementHeaders('e2e.live-execution-author', ['RISK_ANALYST']);
  const qaApprover = managementHeaders('e2e.live-execution-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.live-execution-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.live-execution-deployer', ['PLATFORM_ADMIN']);

  let artifactCode: string;

  function parseSseEvents(raw: string): Array<{ type: string; data: unknown }> {
    return raw
      .split('\n\n')
      .filter((frame) => frame.trim())
      .map((frame) => {
        const type = /^event: (.+)$/m.exec(frame)?.[1] ?? 'message';
        const dataLine = /^data: (.+)$/m.exec(frame)?.[1] ?? '{}';
        return { type, data: JSON.parse(dataLine) };
      });
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('deploys an age-eligibility artifact to SANDBOX', async () => {
    const ageVariable = await request(server())
      .get('/v1/variables')
      .query({ search: 'age', pageSize: 5 })
      .set(author)
      .expect(200);
    const ageVariableVersionId = ageVariable.body.items.find(
      (item: { variableCode: string }) => item.variableCode === 'age',
    ).versions[0].id;

    artifactCode = `E2E_LIVE_EXECUTION_${runId}`;
    const created = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E live execution',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifies live execution streams real node progress.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    const versionId = created.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send({
        dependencies: [
          { variableVersionId: ageVariableVersionId, usageType: 'INPUT', isRequired: true, fallbackPolicy: 'FAIL_CLOSED', dependencyPath: 'input.age' },
        ],
        conditions: [
          { code: 'AGE_OK', name: 'Age at least 21', expressionType: 'JSON_AST', expression: { op: 'gte', left: { var: 'age' }, right: { value: 21 } }, severity: 'BLOCKING', reusable: true },
        ],
        actions: [
          { code: 'SET_APPROVED', type: 'SET_OUTCOME', payload: { outcome: 'APPROVED' }, terminal: true, reasonCodes: [] },
          { code: 'SET_DECLINED', type: 'SET_OUTCOME', payload: { outcome: 'DECLINED' }, terminal: true, reasonCodes: [] },
        ],
        nodes: [
          { key: 'START', type: 'START', label: 'Start', config: {}, x: 0, y: 0, order: 1, terminal: false, conditions: [], actions: [] },
          { key: 'CHECK', type: 'CONDITION', label: 'Check age', config: {}, x: 100, y: 0, order: 2, terminal: false, conditions: [], actions: [] },
          { key: 'APPROVE', type: 'ACTION', label: 'Approve', config: {}, x: 200, y: -50, order: 3, terminal: true, conditions: [], actions: [{ actionCode: 'SET_APPROVED', order: 1 }] },
          { key: 'DECLINE', type: 'ACTION', label: 'Decline', config: {}, x: 200, y: 50, order: 4, terminal: true, conditions: [], actions: [{ actionCode: 'SET_DECLINED', order: 1 }] },
        ],
        edges: [
          { key: 'START_CHECK', from: 'START', to: 'CHECK', type: 'DEFAULT', priority: 1, default: true, conditions: [] },
          { key: 'CHECK_APPROVE', from: 'CHECK', to: 'APPROVE', type: 'CONDITIONAL', priority: 1, default: false, conditions: [{ conditionCode: 'AGE_OK', order: 1 }] },
          { key: 'CHECK_DECLINE', from: 'CHECK', to: 'DECLINE', type: 'DEFAULT', priority: 999, default: true, conditions: [] },
        ],
      })
      .expect(200);

    await request(server()).post(`/v1/artifact-versions/${versionId}/validate`).set(author).expect(201);
    await request(server()).post(`/v1/artifact-versions/${versionId}/compile`).set(author).expect(201);

    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESSION`,
        name: 'Live execution regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          { caseCode: 'ADULT', testName: 'Approves an adult', input: { age: 30 }, expectedResult: { outcome: 'APPROVED' } },
          { caseCode: 'YOUNG_ADULT', testName: 'Declines a young adult under 21', input: { age: 19 }, expectedResult: { outcome: 'DECLINED' } },
        ],
      })
      .expect(201);
    const queued = await request(server()).post(`/v1/test-suites/${suite.body.id}/runs`).set(author).send({}).expect(202);
    const deadline = Date.now() + 15_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(run.body.status).toBe('PASSED');

    const submitted = await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    await request(server()).post(`/v1/approval-steps/${qaStep.id}/decisions`).set(qaApprover).send({ decision: 'APPROVE', evidence: [] }).expect(201);
    await request(server()).post(`/v1/approval-steps/${riskStep.id}/decisions`).set(riskApprover).send({ decision: 'APPROVE', evidence: [] }).expect(201);
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'SANDBOX', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);
  }, 20_000);

  it('streams node-by-node progress and a final result over SSE', async () => {
    const response = await request(server())
      .get('/v1/live-executions/stream')
      .set(author)
      .query({
        artifactCode,
        environmentCode: 'SANDBOX',
        requestId: `live-exec-${runId}`,
        variables: JSON.stringify({ age: 30 }),
      })
      .expect(200);

    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSseEvents(response.text);
    const nodeSteps = events.filter((event) => event.type === 'node_step');
    expect(nodeSteps.map((event) => (event.data as { nodeKey: string }).nodeKey)).toEqual(
      expect.arrayContaining(['START', 'CHECK', 'APPROVE']),
    );
    const checkCompleted = nodeSteps.find(
      (event) => (event.data as { nodeKey: string; status: string }).nodeKey === 'CHECK' && (event.data as { status: string }).status === 'COMPLETED',
    );
    expect(checkCompleted?.data).toMatchObject({ branchTaken: 'CHECK_APPROVE', discardedEdgeKeys: ['CHECK_DECLINE'] });

    const completed = events.find((event) => event.type === 'execution_completed');
    expect(completed?.data).toMatchObject({ outcome: 'APPROVED' });
  });

  it('rejects PROD to keep this a dry-run preview tool, same as the simulator', async () => {
    const response = await request(server())
      .get('/v1/live-executions/stream')
      .set(author)
      .query({
        artifactCode,
        environmentCode: 'PROD',
        requestId: `live-exec-prod-${runId}`,
        variables: JSON.stringify({ age: 30 }),
      })
      .expect(200);
    // The SSE handshake itself returns 200 (headers are sent before the handler's
    // Observable runs); the rejection arrives as an execution_failed frame instead.
    const events = parseSseEvents(response.text);
    expect(events).toEqual([
      { type: 'execution_failed', data: expect.objectContaining({ code: 'LIVE_EXECUTION_PROD_FORBIDDEN' }) },
    ]);
  });
});

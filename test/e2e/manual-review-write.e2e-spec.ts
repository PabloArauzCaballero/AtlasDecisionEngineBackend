import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { artifactCreatorHeaders, managementHeaders, runtimeHeaders } from './support/headers';

/**
 * Cubre las dos rutas de trabajo sobre un caso de revisión manual que no tenían ninguna
 * prueba que las citara por su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - POST /v1/manual-reviews/:caseId/assign
 *  - POST /v1/manual-reviews/:caseId/resolve
 *
 * El caso no se inserta a mano: se produce ejecutando una decisión real contra un
 * artefacto con un nodo `MANUAL_REVIEW` (`execution-engine.service.ts`), que es la única
 * forma en que el producto crea hoy una fila en `decisionManualReviewCase` — un nodo
 * `SET_OUTCOME` que escribe el texto "MANUAL_REVIEW" en una variable (como hace el
 * artefacto de demostración `BNPL_CREDIT_DECISION`) NO abre ningún caso.
 */
describe('Manual review · write routes (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const artifactCode = `E2E_MANUAL_REVIEW_${runId}`;
  // El pipeline de autoría (validate/compile/graph/test-suites) exige QA_ANALYST/FRAUD_ANALYST;
  // usamos el mismo cliente fijo `e2e.author` que ya usa `demo-artifact.ts`.
  const author = managementHeaders('e2e.author');
  const qaApprover = managementHeaders('e2e.manual-review-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.manual-review-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.manual-review-deployer', ['PLATFORM_ADMIN']);
  const analyst = managementHeaders('e2e.manual-review-analyst', ['OPERATIONS']);
  const outsider = managementHeaders('e2e.manual-review-outsider', ['QA_ANALYST']);

  async function provisionManualReviewArtifact(): Promise<void> {
    // `POST /v1/artifacts` exige un creador separado de quien despliega (SEPARATION_OF_DUTIES):
    // el mismo cliente fijo `artifactCreatorHeaders()` que ya usa `demo-artifact.ts`.
    const created = await request(server())
      .post('/v1/artifacts')
      .set(artifactCreatorHeaders())
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E manual review write routes',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Opens a real manual-review case to exercise assign/resolve.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    const versionId = created.body.versions[0].id as string;

    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
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
          {
            key: 'REVIEW',
            type: 'MANUAL_REVIEW',
            label: 'Revisión manual',
            config: { queueCode: 'CREDIT_REVIEW', priority: 50, slaMinutes: 60 },
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
            key: 'START_REVIEW',
            from: 'START',
            to: 'REVIEW',
            type: 'DEFAULT',
            priority: 1,
            default: true,
            conditions: [],
          },
        ],
      })
      .expect(200);

    await request(server())
      .post(`/v1/artifact-versions/${versionId}/validate`)
      .set(author)
      .expect(201);
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/compile`)
      .set(author)
      .expect(201);

    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESSION`,
        name: 'Manual review write-route regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'ALWAYS_REVIEW',
            testName: 'Always routes to manual review',
            input: {},
            expectedResult: { outcome: 'MANUAL_REVIEW' },
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

    const submitted = await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(qaApprover)
      .send({ decision: 'APPROVE', comments: 'Revisado en la prueba e2e.', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', comments: 'Revisado en la prueba e2e.', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'DEV', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);
  }

  async function openCase(subjectSuffix: string): Promise<string> {
    const decision = await request(server())
      .post(`/v1/decisions/${artifactCode}`)
      .set(runtimeHeaders('e2e.manual-review-runtime'))
      .send({
        requestId: `e2e-manual-review-${subjectSuffix}`,
        idempotencyKey: `e2e-manual-review-${subjectSuffix}`,
        subjectReference: `e2e-manual-review-subject-${subjectSuffix}`,
        environmentCode: 'DEV',
        variables: {},
      })
      .expect(200);
    expect(decision.body.outcome).toBe('MANUAL_REVIEW');

    const list = await request(server())
      .get('/v1/manual-reviews')
      .query({ pageSize: 100, queueCode: 'CREDIT_REVIEW' })
      .set(analyst)
      .expect(200);
    const items = list.body.items as Array<{ id: string; execution?: { requestId?: string } }>;
    const created = items.find(
      (item) => item.execution?.requestId === `e2e-manual-review-${subjectSuffix}`,
    );
    if (!created) throw new Error('La decisión no abrió ningún caso de revisión manual.');
    return created.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await provisionManualReviewArtifact();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/manual-reviews/:caseId/assign', () => {
    let caseId: string;

    beforeAll(async () => {
      caseId = await openCase(`assign-${runId}`);
    });

    it('rejects a role outside OPERATIONS/RISK_ANALYST/FRAUD_ANALYST with 403', async () => {
      await request(server())
        .post(`/v1/manual-reviews/${caseId}/assign`)
        .set(outsider)
        .send({})
        .expect(403);
    });

    it('lets an authorised analyst take the case', async () => {
      const response = await request(server())
        .post(`/v1/manual-reviews/${caseId}/assign`)
        .set(analyst)
        .send({})
        .expect(201);
      expect(response.body).toBeDefined();

      const detail = await request(server())
        .get(`/v1/manual-reviews/${caseId}`)
        .set(analyst)
        .expect(200);
      expect(detail.body.assignedTo).toBeTruthy();
    });
  });

  describe('POST /v1/manual-reviews/:caseId/resolve', () => {
    let caseId: string;

    beforeAll(async () => {
      caseId = await openCase(`resolve-${runId}`);
      await request(server())
        .post(`/v1/manual-reviews/${caseId}/assign`)
        .set(analyst)
        .send({})
        .expect(201);
    });

    it('rejects a role outside OPERATIONS/RISK_ANALYST/FRAUD_ANALYST with 403', async () => {
      await request(server())
        .post(`/v1/manual-reviews/${caseId}/resolve`)
        .set(outsider)
        .send({ decision: 'APPROVE', reason: 'No debería poder.' })
        .expect(403);
    });

    it('lets the assigned analyst resolve the case', async () => {
      const response = await request(server())
        .post(`/v1/manual-reviews/${caseId}/resolve`)
        .set(analyst)
        .send({ decision: 'APPROVE', reason: 'Verificado por la batería de rutas de escritura.' })
        .expect(201);
      expect(response.body).toBeDefined();

      const detail = await request(server())
        .get(`/v1/manual-reviews/${caseId}`)
        .set(analyst)
        .expect(200);
      expect(detail.body.status).toBe('RESOLVED_APPROVED');
    });
  });
});

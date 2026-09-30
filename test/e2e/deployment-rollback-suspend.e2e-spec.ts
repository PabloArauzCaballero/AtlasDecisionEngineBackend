import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { artifactCreatorHeaders, managementHeaders } from './support/headers';
import { seededVariableVersionId } from './support/seeded-variables';

/**
 * Cubre las dos rutas de gobierno de despliegues que no tenían ninguna prueba que las
 * citara por su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - POST /v1/deployments/:deploymentId/rollback
 *  - POST /v1/deployments/:deploymentId/suspend
 *
 * Ambas exigen `PLATFORM_ADMIN`. El rollback necesita, además, un DESPLIEGUE PREDECESOR:
 * `DeploymentService.rollback` responde `ROLLBACK_TARGET_NOT_FOUND` si no lo hay. Por eso
 * esta suite despliega la misma versión dos veces sobre DEV: primero una versión, luego un
 * clon aprobado de esa misma versión — exactamente el camino real que produce un
 * `previousDeploymentId`, no un `INSERT` a mano.
 */
describe('Deployment rollback & suspend (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const artifactCode = `E2E_DEPLOY_WRITE_${runId}`;
  // El pipeline de autoría (validate/compile/graph/test-suites) exige QA_ANALYST/FRAUD_ANALYST;
  // usamos el mismo cliente fijo `e2e.author` que ya usa `demo-artifact.ts`.
  const author = managementHeaders('e2e.author');
  const qaApprover = managementHeaders('e2e.deploy-write-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.deploy-write-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.deploy-write-admin', ['PLATFORM_ADMIN']);
  const outsider = managementHeaders('e2e.deploy-write-outsider', ['RISK_ANALYST']);

  let ageVariableVersionId: string;
  let firstDeploymentId: string;
  let secondDeploymentId: string;

  async function approveAndDeploy(versionId: string): Promise<string> {
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
        suiteCode: `${artifactCode}_${versionId}_REGRESSION`,
        name: 'Deployment write-route regression',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'ADULT',
            testName: 'Approves an adult',
            input: { age: 30 },
            expectedResult: { outcome: 'APPROVED' },
          },
          {
            caseCode: 'YOUNG_ADULT',
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
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    const deployed = await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'DEV', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);
    return deployed.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ageVariableVersionId = await seededVariableVersionId(app, author, 'age');

    // `POST /v1/artifacts` exige un creador separado de quien despliega (SEPARATION_OF_DUTIES):
    // el mismo cliente fijo `artifactCreatorHeaders()` que ya usa `demo-artifact.ts`.
    const created = await request(server())
      .post('/v1/artifacts')
      .set(artifactCreatorHeaders())
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E deployment write routes',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Exercises POST /deployments/:id/rollback and /suspend for real.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    const firstVersionId = created.body.versions[0].id as string;

    await request(server())
      .put(`/v1/artifact-versions/${firstVersionId}/graph`)
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

    firstDeploymentId = await approveAndDeploy(firstVersionId);

    // Clona la MISMA versión ya aprobada: hereda el grafo, así que no hace falta reescribirlo.
    // `RISK_ANALYST` clona pero `PLATFORM_ADMIN` despliega, igual que arriba, porque
    // `deploy()` rechaza que el autor de la versión sea quien la publica.
    const cloned = await request(server())
      .post(`/v1/artifact-versions/${firstVersionId}/clone`)
      .set(author)
      .send({ changeSummary: 'Segunda versión para ejercitar rollback/suspend.' })
      .expect(201);
    const secondVersionId = cloned.body.id as string;
    secondDeploymentId = await approveAndDeploy(secondVersionId);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/deployments/:deploymentId/suspend', () => {
    it('rejects a role without PLATFORM_ADMIN with 403', async () => {
      await request(server())
        .post(`/v1/deployments/${firstDeploymentId}/suspend`)
        .set(outsider)
        .send({ reason: 'No debería poder.' })
        .expect(403);
    });

    it('suspends the older, already-superseded deployment for PLATFORM_ADMIN', async () => {
      const response = await request(server())
        .post(`/v1/deployments/${firstDeploymentId}/suspend`)
        .set(deployer)
        .send({ reason: 'Suspendido por la batería de rutas de escritura.' })
        .expect(201);
      expect(response.body).toBeDefined();

      const history = await request(server())
        .get('/v1/deployments')
        .query({ artifactCode, pageSize: 20 })
        .set(deployer)
        .expect(200);
      const suspended = (
        history.body.items as Array<{ id: string; deploymentStatus: string }>
      ).find((item) => item.id === firstDeploymentId);
      expect(suspended?.deploymentStatus).toBe('SUSPENDED');
    });
  });

  describe('POST /v1/deployments/:deploymentId/rollback', () => {
    it('rejects a role without PLATFORM_ADMIN with 403', async () => {
      await request(server())
        .post(`/v1/deployments/${secondDeploymentId}/rollback`)
        .set(outsider)
        .send({ reason: 'No debería poder.' })
        .expect(403);
    });

    it('rolls the active deployment back to its predecessor for PLATFORM_ADMIN', async () => {
      const response = await request(server())
        .post(`/v1/deployments/${secondDeploymentId}/rollback`)
        .set(deployer)
        .send({ reason: 'Revertido por la batería de rutas de escritura.' })
        .expect(201);
      expect(response.body.rolledBackDeploymentId).toBe(secondDeploymentId);

      const history = await request(server())
        .get('/v1/deployments')
        .query({ artifactCode, pageSize: 20 })
        .set(deployer)
        .expect(200);
      const items = history.body.items as Array<{ id: string; deploymentStatus: string }>;
      const rolledBack = items.find((item) => item.id === secondDeploymentId);
      expect(rolledBack?.deploymentStatus).toBe('ROLLED_BACK');
    });
  });
});

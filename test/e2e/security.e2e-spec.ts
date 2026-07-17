import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

describe('Security guards (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects an invalid API key with 401', async () => {
    await request(server())
      .get('/v1/artifacts')
      .set({ 'x-api-key': 'not-the-real-key', 'x-tenant-id': '1', 'x-principal-id': 'attacker' })
      .expect(401);
  });

  it('rejects an API key that is not registered, even with a well-formed context', async () => {
    await request(server())
      .get('/v1/artifacts')
      .set({ 'x-api-key': 'unregistered-key-0123456789abcdef', 'x-tenant-id': '1' })
      .expect(401);
  });

  it('refuses a tenant the credential is not authorised for', async () => {
    await request(server())
      .get('/v1/artifacts')
      .set({ ...managementHeaders('e2e.security', []), 'x-tenant-id': '424242' })
      .expect(403);
  });

  it('ignores roles a caller declares through x-roles', async () => {
    // The auditor credential must stay an auditor no matter what the request claims.
    await request(server())
      .post('/v1/artifacts')
      .set({ ...managementHeaders('e2e.security', ['AUDITOR']), 'x-roles': 'PLATFORM_ADMIN' })
      .send({
        artifactCode: 'SHOULD_NOT_BE_CREATED_VIA_HEADER',
        artifactType: 'CREDIT_POLICY',
        name: 'x',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'x',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(403);
  });

  it('rejects a role without permission for the route with 403', async () => {
    await request(server())
      .post('/v1/artifacts')
      .set(managementHeaders('e2e.security', ['AUDITOR']))
      .send({
        artifactCode: 'SHOULD_NOT_BE_CREATED',
        artifactType: 'CREDIT_POLICY',
        name: 'x',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'x',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(403);
  });

  it('rejects a graph payload exceeding the array size caps with 400', async () => {
    const dependencies = Array.from({ length: 201 }, (_, index) => ({
      variableVersionId: '1',
      usageType: 'INPUT',
      isRequired: true,
      fallbackPolicy: 'FAIL_CLOSED',
      dependencyPath: `input.v${index}`,
    }));
    await request(server())
      .put('/v1/artifact-versions/999999999999/graph')
      .set({ ...managementHeaders('e2e.security', ['RISK_ANALYST']), 'if-match': '1' })
      .send({
        dependencies,
        conditions: [],
        actions: [],
        nodes: [{ key: 'START', type: 'START', label: 'Start', config: {}, x: 0, y: 0, order: 1, terminal: false, conditions: [], actions: [] }],
        edges: [],
      })
      .expect(400);
  });
});

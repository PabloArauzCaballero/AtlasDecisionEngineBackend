import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Guards run before interceptors, so 401/403 rejections never
 * reached the access audit interceptor and left no trace at all. They must be persisted.
 */
describe('Access denial auditing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function denialsFor(requestId: string) {
    // The audit write is fire-and-forget, so give it a moment to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    return prisma.decisionAccessAudit.findMany({ where: { requestId, decision: 'DENY' } });
  }

  it('records a 401 from an unregistered API key, with no principal attached', async () => {
    const requestId = `e2e-deny-401-${Date.now()}`;
    await request(server())
      .get('/v1/artifacts')
      .set({ 'x-api-key': 'unregistered-key-0123456789abcdef', 'x-request-id': requestId })
      .expect(401);

    const rows = await denialsFor(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(401);
    // A 401 never established an identity, so these must be null rather than invented.
    expect(rows[0]?.principalId).toBeNull();
    expect(rows[0]?.tenantId).toBeNull();
    expect(rows[0]?.ipAddress).toBeTruthy();
  });

  it('records a 403 with the resolved principal that was refused', async () => {
    const requestId = `e2e-deny-403-${Date.now()}`;
    await request(server())
      .post('/v1/artifacts')
      .set({ ...managementHeaders('e2e.audit', ['AUDITOR']), 'x-request-id': requestId })
      .send({
        artifactCode: 'DENIED_ARTIFACT',
        artifactType: 'CREDIT_POLICY',
        name: 'x',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'x',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(403);

    const rows = await denialsFor(requestId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(403);
    expect(rows[0]?.principalId).toBe('e2e-auditor');
  });
});

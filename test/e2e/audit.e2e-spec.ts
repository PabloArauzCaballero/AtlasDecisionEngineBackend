import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders, runtimeHeaders } from './support/headers';

describe('Audit chain (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const auditor = managementHeaders('e2e.auditor', ['AUDITOR']);

  beforeAll(async () => {
    app = await createTestApp();
    const runId = Date.now();
    // Guarantee at least one audit event exists for this tenant before verifying the chain.
    await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.audit-seed'))
      .send({
        requestId: `e2e-audit-${runId}`,
        idempotencyKey: `e2e-audit-${runId}`,
        environmentCode: 'PROD',
        variables: {
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          monthly_income: 8000,
          requested_amount: 2500,
        },
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports a valid, unbroken HMAC hash chain', async () => {
    const response = await request(server()).get('/v1/audit/chain/verify').set(auditor).expect(200);
    expect(response.body.valid).toBe(true);
    expect(response.body.invalid).toEqual([]);
    expect(response.body.eventCount).toBeGreaterThan(0);
  });

  it('lists recent audit events for the tenant', async () => {
    const response = await request(server())
      .get('/v1/audit/events')
      .query({ pageSize: 5 })
      .set(auditor)
      .expect(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeGreaterThan(0);
  });
});

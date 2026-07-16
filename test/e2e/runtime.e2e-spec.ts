import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { runtimeHeaders } from './support/headers';

/** Exercises the deployed BNPL_CREDIT_DECISION seed artifact: real decisions, not mocks. */
describe('Runtime decisions (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('approves a low-risk applicant and assigns a limit', async () => {
    const response = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: `e2e-approve-${runId}`,
        idempotencyKey: `e2e-approve-${runId}`,
        subjectReference: 'e2e-subject',
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
      })
      .expect(200);
    expect(response.body.outcome).toBe('APPROVED');
    expect(response.body.limit).toBeGreaterThan(0);
    expect(response.body.executionId).toBeTruthy();
  });

  it('replays the same idempotency key without re-executing', async () => {
    const payload = {
      requestId: `e2e-idem-${runId}`,
      idempotencyKey: `e2e-idem-${runId}`,
      subjectReference: 'e2e-subject',
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
    };
    const first = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send(payload)
      .expect(200);
    const second = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send(payload)
      .expect(200);
    expect(second.body.executionId).toBe(first.body.executionId);
  });

  it('rejects replaying the same idempotency key with a different payload', async () => {
    const key = `e2e-conflict-${runId}`;
    await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: key,
        idempotencyKey: key,
        environmentCode: 'PROD',
        variables: { kyc_status: 'VERIFIED', consent_active: true, age: 30, fraud_signal: false, bureau_score: 760, monthly_income: 8000, requested_amount: 2500 },
      })
      .expect(200);
    await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: key,
        idempotencyKey: key,
        environmentCode: 'PROD',
        variables: { kyc_status: 'VERIFIED', consent_active: true, age: 30, fraud_signal: false, bureau_score: 760, monthly_income: 8000, requested_amount: 5000 },
      })
      .expect(409);
  });

  it('declines an applicant with unverified KYC', async () => {
    const response = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: `e2e-decline-${runId}`,
        idempotencyKey: `e2e-decline-${runId}`,
        environmentCode: 'PROD',
        variables: {
          kyc_status: 'PENDING',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          monthly_income: 8000,
          requested_amount: 2500,
        },
      })
      .expect(200);
    expect(response.body.outcome).toBe('DECLINED');
    expect(response.body.reasonCodes.some((reason: { code: string }) => reason.code === 'KYC_OR_CONSENT_INVALID')).toBe(true);
  });

  it('routes a fraud signal to manual review', async () => {
    const response = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: `e2e-fraud-${runId}`,
        idempotencyKey: `e2e-fraud-${runId}`,
        environmentCode: 'PROD',
        variables: {
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: true,
          bureau_score: 760,
          monthly_income: 8000,
          requested_amount: 2500,
        },
      })
      .expect(200);
    expect(response.body.outcome).toBe('MANUAL_REVIEW');
  });
});

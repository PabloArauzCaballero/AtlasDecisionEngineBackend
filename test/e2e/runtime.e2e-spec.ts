import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DEMO_BASE_APPLICANT } from '../fixtures/demo-applicant';
import { createTestApp } from './support/test-app';
import { provisionDemoArtifact } from './support/demo-artifact';
import { managementHeaders, runtimeHeaders } from './support/headers';

/** Exercises the deployed BNPL_CREDIT_DECISION seed artifact: real decisions, not mocks. */
describe('Runtime decisions (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    // El artefacto que estas pruebas ejecutan ya no depende de que alguien haya sembrado antes.
    await provisionDemoArtifact(app);
    // Como hace el core: la base habilitante de la evaluación crediticia se registra ANTES de
    // decidir. Sin ella, originación en PROD deriva a revisión (P-09), que se prueba abajo.
    await request(server())
      .post('/v1/risk-governance/consents')
      .set(managementHeaders('e2e.compliance', ['COMPLIANCE']))
      .send({
        subjectReference: 'e2e-subject',
        purpose: 'credit_underwriting',
        basis: 'CREDIT_PROTECTION',
        grantedAt: '2026-01-01T00:00:00.000Z',
      })
      .expect(200);
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
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 2500,
        },
      })
      .expect(200);
    expect(response.body.outcome).toBe('APPROVED');
    expect(response.body.output.approved_credit_limit).toBeGreaterThan(0);
    expect(response.body.executionId).toBeTruthy();
  });

  it('replays the same idempotency key without re-executing', async () => {
    const payload = {
      requestId: `e2e-idem-${runId}`,
      idempotencyKey: `e2e-idem-${runId}`,
      subjectReference: 'e2e-subject',
      environmentCode: 'PROD',
      variables: {
        ...DEMO_BASE_APPLICANT,
        kyc_status: 'VERIFIED',
        consent_active: true,
        age: 30,
        fraud_signal: false,
        bureau_score: 760,
        disposable_income: 4200,
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
        subjectReference: 'e2e-subject',
        environmentCode: 'PROD',
        variables: {
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 2500,
        },
      })
      .expect(200);
    await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: key,
        idempotencyKey: key,
        subjectReference: 'e2e-subject',
        environmentCode: 'PROD',
        variables: {
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 5000,
        },
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
        subjectReference: 'e2e-subject',
        environmentCode: 'PROD',
        variables: {
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'REJECTED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 2500,
        },
      })
      .expect(200);
    expect(response.body.outcome).toBe('DECLINED');
    expect(
      response.body.reasonCodes.some(
        (reason: { code: string }) => reason.code === 'KYC_OR_CONSENT_INVALID',
      ),
    ).toBe(true);
  });

  it('routes a politically exposed applicant to manual review', async () => {
    const response = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: `e2e-fraud-${runId}`,
        idempotencyKey: `e2e-fraud-${runId}`,
        subjectReference: 'e2e-subject',
        environmentCode: 'PROD',
        variables: {
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          pep_status: true,
          pep_relationship_type: 'FAMILY',
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 2500,
        },
      })
      .expect(200);
    expect(response.body.outcome).toBe('MANUAL_REVIEW');
    // Una revisión manual sin caso no existe: la respuesta anuncia la bandeja que hay que atender.
    expect(response.body.manualReview).toMatchObject({
      caseCode: expect.stringMatching(/^MR-\d{10,}$/),
      queueCode: 'CREDIT_REVIEW',
    });
  });

  it('a first-time applicant without a registered enabling basis goes to review, not approval', async () => {
    const response = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.runtime'))
      .send({
        requestId: `e2e-nobasis-${runId}`,
        idempotencyKey: `e2e-nobasis-${runId}`,
        subjectReference: `e2e-nobasis-subject-${runId}`,
        environmentCode: 'PROD',
        variables: {
          ...DEMO_BASE_APPLICANT,
          kyc_status: 'VERIFIED',
          consent_active: true,
          age: 30,
          fraud_signal: false,
          bureau_score: 760,
          disposable_income: 4200,
          requested_amount: 2500,
        },
      })
      .expect(422);
    expect(response.body.status).toBe('NO_DECISION');
    expect(response.body.reasonCodes[0].code).toBe('ENABLING_BASIS_MISSING');
    expect(response.body.decisionValidUntil).toBeNull();
  });
});

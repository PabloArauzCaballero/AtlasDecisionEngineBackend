import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DEMO_BASE_APPLICANT } from '../fixtures/demo-applicant';
import { createTestApp } from './support/test-app';
import { provisionDemoArtifact } from './support/demo-artifact';
import { managementHeaders, runtimeHeaders } from './support/headers';

/**
 * Cubre ocho rutas de `RiskGovernanceController` que no tenían ninguna prueba que las
 * citara por su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - POST /v1/risk-governance/limits
 *  - POST /v1/risk-governance/portfolio-state
 *  - POST /v1/risk-governance/consents/lookup
 *  - POST /v1/risk-governance/consents/revoke
 *  - POST /v1/risk-governance/reidentifications
 *  - POST /v1/risk-governance/reidentifications/decide
 *  - POST /v1/risk-governance/calibration
 *  - POST /v1/risk-governance/model-dossier
 *
 * `consents/lookup`, `reidentifications` y `revoke` exigen un TITULAR REAL: el servicio
 * resuelve la referencia contra `decisionSubject` y responde `SUBJECT_NOT_FOUND` si nunca
 * se decidió sobre ella. Por eso esta suite ejecuta primero una decisión real contra el
 * artefacto de demostración (igual que `runtime.e2e-spec.ts`) y usa esa misma
 * `subjectReference` en las rutas que la necesitan.
 */
describe('Risk governance · write routes (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const subjectReference = `e2e-governance-subject-${runId}`;

  const riskApprover = managementHeaders('e2e.governance-risk-approver', ['RISK_APPROVER']);
  const operations = managementHeaders('e2e.governance-operations', ['OPERATIONS']);
  const compliance = managementHeaders('e2e.governance-compliance', ['COMPLIANCE']);
  const riskAnalyst = managementHeaders('e2e.governance-risk-analyst', ['RISK_ANALYST']);
  // Ninguna de las ocho rutas admite QA_ANALYST: sirve de "outsider" uniforme para las ocho.
  const outsider = managementHeaders('e2e.governance-outsider', ['QA_ANALYST']);

  let demoArtifactVersionId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await provisionDemoArtifact(app);

    // Como hace `runtime.e2e-spec.ts`: la base habilitante de la evaluación crediticia se
    // registra ANTES de decidir, o la decisión deriva a NO_DECISION/revisión (P-09) en vez de
    // aprobar, y el resto de la suite (que depende de un titular real ya decidido) se cae.
    await request(server())
      .post('/v1/risk-governance/consents')
      .set(compliance)
      .send({
        subjectReference,
        purpose: 'credit_underwriting',
        basis: 'CREDIT_PROTECTION',
        grantedAt: '2026-01-01T00:00:00.000Z',
      })
      .expect(200);

    const decision = await request(server())
      .post('/v1/decisions/BNPL_CREDIT_DECISION')
      .set(runtimeHeaders('e2e.governance-runtime'))
      .send({
        requestId: `e2e-governance-${runId}`,
        idempotencyKey: `e2e-governance-${runId}`,
        subjectReference,
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
    expect(decision.body.subjectReference ?? subjectReference).toBeTruthy();

    const artifacts = await request(server())
      .get('/v1/artifacts')
      .query({ search: 'BNPL_CREDIT_DECISION', pageSize: 50 })
      .set(riskAnalyst)
      .expect(200);
    const artifact = (artifacts.body.items as Array<{ artifactCode: string; id: string }>).find(
      (item) => item.artifactCode === 'BNPL_CREDIT_DECISION',
    );
    if (!artifact)
      throw new Error('No se encontró el artefacto de demostración BNPL_CREDIT_DECISION.');
    const detail = await request(server())
      .get(`/v1/artifacts/${artifact.id}`)
      .set(riskAnalyst)
      .expect(200);
    const deployedVersion = (detail.body.versions as Array<{ id: string; status: string }>).find(
      (version) => version.status === 'DEPLOYED_TO_PROD',
    );
    if (!deployedVersion) throw new Error('El artefacto de demostración no tiene versión en PROD.');
    demoArtifactVersionId = deployedVersion.id;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/risk-governance/limits', () => {
    it('rejects a role outside the exposure-limit roles with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/limits')
        .set(outsider)
        .send({ limitCode: `E2E_LIMIT_${runId}`, maxValue: 12000, currencyCode: 'BOB' })
        .expect(403);
    });

    it('creates a portfolio exposure limit for RISK_APPROVER', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/limits')
        .set(riskApprover)
        .send({
          limitCode: `E2E_LIMIT_${runId}`,
          maxValue: 12000,
          currencyCode: 'BOB',
          enforced: false,
        })
        .expect(200);
      expect(response.body).toBeDefined();

      const listed = await request(server())
        .get('/v1/risk-governance/limits')
        .set(riskApprover)
        .expect(200);
      const limits = listed.body.items ?? listed.body;
      expect(
        (limits as Array<{ limitCode: string }>).some(
          (item) => item.limitCode === `E2E_LIMIT_${runId}`,
        ),
      ).toBe(true);
    });
  });

  describe('POST /v1/risk-governance/portfolio-state', () => {
    it('rejects a role outside OPERATIONS/RISK_ANALYST with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/portfolio-state')
        .set(outsider)
        .send({ asOf: new Date().toISOString(), metricCode: 'TOTAL_EXPOSURE', value: 1000 })
        .expect(403);
    });

    it('records a portfolio metric observation for OPERATIONS', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/portfolio-state')
        .set(operations)
        .send({ asOf: new Date().toISOString(), metricCode: 'TOTAL_EXPOSURE', value: 4820000.5 })
        .expect(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('POST /v1/risk-governance/consents/lookup', () => {
    it('rejects a role outside COMPLIANCE/OPERATIONS/AUDITOR with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/consents/lookup')
        .set(riskAnalyst)
        .send({ subjectReference, purpose: 'BANK_STATEMENT_ANALYSIS' })
        .expect(403);
    });

    it('looks up the consents of a real decision subject for COMPLIANCE', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/consents/lookup')
        .set(compliance)
        .send({ subjectReference, purpose: 'BANK_STATEMENT_ANALYSIS' })
        .expect(200);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('returns 404 for a subject on which no decision was ever recorded', async () => {
      await request(server())
        .post('/v1/risk-governance/consents/lookup')
        .set(compliance)
        .send({
          subjectReference: `e2e-unknown-subject-${runId}`,
          purpose: 'BANK_STATEMENT_ANALYSIS',
        })
        .expect(404);
    });
  });

  describe('POST /v1/risk-governance/consents/revoke', () => {
    const purpose = `E2E_PURPOSE_${runId}`;

    beforeAll(async () => {
      await request(server())
        .post('/v1/risk-governance/consents')
        .set(compliance)
        .send({
          subjectReference,
          purpose,
          basis: 'CONSENT',
          grantedAt: new Date().toISOString(),
        })
        .expect(200);
    });

    it('rejects a role outside COMPLIANCE/OPERATIONS with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/consents/revoke')
        .set(outsider)
        .send({ subjectReference, purpose })
        .expect(403);
    });

    it('revokes an existing consent for COMPLIANCE', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/consents/revoke')
        .set(compliance)
        .send({ subjectReference, purpose })
        .expect(200);
      expect(response.body.revokedAt).toBeTruthy();
    });
  });

  describe('POST /v1/risk-governance/reidentifications', () => {
    it('rejects a role outside COMPLIANCE/OPERATIONS with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/reidentifications')
        .set(outsider)
        .send({
          subjectReference,
          purpose: 'Reclamo del consumidor: hay que contactar al titular.',
        })
        .expect(403);
    });

    it('requests a reidentification for COMPLIANCE', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/reidentifications')
        .set(compliance)
        .send({
          subjectReference,
          purpose: 'Reclamo del consumidor: hay que contactar al titular.',
        })
        .expect(200);
      expect(response.body.id).toBeTruthy();
      expect(response.body.status).toBe('REQUESTED');
    });
  });

  describe('POST /v1/risk-governance/reidentifications/decide', () => {
    let requestId: string;

    beforeAll(async () => {
      const requested = await request(server())
        .post('/v1/risk-governance/reidentifications')
        .set(compliance)
        .send({ subjectReference, purpose: 'Segunda solicitud para probar la decisión.' })
        .expect(200);
      requestId = requested.body.id;
    });

    it('rejects a role outside COMPLIANCE/RISK_APPROVER with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/reidentifications/decide')
        .set(outsider)
        .send({ requestId, approve: true })
        .expect(403);
    });

    it('rejects self-approval by whoever requested it, even with a valid role', async () => {
      await request(server())
        .post('/v1/risk-governance/reidentifications/decide')
        .set(compliance)
        .send({ requestId, approve: true })
        .expect(403);
    });

    it('lets a different RISK_APPROVER decide the request', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/reidentifications/decide')
        .set(riskApprover)
        .send({ requestId, approve: true })
        .expect(200);
      expect(response.body.status).toBe('APPROVED');
    });
  });

  describe('POST /v1/risk-governance/calibration', () => {
    it('rejects a role outside the calibration roles with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/calibration')
        .set(outsider)
        .send({
          artifactVersionId: demoArtifactVersionId,
          windowDays: 90,
          predictionField: 'probability_of_default',
        })
        .expect(403);
    });

    it('computes the calibration curve of the deployed demo version for RISK_ANALYST', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/calibration')
        .set(riskAnalyst)
        .send({
          artifactVersionId: demoArtifactVersionId,
          windowDays: 90,
          predictionField: 'probability_of_default',
        })
        .expect(200);
      expect(response.body).toBeDefined();
    });
  });

  describe('POST /v1/risk-governance/model-dossier', () => {
    it('rejects a role outside RISK_APPROVER/COMPLIANCE with 403', async () => {
      await request(server())
        .post('/v1/risk-governance/model-dossier')
        .set(outsider)
        .send({
          artifactVersionId: demoArtifactVersionId,
          validatedBy: `e2e.validator.${runId}@atlas`,
          validatedAt: new Date().toISOString(),
          revalidationDueAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .expect(403);
    });

    it('records the independent-validation dossier for RISK_APPROVER', async () => {
      const response = await request(server())
        .post('/v1/risk-governance/model-dossier')
        .set(riskApprover)
        .send({
          artifactVersionId: demoArtifactVersionId,
          validatedBy: `e2e.validator.${runId}@atlas`,
          validatedAt: new Date().toISOString(),
          revalidationDueAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          limitationsNotes: 'Registrado por la batería de rutas de escritura.',
        })
        .expect(200);
      expect(response.body).toBeDefined();
    });
  });
});

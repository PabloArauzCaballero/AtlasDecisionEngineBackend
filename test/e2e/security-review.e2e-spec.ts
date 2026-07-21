import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Exercises the security team dashboard (Fase 10) against a real Postgres: an
 * artifact with a script node and a sensitive variable dependency should surface
 * both as HIGH-severity findings, plus its full governance/audit aggregation.
 */
describe('Security review (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const author = managementHeaders('e2e.security-review-author', ['RISK_ANALYST']);
  const compliance = managementHeaders('e2e.security-review-compliance', ['COMPLIANCE']);

  let versionId: string;
  let artifactId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an artifact with a script node and a sensitive variable', async () => {
    const sensitiveVariable = await request(server())
      .post('/v1/variables')
      .set(author)
      .send({
        variableCode: `secReviewSensitive_${runId}`,
        canonicalName: 'Sensitive test variable',
        businessDescription: 'Used to verify the security review surfaces sensitive variables.',
        dataClassification: 'RESTRICTED',
        ownerTeam: 'RISK_DECISIONING',
        isSensitive: true,
        initialVersion: { dataType: 'STRING', nullable: false, sources: [], validationRules: [] },
      })
      .expect(201);
    const sensitiveVariableVersionId = sensitiveVariable.body.versions[0].id;

    const artifact = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode: `E2E_SECURITY_REVIEW_${runId}`,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E security review',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifies the security review dashboard aggregates real risk data.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    artifactId = artifact.body.id;
    versionId = artifact.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send({
        dependencies: [
          {
            variableVersionId: sensitiveVariableVersionId,
            usageType: 'INPUT',
            isRequired: true,
            fallbackPolicy: 'FAIL_CLOSED',
            dependencyPath: 'input.secReviewSensitive',
          },
        ],
        conditions: [],
        actions: [],
        nodes: [
          { key: 'START', type: 'START', label: 'Start', config: {}, x: 0, y: 0, order: 1, terminal: false, conditions: [], actions: [] },
          {
            key: 'RESULT',
            type: 'RESULT',
            label: 'Script result',
            config: { mode: 'SCRIPT', script: { language: 'JAVASCRIPT', source: 'return {};' } },
            x: 100,
            y: 0,
            order: 2,
            terminal: true,
            conditions: [],
            actions: [],
          },
        ],
        edges: [{ key: 'START_RESULT', from: 'START', to: 'RESULT', type: 'DEFAULT', priority: 1, default: true, conditions: [] }],
      })
      .expect(200);
  });

  it('rejects a caller without a security-team role', async () => {
    await request(server())
      .get(`/v1/security-review/versions/${versionId}`)
      .set(author)
      .expect(403);
  });

  it('aggregates code, variables and severity for the security team', async () => {
    const response = await request(server())
      .get(`/v1/security-review/versions/${versionId}`)
      .set(compliance)
      .expect(200);

    expect(response.body.artifact.id).toBe(artifactId);
    expect(response.body.artifact.artifactCode).toBe(`E2E_SECURITY_REVIEW_${runId}`);
    expect(response.body.code).toEqual([
      expect.objectContaining({ nodeKey: 'RESULT', language: 'JAVASCRIPT' }),
    ]);
    expect(response.body.variables).toEqual([
      expect.objectContaining({ code: `secReviewSensitive_${runId}`, isSensitive: true }),
    ]);
    expect(response.body.severity).toBe('HIGH');
    expect(response.body.findings.map((finding: { code: string }) => finding.code)).toEqual(
      expect.arrayContaining(['CONTAINS_SCRIPT_NODES', 'SENSITIVE_VARIABLES', 'RESTRICTED_CLASSIFICATION_VARIABLES']),
    );
    expect(response.body.governance).toEqual([]);
    // Authoring actions (like replacing the draft graph) are themselves audited,
    // so the incident feed is not empty even before any real security incident —
    // each entry carries direct artifact/version navigation.
    expect(response.body.incidents).toEqual([
      expect.objectContaining({ eventType: 'RULE_GRAPH_REPLACED', artifactId, versionId }),
    ]);
  });

  it('exports the same report as a downloadable JSON file', async () => {
    const response = await request(server())
      .get(`/v1/security-review/versions/${versionId}/export`)
      .set(compliance)
      .expect(200);
    expect(response.headers['content-disposition']).toMatch(/attachment/);
    expect(response.body.artifact.artifactCode).toBe(`E2E_SECURITY_REVIEW_${runId}`);
  });

  it('returns 404 for a version in a different tenant/not found', async () => {
    await request(server()).get('/v1/security-review/versions/999999999').set(compliance).expect(404);
  });
});

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { headersFor, type E2eClientName } from './support/integration-clients';

/**
 * Quién da de alta un artefacto y quién escribe su regla, contra el servidor de verdad.
 *
 * La doc de segregación del portal (y `docs/security/roles-y-autoria-de-artefactos.md` aquí) fija tres
 * reglas: sólo PLATFORM_ADMIN crea artefactos; la autoría —grafo, versiones, compilar, enviar a
 * revisión— es de QA_ANALYST y FRAUD_ANALYST; y RISK_ANALYST consulta, no programa. El backend
 * las contradecía: dejaba crear a RISK/FRAUD y guardar el grafo a RISK. Cada credencial de aquí
 * tiene UN solo rol, así que un 403 es del rol y no de otra cosa.
 */
describe('Autoría de artefactos por rol (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const artifactCode = `E2E_AUTHORING_ROLES_${Date.now()}`;
  let versionId: string;

  const minimalGraph = {
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
    ],
    edges: [],
  };

  const artifactBody = (suffix: string) => ({
    artifactCode: `${artifactCode}_${suffix}`,
    artifactType: 'CREDIT_POLICY',
    name: 'Alta por rol',
    ownerTeam: 'RISK_DECISIONING',
    businessPurpose: 'Fija quién puede dar de alta un artefacto.',
    riskDomain: 'CREDIT_ORIGINATION',
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each<E2eClientName>(['riskAnalyst', 'fraudAnalyst', 'qaAnalyst'])(
    '%s no da de alta un artefacto (403)',
    async (client) => {
      const response = await request(server())
        .post('/v1/artifacts')
        .set(headersFor(client))
        .send(artifactBody(client.toUpperCase()))
        .expect(403);
      expect(response.body.code ?? response.body.error?.code).toBe('FORBIDDEN');
    },
  );

  it('PLATFORM_ADMIN sí da de alta el artefacto', async () => {
    const response = await request(server())
      .post('/v1/artifacts')
      .set(headersFor('artifactCreator'))
      .send(artifactBody('ADMIN'))
      .expect(201);
    versionId = response.body.versions[0].id;
    expect(versionId).toBeTruthy();
  });

  it('RISK_ANALYST no guarda el grafo (403 antes de mirar el If-Match)', async () => {
    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...headersFor('riskAnalyst'), 'if-match': '1' })
      .send(minimalGraph)
      .expect(403);
  });

  // 428 = pasó la autorización y lo que falta es el If-Match: prueba el rol sin escribir nada.
  it.each<E2eClientName>(['qaAnalyst', 'fraudAnalyst'])(
    '%s sí puede guardar el grafo (pasa la autorización)',
    async (client) => {
      await request(server())
        .put(`/v1/artifact-versions/${versionId}/graph`)
        .set(headersFor(client))
        .send(minimalGraph)
        .expect(428);
    },
  );

  it.each([
    ['post', 'clone', { changeSummary: 'x' }],
    ['post', 'validate', {}],
    ['post', 'compile', {}],
    ['post', 'submit-for-review', {}],
    ['patch', 'notes', { notes: 'x' }],
  ] as const)('RISK_ANALYST no hace %s …/%s (403)', async (method, action, body) => {
    const agent = request(server());
    const path = `/v1/artifact-versions/${versionId}/${action}`;
    const call = method === 'patch' ? agent.patch(path) : agent.post(path);
    await call.set(headersFor('riskAnalyst')).send(body).expect(403);
  });

  it('RISK_ANALYST sigue LEYENDO el artefacto y su grafo', async () => {
    await request(server())
      .get(`/v1/artifact-versions/${versionId}/graph`)
      .set(headersFor('riskAnalyst'))
      .expect(200);
  });

  it('QA_ANALYST crea una versión nueva sobre el artefacto existente', async () => {
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/clone`)
      .set(headersFor('qaAnalyst'))
      .send({ changeSummary: 'Propuesta de cambio' })
      .expect(201);
  });

  it('fijar un objetivo de negocio es de COMPLIANCE: RISK_ANALYST recibe 403', async () => {
    await request(server())
      .post('/v1/traceability/objectives')
      .set(headersFor('riskAnalyst'))
      .send({ objectiveCode: `OBJ_${Date.now()}`, name: 'x' })
      .expect(403);
  });
});

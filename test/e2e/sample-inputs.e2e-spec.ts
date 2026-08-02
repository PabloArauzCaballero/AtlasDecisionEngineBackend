import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { managementHeaders } from './support/headers';
import { createTestApp } from './support/test-app';

/**
 * La única promesa que hace el botón «Generar valores de prueba» es que lo generado
 * SIRVE: que se puede simular sin que el motor lo rechace por contrato.
 *
 * Por eso la prueba no se conforma con inspeccionar el JSON generado —eso sólo probaría
 * que el generador es coherente consigo mismo—, sino que lo pasa por el simulador real.
 * Si el endpoint resolviera el contrato por el catálogo en vez de por el despliegue, este
 * ida y vuelta fallaría con VARIABLE_MISSING_OR_INVALID.
 */
describe('Valores de prueba del simulador (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  // El artefacto de la demo está desplegado en SANDBOX, TEST y PROD por el seeder.
  const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';
  const analyst = managementHeaders('e2e.sample-inputs', ['RISK_ANALYST']);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('genera entradas que el simulador acepta sin errores de contrato', async () => {
    const generated = await request(server())
      .post(`/v1/simulations/${ARTIFACT_CODE}/sample-inputs`)
      .set(analyst)
      .send({ environmentCode: 'SANDBOX', kind: 'VALID', count: 3 })
      .expect(201);

    expect(generated.body.cases).toHaveLength(3);
    expect(generated.body.seed).toBeTruthy();

    for (const [index, sample] of generated.body.cases.entries()) {
      const simulated = await request(server())
        .post(`/v1/simulations/${ARTIFACT_CODE}`)
        .set(analyst)
        .send({
          requestId: `e2e-sample-${runId}-${index}`,
          environmentCode: 'SANDBOX',
          variables: sample.input,
        })
        .expect(201);
      // Lo que se comprueba es la VALIDEZ de contrato, no a qué rama llega el grafo:
      // un caso válido puede terminar en rechazo de negocio y estar perfectamente bien.
      expect(simulated.body.errors ?? []).toEqual([]);
      expect(
        (simulated.body.reasonCodes ?? []).map((reason: { code: string }) => reason.code),
      ).not.toContain('VARIABLE_MISSING_OR_INVALID');
    }
  });

  it('la misma semilla reproduce exactamente los mismos valores', async () => {
    const first = await request(server())
      .post(`/v1/simulations/${ARTIFACT_CODE}/sample-inputs`)
      .set(analyst)
      .send({ environmentCode: 'SANDBOX', count: 2 })
      .expect(201);

    const replay = await request(server())
      .post(`/v1/simulations/${ARTIFACT_CODE}/sample-inputs`)
      .set(analyst)
      .send({ environmentCode: 'SANDBOX', count: 2, seed: first.body.seed })
      .expect(201);

    expect(replay.body.cases).toEqual(first.body.cases);
  });

  it('no genera valores contra PROD', async () => {
    await request(server())
      .post(`/v1/simulations/${ARTIFACT_CODE}/sample-inputs`)
      .set(analyst)
      .send({ environmentCode: 'PROD' })
      .expect(403);
  });

  it('rechaza una clase de caso que no existe', async () => {
    await request(server())
      .post(`/v1/simulations/${ARTIFACT_CODE}/sample-inputs`)
      .set(analyst)
      .send({ environmentCode: 'SANDBOX', kind: 'CUALQUIERA' })
      .expect(400);
  });
});

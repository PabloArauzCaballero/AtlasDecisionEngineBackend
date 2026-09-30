import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Cubre dos rutas de escritura del worker semántico sin ninguna prueba que las citara por
 * su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - DELETE /v1/workers/semantic-analysis/categories/:code
 *  - DELETE /v1/workers/semantic-analysis/model-settings
 *
 * La primera exige `RISK_ANALYST` o `FRAUD_ANALYST`; la segunda, `RISK_ANALYST` u
 * `OPERATIONS`. `AUDITOR` no aparece en ninguna de las dos, así que sirve para probar que
 * la guardia de rol protege de verdad en ambas.
 */
describe('Semantic analysis · write routes (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const outsider = managementHeaders('e2e.semantic-outsider', ['AUDITOR']);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('DELETE /v1/workers/semantic-analysis/categories/:code', () => {
    const writer = managementHeaders('e2e.semantic-writer', ['RISK_ANALYST']);
    const code = `E2E.CATEGORIA.R${runId}`;

    beforeAll(async () => {
      const created = await request(server())
        .post('/v1/workers/semantic-analysis/categories')
        .set(writer)
        .send({
          code,
          name: 'Categoría de prueba e2e',
          description: 'Categoría creada por la batería de rutas de escritura.',
        });
      if (![200, 201].includes(created.status)) {
        throw new Error(
          `No se pudo crear la categoría de preparación (${created.status}): ` +
            JSON.stringify(created.body).slice(0, 500),
        );
      }
    });

    it('rejects a role without RISK_ANALYST/FRAUD_ANALYST with 403', async () => {
      await request(server())
        .delete(`/v1/workers/semantic-analysis/categories/${code}`)
        .set(outsider)
        .expect(403);
    });

    it('deactivates the category for an authorised role', async () => {
      const response = await request(server())
        .delete(`/v1/workers/semantic-analysis/categories/${code}`)
        .set(writer);
      expect([200, 201]).toContain(response.status);
      expect(response.body.isActive).toBe(false);
      expect(response.body.code).toBe(code);
    });
  });

  describe('DELETE /v1/workers/semantic-analysis/model-settings', () => {
    const writer = managementHeaders('e2e.model-settings-writer', ['RISK_ANALYST']);

    it('rejects a role without RISK_ANALYST/OPERATIONS with 403', async () => {
      await request(server())
        .delete('/v1/workers/semantic-analysis/model-settings')
        .set(outsider)
        .expect(403);
    });

    it('resets the model settings to the environment defaults for an authorised role', async () => {
      const response = await request(server())
        .delete('/v1/workers/semantic-analysis/model-settings')
        .set(writer)
        .expect(200);
      expect(response.body.effective.source).toBe('environment');
    });
  });
});

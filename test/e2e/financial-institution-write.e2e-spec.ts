import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Cubre las dos rutas de baja del padrón de entidades financieras que no tenían ninguna
 * prueba que las citara por su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - DELETE /v1/workers/bank-statement/institutions/:code
 *  - DELETE /v1/workers/bank-statement/institutions/:code/logo
 *
 * Ambas exigen `RISK_ANALYST` o `FRAUD_ANALYST`; `AUDITOR` no aparece en ninguna de las
 * dos listas de roles del controlador, así que sirve para probar que la guardia de rol
 * protege de verdad.
 */
describe('Financial institutions · write routes (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const writer = managementHeaders('e2e.institutions-writer', ['RISK_ANALYST']);
  const outsider = managementHeaders('e2e.institutions-outsider', ['AUDITOR']);

  const onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function crearEntidad(code: string) {
    return request(server())
      .post('/v1/workers/bank-statement/institutions')
      .set(writer)
      .send({
        code,
        name: `Entidad de prueba ${code}`,
        kind: 'MULTIPLE_BANK',
        markers: [`\\b${code}\\b`],
      });
  }

  describe('DELETE /v1/workers/bank-statement/institutions/:code', () => {
    const code = `E2E${runId}`.slice(0, 16).toUpperCase();

    beforeAll(async () => {
      const created = await crearEntidad(code);
      if (![200, 201].includes(created.status)) {
        throw new Error(
          `No se pudo crear la entidad de preparación (${created.status}): ` +
            JSON.stringify(created.body).slice(0, 500),
        );
      }
    });

    it('rejects a role without RISK_ANALYST/FRAUD_ANALYST with 403', async () => {
      await request(server())
        .delete(`/v1/workers/bank-statement/institutions/${code}`)
        .set(outsider)
        .expect(403);
    });

    it('deactivates the institution for an authorised role', async () => {
      const response = await request(server())
        .delete(`/v1/workers/bank-statement/institutions/${code}`)
        .set(writer);
      expect([200, 201]).toContain(response.status);
      expect(response.body.isActive).toBe(false);
      expect(response.body.code).toBe(code);
    });
  });

  describe('DELETE /v1/workers/bank-statement/institutions/:code/logo', () => {
    const code = `E2ELOGO${runId}`.slice(0, 16).toUpperCase();

    beforeAll(async () => {
      await crearEntidad(code);
      const uploaded = await request(server())
        .put(`/v1/workers/bank-statement/institutions/${code}/logo`)
        .set(writer)
        .send({ base64: onePixelPng, contentType: 'image/png' });
      if (![200, 201].includes(uploaded.status)) {
        throw new Error(
          `No se pudo cargar el logotipo de preparación (${uploaded.status}): ` +
            JSON.stringify(uploaded.body).slice(0, 500),
        );
      }
    });

    it('rejects a role without RISK_ANALYST/FRAUD_ANALYST with 403', async () => {
      await request(server())
        .delete(`/v1/workers/bank-statement/institutions/${code}/logo`)
        .set(outsider)
        .expect(403);
    });

    it('removes the logo for an authorised role', async () => {
      const response = await request(server())
        .delete(`/v1/workers/bank-statement/institutions/${code}/logo`)
        .set(writer);
      expect([200, 201]).toContain(response.status);

      const logo = await request(server())
        .get(`/v1/workers/bank-statement/institutions/${code}/logo`)
        .set(writer);
      expect(logo.status).toBe(404);
    });
  });
});

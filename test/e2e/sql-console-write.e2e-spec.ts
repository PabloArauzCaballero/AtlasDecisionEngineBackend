import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';

/**
 * Cubre las dos rutas de ejecución de la consola SQL que no tenían ninguna prueba que las
 * citara por su ruta HTTP (hallazgo UNTESTED_WRITE):
 *
 *  - POST /v1/sql-console/query
 *  - POST /v1/sql-console/validate
 *
 * Ninguna de las dos escribe datos de negocio (`sql-console.controller.ts` lo dice en su
 * propio encabezado), pero SÍ ejecutan SQL contra la base, así que "escritura" aquí es la
 * de `finding UNTESTED_WRITE` sobre el verbo HTTP, no sobre el efecto. Por eso esta suite
 * verifica, además del contrato de rol, la guardia de sólo-lectura descrita en
 * `src/modules/sql-console/guard/sql-guard.ts`: un `INSERT`/`UPDATE`/`DELETE` se rechaza en
 * las DOS rutas, nunca se ejecuta.
 */
describe('SQL console · write routes (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  // RISK_ANALYST, FRAUD_ANALYST, RISK_APPROVER, COMPLIANCE y AUDITOR pueden entrar;
  // OPERATIONS y QA_ANALYST quedan fuera a propósito (ver el comentario del controlador).
  // `managementHeaders` sólo sabe emitir una credencial que tenga EXACTAMENTE ese rol para
  // AUDITOR, PLATFORM_ADMIN, QA_ANALYST, RISK_ANALYST y RISK_APPROVER; cualquier otro nombre
  // (como OPERATIONS) cae en el admin comodín, que sí puede entrar. Por eso el "outsider" es
  // QA_ANALYST y no OPERATIONS: es el único de los dos que de verdad prueba la guardia.
  const analyst = managementHeaders('e2e.sql-console-analyst', ['RISK_ANALYST']);
  const outsider = managementHeaders('e2e.sql-console-outsider', ['QA_ANALYST']);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/sql-console/validate', () => {
    it('rejects a role outside the console roles with 403', async () => {
      await request(server())
        .post('/v1/sql-console/validate')
        .set(outsider)
        .send({ statement: 'SELECT 1 AS ok' })
        .expect(403);
    });

    it('validates a well-formed read-only query for an authorised role', async () => {
      const response = await request(server())
        .post('/v1/sql-console/validate')
        .set(analyst)
        .send({ statement: 'SELECT 1 AS ok' })
        .expect(200);
      expect(response.body.valid).toBe(true);
    });

    it('rejects a write statement even though the endpoint only validates', async () => {
      const response = await request(server())
        .post('/v1/sql-console/validate')
        .set(analyst)
        .send({ statement: "UPDATE decisiones.ejecuciones SET desenlace = 'APPROVED'" })
        .expect(200);
      expect(response.body.valid).toBe(false);
      expect((response.body.violations as Array<{ code: string }>).length).toBeGreaterThan(0);
    });
  });

  describe('POST /v1/sql-console/query', () => {
    it('rejects a role outside the console roles with 403', async () => {
      await request(server())
        .post('/v1/sql-console/query')
        .set(outsider)
        .send({ statement: 'SELECT 1 AS ok' })
        .expect(403);
    });

    it('executes a well-formed read-only query for an authorised role', async () => {
      const response = await request(server())
        .post('/v1/sql-console/query')
        .set(analyst)
        .send({ statement: 'SELECT 1 AS ok' })
        .expect(200);
      // Las filas viajan como matriz, no como objetos (ver `QueryResultDto.rows`):
      // una fila puede repetir el nombre de una columna.
      expect(response.body.columns.map((column: { name: string }) => column.name)).toEqual(['ok']);
      expect(response.body.rows).toEqual([[1]]);
    });

    it('never executes a write statement: the read-only guard rejects it with 422', async () => {
      const response = await request(server())
        .post('/v1/sql-console/query')
        .set(analyst)
        .send({ statement: "DELETE FROM decisiones.ejecuciones WHERE id = '1'" })
        .expect(422);
      expect(response.body.error.details.code).toBeTruthy();
    });
  });
});

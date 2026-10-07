import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { provisionDemoArtifact } from './support/demo-artifact';
import { managementHeaders } from './support/headers';
import { createTestApp } from './support/test-app';

/**
 * Generar la suite de cobertura contra la aplicación REAL: API, Postgres y el worker de corridas.
 *
 * Lo que las pruebas unitarias no pueden decir: que la ruta existe con sus roles, que lo generado
 * se guarda, que el worker lo ejecuta y deja la corrida en verde con el 100 % de los nodos, y que
 * con eso el gobierno deja de responder `BLOCKING_TESTS_NOT_PASSED`.
 */
describe('Suite de cobertura generada (e2e)', () => {
  let app: INestApplication;
  let versionId: string;
  let primeraGeneracion = 0;
  const server = () => app.getHttpServer();
  const author = managementHeaders('e2e.author');
  const outsider = managementHeaders('e2e.coverage-outsider', ['RISK_ANALYST']);

  beforeAll(async () => {
    app = await createTestApp();
    await provisionDemoArtifact(app);
    const listado = await request(server())
      .get('/v1/artifacts')
      .query({ search: 'BNPL_CREDIT_DECISION', pageSize: 50 })
      .set(author)
      .expect(200);
    const artefacto = (listado.body.items as Array<{ id: string; artifactCode: string }>).find(
      (item) => item.artifactCode === 'BNPL_CREDIT_DECISION',
    );
    const detalle = await request(server())
      .get(`/v1/artifacts/${artefacto!.id}`)
      .set(author)
      .expect(200);
    versionId = detalle.body.versions[0].id as string;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  async function esperarCorrida(runId: string) {
    const limite = Date.now() + 30_000;
    let corrida = await request(server()).get(`/v1/test-runs/${runId}`).set(author);
    while (Date.now() < limite && !['PASSED', 'FAILED', 'ERROR'].includes(corrida.body.status)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      corrida = await request(server()).get(`/v1/test-runs/${runId}`).set(author);
    }
    return corrida.body as {
      status: string;
      coverage: Array<{ coverageType: string; coveragePercentage: string }>;
      caseRuns: Array<{ resultStatus: string }>;
    };
  }

  it('quien no propone cambios no puede generar', async () => {
    await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites/generate`)
      .set(outsider)
      .send({})
      .expect(403);
  });

  it('genera, guarda, ejecuta y deja la corrida en verde con el 100 % de los nodos', async () => {
    const generada = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites/generate`)
      .set(author)
      .send({})
      .expect(201);

    expect(generada.body).toMatchObject({ suiteCode: 'AUTO-COBERTURA', complete: true });
    // Relativo y no «1»: la base de pruebas se reutiliza entre corridas y la suite puede existir ya.
    primeraGeneracion = generada.body.generation as number;
    expect(primeraGeneracion).toBeGreaterThanOrEqual(1);
    expect(generada.body.nodes).toEqual({ percentage: 100, missing: [] });
    expect(generada.body.cases).toBeGreaterThan(0);

    const corrida = await esperarCorrida(generada.body.runId as string);
    expect(corrida.status).toBe('PASSED');
    expect(corrida.caseRuns.every((caso) => caso.resultStatus === 'PASS')).toBe(true);
    expect(
      Number(corrida.coverage.find((item) => item.coverageType === 'NODE')?.coveragePercentage),
    ).toBe(100);

    const suites = await request(server())
      .get(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .expect(200);
    const auto = (suites.body.items as Array<{ suiteCode: string; isBlocking: boolean }>).find(
      (suite) => suite.suiteCode === 'AUTO-COBERTURA',
    );
    expect(auto).toMatchObject({ isBlocking: true });
  }, 60_000);

  it('regenerar no duplica la suite: nueva generación, casos anteriores desactivados', async () => {
    const segunda = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites/generate`)
      .set(author)
      .send({})
      .expect(201);

    expect(segunda.body.generation).toBe(primeraGeneracion + 1);
    const corrida = await esperarCorrida(segunda.body.runId as string);
    expect(corrida.status).toBe('PASSED');
    // Sólo se ejecutan los casos activos: los de la segunda generación.
    expect(corrida.caseRuns).toHaveLength(segunda.body.cases as number);

    const suites = await request(server())
      .get(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .expect(200);
    const autos = (suites.body.items as Array<{ suiteCode: string }>).filter(
      (suite) => suite.suiteCode === 'AUTO-COBERTURA',
    );
    expect(autos).toHaveLength(1);
  }, 60_000);
});

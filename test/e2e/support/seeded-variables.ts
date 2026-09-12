import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Resolves the latest version id of a seeded variable by its exact code.
 *
 * The specs used to read `versions[0].id` straight off `GET /v1/variables?search=…`. Two
 * things later broke that, and both are fixed here rather than in each spec:
 *
 *  - The list response was flattened for the catalogue table, so it now exposes
 *    `latestVersion` (a version *number*) and no longer nests `versions[]` at all. Only
 *    the detail endpoint still returns the version graph, hence the second call below.
 *  - `search` matches code, canonical name AND business description, ordered by code, so
 *    as the seeded catalogue grew past a couple hundred entries, earlier codes whose
 *    description merely mentions "average"/"coverage" filled the first page and pushed the
 *    exact match off it. Paging until the code appears keeps this independent of catalogue
 *    size and of how partial matches happen to rank.
 */
export async function seededVariableVersionId(
  app: INestApplication,
  headers: Record<string, string>,
  variableCode: string,
  /** Tipo con el que se CREA si no existe. El que ya existe se usa tal cual. */
  dataType: 'INTEGER' | 'DECIMAL' | 'STRING' | 'BOOLEAN' = 'INTEGER',
): Promise<string> {
  const pageSize = 100;
  for (let page = 1; page <= 20; page += 1) {
    const response = await getPageWithRetry(app, headers, variableCode, page, pageSize);

    const match = response.body.items.find(
      (item: { variableCode: string }) => item.variableCode === variableCode,
    );
    if (match) {
      const detail = await request(app.getHttpServer())
        .get(`/v1/variables/${match.id}`)
        .set(headers)
        .expect(200);
      // Detail orders versions newest-first, so index 0 is the latest.
      const versionId = detail.body.versions?.[0]?.id;
      if (!versionId) {
        throw new Error(`Seeded variable "${variableCode}" has no versions; reseed the catalog.`);
      }
      return versionId as string;
    }
    if (!response.body.hasNextPage) break;
  }
  /*
   * Si no está, se CREA por el mismo endpoint del producto.
   *
   * Antes esto lanzaba «Run `yarn prisma:seed`», y ese mensaje describía un mundo que ya no
   * existe: el conjunto sembrado dejó de vivir en el repositorio y hoy lo publica una base en un
   * servidor propio, que un runner de CI no alcanza. El resultado era que las e2e sólo pasaban
   * contra una base previamente sembrada por alguien, y en CI fallaban las trece.
   *
   * Crear la variable aquí no es aflojar la prueba: lo que estas suites miden es el CICLO de un
   * artefacto —validar, compilar, aprobar, desplegar, ejecutar—, no que el catálogo venga poblado.
   * Y se crea POR HTTP, con el contrato que el producto exige, así que si el alta se rompiera la
   * prueba lo diría igual.
   */
  return createVariable(app, headers, variableCode, dataType);
}

/** Da de alta la variable mínima que estas suites necesitan como dependencia de un grafo. */
async function createVariable(
  app: INestApplication,
  headers: Record<string, string>,
  variableCode: string,
  dataType: string,
): Promise<string> {
  const created = await request(app.getHttpServer())
    .post('/v1/variables')
    .set(headers)
    .send({
      variableCode,
      canonicalName: variableCode,
      businessDescription: `Variable creada por la batería e2e para ${variableCode}.`,
      dataClassification: 'INTERNAL',
      ownerTeam: 'e2e',
      isSensitive: false,
      initialVersion: {
        dataType,
        nullable: false,
        sources: [],
        validationRules: [],
      },
    });

  if (created.status !== 201 && created.status !== 200) {
    throw new Error(
      `No se pudo crear la variable "${variableCode}" para la batería e2e: ` +
        `POST /v1/variables devolvió ${created.status}. ${JSON.stringify(created.body).slice(0, 300)}`,
    );
  }

  const versionId =
    created.body.versions?.[0]?.id ?? created.body.initialVersion?.id ?? created.body.versionId;
  if (!versionId) {
    // El alta responde con la definición y su primera versión; si eso cambia, hay que enterarse
    // aquí y no dos suites más adelante con un `undefined` por identificador.
    throw new Error(
      `La variable "${variableCode}" se creó pero la respuesta no trae el id de su versión: ` +
        JSON.stringify(created.body).slice(0, 300),
    );
  }
  return versionId as string;
}

/**
 * Fetches one page of the catalogue, retrying a handful of times on a transient 5xx.
 *
 * Against a shared, loaded development database the pg pool can occasionally fail to hand
 * out a connection within DATABASE_CONNECTION_TIMEOUT_MS, surfacing as a 500 ("Connection
 * terminated due to connection timeout"). That is infrastructure contention, not a product
 * defect — the identical call succeeds in the other e2e suites of the same run — so a short
 * bounded backoff keeps the suite deterministic without masking a real 4xx/not-found.
 */
async function getPageWithRetry(
  app: INestApplication,
  headers: Record<string, string>,
  variableCode: string,
  page: number,
  pageSize: number,
) {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt += 1) {
    const response = await request(app.getHttpServer())
      .get('/v1/variables')
      .query({ search: variableCode, page, pageSize })
      .set(headers);
    if (response.status === 200) return response;
    if (response.status < 500 || attempt >= maxAttempts) {
      throw new Error(
        `GET /v1/variables (search=${variableCode}) returned ${response.status} after ${attempt} attempt(s)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
}

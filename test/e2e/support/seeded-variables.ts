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
  throw new Error(
    `Seeded variable "${variableCode}" was not found. Run \`yarn prisma:seed\` against this database.`,
  );
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

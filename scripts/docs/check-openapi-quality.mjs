#!/usr/bin/env node
/**
 * Puerta de calidad del contrato OpenAPI, calculada sobre el artefacto real.
 *
 * Redocly cubre el linting estructural; esto cubre las reglas que son de ESTE producto y que
 * ninguna regla genérica conoce: que ninguna operación quede sin identificador estable, que
 * ninguna quede sin exigir credencial salvo las sondas declaradas públicas, y que ninguna
 * respuesta de éxito salga sin esquema — un consumidor no puede tipar lo que no está descrito.
 *
 * Emite además `docs/reports/openapi-metrics.json`, que es de donde el informe final saca sus
 * porcentajes en vez de que alguien los cuente a mano.
 *
 *   node scripts/docs/check-openapi-quality.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const specPath = join(repoRoot, 'openapi', 'openapi.json');
const reportPath = join(repoRoot, 'docs', 'reports', 'openapi-metrics.json');
const debtPath = join(repoRoot, 'docs', 'reports', 'openapi-response-schema-debt.json');

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'];
/** Sondas del orquestador: públicas por diseño, ver common/openapi/openapi-document.ts. */
const PUBLIC_PATHS = new Set(['/health', '/health/live', '/health/ready', '/ready']);

function successResponses(operation) {
  return Object.entries(operation.responses ?? {}).filter(
    ([status]) => status.startsWith('2') || status === 'default',
  );
}

/** Una respuesta 204 no lleva cuerpo: exigirle esquema sería exigir describir la nada. */
function requiresSchema([status, response]) {
  if (status === '204') return false;
  return !response?.content || Object.keys(response.content).length > 0;
}

async function main() {
  const document = JSON.parse(await readFile(specPath, 'utf8'));
  const failures = [];
  const schemaDebt = [];
  const operationIds = new Map();
  const metrics = {
    generatedAt: null,
    apiVersion: document.info?.version ?? 'unknown',
    paths: Object.keys(document.paths ?? {}).length,
    operations: 0,
    withOperationId: 0,
    withSummary: 0,
    withTag: 0,
    withSecurity: 0,
    withSuccessSchema: 0,
    schemas: Object.keys(document.components?.schemas ?? {}).length,
    publicOperations: 0,
  };

  const documentSecurity = Array.isArray(document.security) && document.security.length > 0;

  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item ?? {})) {
      if (!HTTP_METHODS.includes(method)) continue;
      metrics.operations += 1;
      const where = `${method.toUpperCase()} ${path}`;

      if (operation.operationId) {
        metrics.withOperationId += 1;
        const previous = operationIds.get(operation.operationId);
        if (previous) {
          // Dos operaciones con el mismo id hacen que un cliente generado pise un método
          // con el otro, y el fallo aparece en el consumidor, no aquí.
          failures.push(`operationId duplicado "${operation.operationId}": ${previous} y ${where}`);
        }
        operationIds.set(operation.operationId, where);
      } else {
        failures.push(`${where} no declara operationId`);
      }

      if (operation.summary) metrics.withSummary += 1;
      else failures.push(`${where} no declara summary`);

      if (Array.isArray(operation.tags) && operation.tags.length) metrics.withTag += 1;
      else failures.push(`${where} no declara ninguna etiqueta`);

      const isPublic = PUBLIC_PATHS.has(path);
      const hasOwnSecurity = Array.isArray(operation.security) && operation.security.length > 0;
      const inherits = operation.security === undefined && documentSecurity;
      if (isPublic) {
        metrics.publicOperations += 1;
        if (hasOwnSecurity || inherits) {
          failures.push(`${where} es una sonda pública pero hereda seguridad`);
        }
      } else if (hasOwnSecurity || inherits) {
        metrics.withSecurity += 1;
        // Toda operación autenticada PUEDE ser rechazada por credencial o por rol; un
        // contrato que no lo dice deja al integrador sin saber qué manejar. Redocly no
        // puede exigirlo porque no distingue las sondas públicas.
        for (const status of ['401', '403']) {
          if (!operation.responses?.[status]) {
            failures.push(`${where} exige credencial pero no documenta ${status}`);
          }
        }
      } else {
        failures.push(`${where} no exige credencial y no está declarada pública`);
      }

      const responses = successResponses(operation);
      if (!responses.length) {
        failures.push(`${where} no declara ninguna respuesta de éxito`);
      } else if (responses.every((entry) => !requiresSchema(entry) || entry[1]?.content)) {
        metrics.withSuccessSchema += 1;
      } else {
        // La deuda llegó a CERO el 2026-07-31, así que la regla dejó de ser un trinquete y
        // pasó a fallo duro: describir el cuerpo de una respuesta nueva es ahora un requisito,
        // no una aspiración. El trinquete de abajo se conserva por si alguien tuviera que
        // reabrir deuda de forma consciente — bajar un límite es una decisión; subirlo, otra.
        //
        // Lo que NO cambia: no se fabrica un esquema aproximado. Un contrato que MIENTE sobre
        // la forma es peor que uno que reconoce no describirla.
        schemaDebt.push(where);
      }
    }
  }

  // Un secreto en el contrato publicado es un secreto filtrado: el fichero acaba en el
  // portal, en el repositorio y en cualquier cliente generado.
  //
  // Se recorre el documento y se miran los VALORES, saltando los campos que por definición
  // son identificadores (`operationId`, `$ref`, `operationRef`). Antes se probaba el
  // patrón contra el JSON serializado entero, y un operationId largo en camelCase
  // —`unresolvedClassificationReevaluationStatus`, 41 caracteres— casaba la forma base64 y
  // hacía fallar el gate por un secreto que no existe. Un falso positivo en una regla de
  // seguridad es caro: enseña a ignorarla.
  const IDENTIFIER_FIELDS = new Set(['operationId', '$ref', 'operationRef']);
  const SECRET_SHAPES = [/^[A-Za-z0-9+/]{40,}={0,2}$/, /BEGIN [A-Z ]*PRIVATE KEY/];
  const walkForSecrets = (value, field) => {
    if (typeof value === 'string') {
      if (IDENTIFIER_FIELDS.has(field)) return false;
      return SECRET_SHAPES.some((pattern) => pattern.test(value));
    }
    if (Array.isArray(value)) return value.some((item) => walkForSecrets(item, field));
    if (value && typeof value === 'object') {
      return Object.entries(value).some(([key, item]) => walkForSecrets(item, key));
    }
    return false;
  };
  if (walkForSecrets(document, '')) {
    failures.push(`El contrato contiene un valor con forma de secreto`);
  }

  // --- Trinquete de la deuda de esquemas de respuesta ---
  // El límite vive en el repositorio y solo puede BAJAR. Así la deuda es visible, medible y
  // no puede crecer sin que alguien edite el fichero a conciencia, que es exactamente la
  // conversación que debe ocurrir antes de publicar otro endpoint sin describir su cuerpo.
  schemaDebt.sort();
  metrics.successSchemaDebt = schemaDebt.length;
  let allowedDebt = Number.POSITIVE_INFINITY;
  try {
    const ratchet = JSON.parse(await readFile(debtPath, 'utf8'));
    allowedDebt = Number(ratchet.maxOperationsWithoutSuccessSchema);
  } catch {
    // Primera ejecución: se escribe el límite con lo que hay hoy.
    allowedDebt = schemaDebt.length;
  }
  if (schemaDebt.length > allowedDebt) {
    failures.push(
      `Operaciones sin esquema de respuesta: ${schemaDebt.length}, por encima del límite ${allowedDebt}. ` +
        `Declare el cuerpo de la respuesta nueva o baje el límite conscientemente en ${debtPath
          .split(/[\\/]/)
          .pop()}.`,
    );
  }
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    debtPath,
    `${JSON.stringify(
      {
        description:
          'Operaciones cuyo cuerpo de respuesta no está descrito en el contrato. El límite llegó a 0 el 2026-07-31: describir la respuesta de un endpoint nuevo es un requisito, no una aspiración. Este fichero solo puede bajar.',
        maxOperationsWithoutSuccessSchema: Math.min(allowedDebt, schemaDebt.length),
        current: schemaDebt.length,
        operations: schemaDebt,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  metrics.generatedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  const nonPublic = metrics.operations - metrics.publicOperations;
  console.log(
    [
      `Rutas: ${metrics.paths}  Operaciones: ${metrics.operations}  Esquemas: ${metrics.schemas}`,
      `operationId: ${metrics.withOperationId}/${metrics.operations}`,
      `summary: ${metrics.withSummary}/${metrics.operations}`,
      `etiqueta: ${metrics.withTag}/${metrics.operations}`,
      `seguridad: ${metrics.withSecurity}/${nonPublic} (+${metrics.publicOperations} públicas)`,
      `respuesta con esquema: ${metrics.withSuccessSchema}/${metrics.operations}` +
        (allowedDebt === 0
          ? ' (sin deuda: la regla es fallo duro)'
          : ` (deuda registrada: ${metrics.successSchemaDebt}, límite ${allowedDebt})`),
    ].join('\n'),
  );

  if (failures.length) {
    console.error(`\n${failures.length} problema(s):`);
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('\nContrato OpenAPI conforme.');
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

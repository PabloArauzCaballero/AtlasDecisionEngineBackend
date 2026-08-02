#!/usr/bin/env node
/**
 * Cobertura documental: qué partes del sistema real NO tienen documentación.
 *
 * Un portal puede compilar perfectamente y no describir la mitad del sistema. Esto compara el
 * árbol real —módulos, endpoints, variables de entorno, runbooks— con lo que el portal cubre,
 * y falla cuando aparece algo nuevo sin documentar. Es la diferencia entre «la documentación
 * es válida» y «la documentación está completa».
 *
 *   node scripts/docs/check-doc-coverage.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsRoot = join(repoRoot, 'docs');
const reportPath = join(docsRoot, 'reports', 'documentation-coverage.json');

async function main() {
  const failures = [];

  // --- Un módulo de dominio, una página ---
  const modules = (await readdir(join(repoRoot, 'src', 'modules'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const documentedModules = modules.filter((name) =>
    existsSync(join(docsRoot, 'modules', `${name}.md`)),
  );
  for (const name of modules) {
    if (!documentedModules.includes(name)) {
      failures.push(`El módulo \`${name}\` no tiene página. Ejecute \`yarn docs:catalog\`.`);
    }
  }

  // --- Toda etiqueta del contrato aparece en el catálogo de endpoints ---
  const spec = JSON.parse(await readFile(join(repoRoot, 'openapi', 'openapi.json'), 'utf8'));
  const catalog = await readFile(join(docsRoot, 'api', 'endpoint-catalog.md'), 'utf8');
  const tags = (spec.tags ?? []).map((tag) => tag.name);
  for (const tag of tags) {
    if (!catalog.includes(`## ${tag}`)) {
      failures.push(`La etiqueta \`${tag}\` no aparece en el catálogo de endpoints.`);
    }
  }

  // --- Toda operación del contrato aparece en el catálogo ---
  const operationIds = Object.values(spec.paths ?? {})
    .flatMap((item) => Object.values(item ?? {}))
    .filter((operation) => operation && typeof operation === 'object' && 'operationId' in operation)
    .map((operation) => operation.operationId);
  const missingOperations = operationIds.filter((id) => !catalog.includes(`\`${id}\``));
  if (missingOperations.length) {
    failures.push(
      `${missingOperations.length} operaciones no aparecen en el catálogo (p. ej. ${missingOperations.slice(0, 3).join(', ')}).`,
    );
  }

  // --- Toda variable del esquema aparece en su catálogo ---
  const environmentDoc = await readFile(
    join(docsRoot, 'getting-started', 'environment-variables.md'),
    'utf8',
  );
  const schema = await readFile(join(repoRoot, 'src', 'common', 'config', 'env.schema.ts'), 'utf8');
  const declared = [...schema.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):\s/gm)].map((match) => match[1]);
  const missingVariables = declared.filter((name) => !environmentDoc.includes(`\`${name}\``));
  if (missingVariables.length) {
    failures.push(
      `${missingVariables.length} variables de entorno sin documentar: ${missingVariables.slice(0, 5).join(', ')}.`,
    );
  }

  // --- Todo runbook enlazado desde su índice ---
  const runbookIndex = await readFile(join(docsRoot, 'runbooks', 'README.md'), 'utf8');
  const runbooks = (await readdir(join(docsRoot, 'runbooks'))).filter(
    (name) => name.endsWith('.md') && name !== 'README.md',
  );
  for (const runbook of runbooks) {
    if (!runbookIndex.includes(runbook)) {
      failures.push(`El runbook \`${runbook}\` no está enlazado desde su índice.`);
    }
  }

  const coverage = {
    generatedAt: new Date().toISOString(),
    modules: { total: modules.length, documented: documentedModules.length },
    apiTags: {
      total: tags.length,
      documented: tags.length - failures.filter((f) => f.includes('etiqueta')).length,
    },
    operations: {
      total: operationIds.length,
      documented: operationIds.length - missingOperations.length,
    },
    environmentVariables: {
      total: declared.length,
      documented: declared.length - missingVariables.length,
    },
    runbooks: runbooks.length,
    failures: failures.length,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');

  console.log(
    [
      `Módulos documentados: ${coverage.modules.documented}/${coverage.modules.total}`,
      `Operaciones en el catálogo: ${coverage.operations.documented}/${coverage.operations.total}`,
      `Variables documentadas: ${coverage.environmentVariables.documented}/${coverage.environmentVariables.total}`,
      `Runbooks: ${coverage.runbooks}`,
    ].join('\n'),
  );

  if (failures.length) {
    console.error(`\n${failures.length} brecha(s) de cobertura:`);
    console.error(failures.map((failure) => `- ${failure}`).join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('\nCobertura documental completa.');
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

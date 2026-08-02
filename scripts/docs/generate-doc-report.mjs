#!/usr/bin/env node
/**
 * Métricas de calidad documental, calculadas y no contadas a mano.
 *
 * El informe final de un trabajo así suele afirmar «100 % de endpoints documentados» sin que
 * nadie pueda comprobarlo. Esto lee los artefactos que producen los demás scripts y emite el
 * número real, con su fecha. Si una métrica no se puede calcular, se dice — es preferible a
 * publicar una cifra inventada.
 *
 *   node scripts/docs/generate-doc-report.mjs
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reportsDir = join(repoRoot, 'docs', 'reports');

async function readJson(name) {
  try {
    return JSON.parse(await readFile(join(reportsDir, name), 'utf8'));
  } catch {
    return null;
  }
}

function percentage(part, total) {
  if (!total) return '—';
  return `${Math.round((part / total) * 1000) / 10} %`;
}

async function countMarkdown(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) total += await countMarkdown(join(directory, entry.name));
    else if (entry.name.endsWith('.md')) total += 1;
  }
  return total;
}

async function main() {
  const openapi = await readJson('openapi-metrics.json');
  const catalog = await readJson('catalog-metrics.json');
  const coverage = await readJson('documentation-coverage.json');
  const debt = await readJson('openapi-response-schema-debt.json');
  const pages = await countMarkdown(join(repoRoot, 'docs'));

  const missing = [];
  if (!openapi) missing.push('openapi-metrics.json (ejecute `yarn docs:openapi:check`)');
  if (!catalog) missing.push('catalog-metrics.json (ejecute `yarn docs:catalog`)');
  if (!coverage) missing.push('documentation-coverage.json (ejecute `yarn docs:coverage`)');

  const nonPublic = openapi ? openapi.operations - openapi.publicOperations : 0;
  const rows = [
    [
      'Endpoints documentados en el catálogo',
      coverage ? percentage(coverage.operations.documented, coverage.operations.total) : '—',
      '100 %',
    ],
    [
      'Operaciones con `operationId`',
      openapi ? percentage(openapi.withOperationId, openapi.operations) : '—',
      '100 %',
    ],
    [
      'Operaciones con resumen',
      openapi ? percentage(openapi.withSummary, openapi.operations) : '—',
      '100 %',
    ],
    [
      'Operaciones con etiqueta',
      openapi ? percentage(openapi.withTag, openapi.operations) : '—',
      '100 %',
    ],
    [
      'Operaciones autenticadas con seguridad declarada',
      openapi ? percentage(openapi.withSecurity, nonPublic) : '—',
      '100 %',
    ],
    [
      'Operaciones con esquema de respuesta',
      openapi ? percentage(openapi.withSuccessSchema, openapi.operations) : '—',
      // El objetivo se redacta según el estado real: mientras hubo deuda, la regla era un
      // trinquete; al llegar a cero pasó a fallo duro, y decir lo contrario haría que este
      // informe describiera una puerta más débil que la que CI aplica de verdad.
      debt && debt.maxOperationsWithoutSuccessSchema === 0
        ? '100 % (fallo duro)'
        : '100 % (deuda con trinquete)',
    ],
    [
      'Módulos con página',
      coverage ? percentage(coverage.modules.documented, coverage.modules.total) : '—',
      '100 %',
    ],
    [
      'Variables de entorno documentadas',
      coverage
        ? percentage(coverage.environmentVariables.documented, coverage.environmentVariables.total)
        : '—',
      '100 %',
    ],
  ];

  const lines = [
    '<!-- GENERADO POR scripts/docs/generate-doc-report.mjs — NO EDITAR A MANO. -->',
    '',
    '# Métricas de calidad documental',
    '',
    `Calculadas el ${new Date().toISOString()}.`,
    '',
    '| Métrica | Valor | Objetivo |',
    '| --- | ---: | ---: |',
    ...rows.map(([name, value, target]) => `| ${name} | ${value} | ${target} |`),
    '',
    '## Inventario',
    '',
    '| Elemento | Cantidad |',
    '| --- | ---: |',
    `| Páginas del portal | ${pages} |`,
    `| Rutas del contrato | ${openapi?.paths ?? '—'} |`,
    `| Operaciones | ${openapi?.operations ?? '—'} |`,
    `| Esquemas | ${openapi?.schemas ?? '—'} |`,
    `| Módulos | ${catalog?.modules ?? '—'} |`,
    `| Entidades | ${catalog?.entities ?? '—'} |`,
    `| Eventos | ${catalog?.events ?? '—'} |`,
    `| Códigos de error | ${catalog?.errorCodes ?? '—'} |`,
    `| Variables de entorno | ${catalog?.environmentVariables ?? '—'} |`,
    `| Runbooks | ${coverage?.runbooks ?? '—'} |`,
    '',
    '## Esquemas de respuesta',
    '',
    !debt
      ? 'Sin datos; ejecute `yarn docs:openapi:check`.'
      : debt.maxOperationsWithoutSuccessSchema === 0
        ? 'Sin deuda: **toda** operación describe el cuerpo de su respuesta. La regla es un fallo duro — un endpoint nuevo que no lo haga rompe CI.'
        : `${debt.current} operaciones sin esquema del cuerpo de respuesta (límite ${debt.maxOperationsWithoutSuccessSchema}). ` +
          'El límite solo puede bajar: añadir un endpoint sin describir su respuesta hace fallar CI.',
    '',
  ];

  if (missing.length) {
    lines.push(
      '## Métricas no calculables',
      '',
      'Faltan artefactos de origen, así que estas cifras se declaran ausentes en vez de estimarse:',
      '',
      ...missing.map((entry) => `- ${entry}`),
      '',
    );
  }

  await writeFile(join(reportsDir, 'documentation-metrics.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`docs/reports/documentation-metrics.md escrito (${pages} páginas analizadas).`);
  if (missing.length) {
    console.error(`Faltan ${missing.length} artefacto(s) de origen; el informe lo declara.`);
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

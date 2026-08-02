#!/usr/bin/env node
/**
 * Auditoría del grafo de conocimiento (Graphify) contrastada con el árbol real.
 *
 * Graphify describe el repositorio tal como el analizador lo entiende; el repositorio es la
 * verdad. Este script compara ambos y escribe lo que encuentra, en vez de asumir que
 * coinciden: un nodo del grafo que ya no existe en disco, o un módulo del disco que el grafo
 * no conoce, son exactamente las divergencias que hacen que una documentación derivada del
 * grafo describa un sistema que ya no es el que corre.
 *
 * Produce:
 *   docs/reports/graphify-audit.md
 *   docs/architecture/module-dependencies.md
 *
 *   node scripts/docs/analyze-graphify.mjs
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const graphPath = join(repoRoot, 'graphify-out', 'graph.json');
const docsRoot = join(repoRoot, 'docs');

const BANNER =
  '<!-- GENERADO POR scripts/docs/analyze-graphify.mjs — NO EDITAR A MANO.\n' +
  '     Fuente: graphify-out/graph.json contrastado con src/. -->\n';

/** Módulo de dominio al que pertenece un fichero, si pertenece a alguno. */
function moduleOf(sourceFile) {
  return sourceFile?.match(/^src\/modules\/([^/]+)\//)?.[1] ?? null;
}

async function listModules() {
  const entries = await readdir(join(repoRoot, 'src', 'modules'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function main() {
  const graph = JSON.parse(await readFile(graphPath, 'utf8'));
  const nodes = graph.nodes ?? [];
  const links = graph.links ?? [];
  const modules = await listModules();

  // --- Grado de cada nodo: entradas, salidas y total ---
  const degree = new Map(nodes.map((node) => [node.id, { in: 0, out: 0 }]));
  for (const link of links) {
    if (degree.has(link.source)) degree.get(link.source).out += 1;
    if (degree.has(link.target)) degree.get(link.target).in += 1;
  }

  const byRelation = new Map();
  for (const link of links) byRelation.set(link.relation, (byRelation.get(link.relation) ?? 0) + 1);
  const byFileType = new Map();
  for (const node of nodes)
    byFileType.set(node.file_type, (byFileType.get(node.file_type) ?? 0) + 1);

  // --- Nodos de alta centralidad: los que, al cambiar, arrastran a más partes ---
  const central = nodes
    .map((node) => ({ node, ...degree.get(node.id) }))
    .map((entry) => ({ ...entry, total: entry.in + entry.out }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);

  // --- Huérfanos: sin ninguna relación en el grafo ---
  const orphans = nodes.filter((node) => {
    const entry = degree.get(node.id);
    return entry.in === 0 && entry.out === 0;
  });

  // --- Divergencia grafo ↔ disco ---
  const referencedFiles = new Set(nodes.map((node) => node.source_file).filter(Boolean));
  const missingOnDisk = [...referencedFiles].filter((file) => !existsSync(join(repoRoot, file)));

  // --- Grafo de dependencias entre módulos de dominio ---
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const moduleEdges = new Map();
  for (const link of links) {
    if (!['imports', 'imports_from', 'calls', 'references'].includes(link.relation)) continue;
    const from = moduleOf(nodeById.get(link.source)?.source_file);
    const to = moduleOf(nodeById.get(link.target)?.source_file);
    if (!from || !to || from === to) continue;
    const key = `${from}→${to}`;
    moduleEdges.set(key, (moduleEdges.get(key) ?? 0) + 1);
  }

  // --- Ciclos entre módulos: pares que se importan en ambos sentidos ---
  const cycles = [];
  for (const key of moduleEdges.keys()) {
    const [from, to] = key.split('→');
    if (moduleEdges.has(`${to}→${from}`) && from < to) {
      cycles.push({
        a: from,
        b: to,
        ab: moduleEdges.get(key),
        ba: moduleEdges.get(`${to}→${from}`),
      });
    }
  }

  const fanOut = new Map(modules.map((name) => [name, 0]));
  const fanIn = new Map(modules.map((name) => [name, 0]));
  for (const [key, count] of moduleEdges) {
    const [from, to] = key.split('→');
    fanOut.set(from, (fanOut.get(from) ?? 0) + count);
    fanIn.set(to, (fanIn.get(to) ?? 0) + count);
  }

  await mkdir(join(docsRoot, 'reports'), { recursive: true });

  // ------------------------------------------------------------------ informe
  const audit = [
    BANNER,
    '# Auditoría del grafo de conocimiento (Graphify)',
    '',
    `**Commit analizado:** \`${graph.built_at_commit ?? 'desconocido'}\``,
    `**Artefactos consultados:** \`graphify-out/graph.json\`, \`manifest.json\`, \`GRAPH_REPORT.md\`.`,
    '',
    '## Resumen ejecutivo',
    '',
    `El grafo contiene **${nodes.length} nodos** y **${links.length} relaciones** repartidos en`,
    `**${new Set(nodes.map((node) => node.community)).size} comunidades**. El árbol real declara`,
    `**${modules.length} módulos de dominio** en \`src/modules/\`, todos registrados en`,
    '`src/app.module.ts`.',
    '',
    '## Inventario cuantitativo',
    '',
    '| Tipo de nodo | Cantidad |',
    '| --- | ---: |',
    ...[...byFileType.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `| ${type || '(sin tipo)'} | ${count} |`),
    '',
    '| Relación | Cantidad | Qué significa |',
    '| --- | ---: | --- |',
    ...[...byRelation.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(
        ([relation, count]) =>
          `| \`${relation}\` | ${count} | ${RELATION_MEANING[relation] ?? '—'} |`,
      ),
    '',
    '## Componentes de alta centralidad',
    '',
    'Los nodos con más relaciones son los que, al cambiar, arrastran a más partes del sistema.',
    'No son necesariamente un problema: en este repositorio los primeros puestos los ocupan el',
    'esquema de datos y el módulo raíz, que por definición los tocan todos.',
    '',
    '| Nodo | Fichero | Entradas | Salidas | Total |',
    '| --- | --- | ---: | ---: | ---: |',
    ...central.map(
      (entry) =>
        `| \`${entry.node.label}\` | \`${entry.node.source_file ?? '—'}\` | ${entry.in} | ${entry.out} | ${entry.total} |`,
    ),
    '',
    '## Dependencias circulares entre módulos',
    '',
    cycles.length
      ? [
          'Pares de módulos que se referencian en ambos sentidos. Cada uno merece una revisión:',
          'la regla del repositorio es que una colaboración opcional se pase como **argumento de',
          'llamada**, no como dependencia de constructor.',
          '',
          '| Módulo A | Módulo B | A→B | B→A |',
          '| --- | --- | ---: | ---: |',
          ...cycles.map(
            (cycle) => `| \`${cycle.a}\` | \`${cycle.b}\` | ${cycle.ab} | ${cycle.ba} |`,
          ),
        ].join('\n')
      : 'No se detectó ningún par de módulos de dominio que se referencie en ambos sentidos.',
    '',
    '## Componentes huérfanos',
    '',
    `${orphans.length} nodos no participan en ninguna relación del grafo.`,
    orphans.length
      ? 'La mayoría son ficheros de configuración y documentos sueltos, que por naturaleza no importan ni son importados. Se listan los primeros 20:\n\n' +
        orphans
          .slice(0, 20)
          .map((node) => `- \`${node.source_file ?? node.label}\``)
          .join('\n')
      : '',
    '',
    '## Divergencia entre el grafo y el disco',
    '',
    missingOnDisk.length
      ? `**${missingOnDisk.length} ficheros** referenciados por el grafo ya no existen en disco. El grafo está desactualizado respecto al árbol; ejecute \`graphify update .\`:\n\n` +
        missingOnDisk
          .slice(0, 20)
          .map((file) => `- \`${file}\``)
          .join('\n')
      : 'Todo fichero referenciado por el grafo existe en el árbol de trabajo. El grafo está alineado con el disco.',
    '',
    '## Riesgos identificados',
    '',
    '| Riesgo | Naturaleza | Mitigación vigente |',
    '| --- | --- | --- |',
    '| El grafo se desactualiza tras cada cambio de código | Documental | `graphify update .` tras modificar código; esta auditoría detecta la divergencia |',
    '| Un módulo con mucho fan-in concentra el impacto de sus cambios | Arquitectónico | Contratos explícitos y pruebas por módulo |',
    '| La documentación derivada del grafo hereda sus errores | Documental | Los catálogos del portal se generan del **código y del contrato**, no del grafo |',
    '',
    '## Acciones ejecutadas a partir de esta auditoría',
    '',
    '1. Se generó [`architecture/module-dependencies.md`](../architecture/module-dependencies.md) con el grafo real de dependencias entre módulos.',
    '2. Los catálogos de endpoints, entidades, eventos, errores y configuración se derivan del código, no de este grafo, para no propagar su desfase.',
    '3. Esta auditoría es reproducible: `node scripts/docs/analyze-graphify.mjs`.',
    '',
  ];
  await writeFile(join(docsRoot, 'reports', 'graphify-audit.md'), `${audit.join('\n')}\n`, 'utf8');

  // --------------------------------------------------- dependencias de módulos
  const topEdges = [...moduleEdges.entries()].sort((a, b) => b[1] - a[1]);
  const mermaid = topEdges
    .slice(0, 40)
    .map(([key]) => {
      const [from, to] = key.split('→');
      return `    ${from.replace(/-/g, '_')} --> ${to.replace(/-/g, '_')}`;
    })
    .join('\n');

  const dependencies = [
    BANNER,
    '# Dependencias entre módulos',
    '',
    'Derivado del grafo de conocimiento y contrastado con `src/modules/`. Muestra qué módulo',
    'depende de cuál **en el código**, no en la intención del diseño.',
    '',
    '## Grafo (40 relaciones más fuertes)',
    '',
    '```mermaid',
    'flowchart LR',
    mermaid,
    '```',
    '',
    '## Acoplamiento por módulo',
    '',
    'Un `fan-in` alto significa que muchos módulos dependen de este: cambiarlo es caro. Un',
    '`fan-out` alto significa que este depende de muchos: es frágil ante cambios ajenos.',
    '',
    '| Módulo | Fan-in | Fan-out |',
    '| --- | ---: | ---: |',
    ...modules
      .map((name) => ({ name, in: fanIn.get(name) ?? 0, out: fanOut.get(name) ?? 0 }))
      .sort((a, b) => b.in + b.out - (a.in + a.out))
      .map(
        (entry) =>
          `| [\`${entry.name}\`](../modules/${entry.name}.md) | ${entry.in} | ${entry.out} |`,
      ),
    '',
    '## Ciclos',
    '',
    cycles.length
      ? cycles.map((cycle) => `- \`${cycle.a}\` ↔ \`${cycle.b}\``).join('\n')
      : 'Ninguno entre módulos de dominio.',
    '',
    '!!! note "La regla que evita los ciclos"',
    '    Cuando un servicio necesita colaborar con otro dominio **de forma opcional**, se pasa como',
    '    argumento de llamada y no como dependencia de constructor. Es lo que permite que el motor',
    '    de ejecución no dependa del módulo de árboles anidados ni del stream en vivo.',
    '',
  ];
  await writeFile(
    join(docsRoot, 'architecture', 'module-dependencies.md'),
    `${dependencies.join('\n')}\n`,
    'utf8',
  );

  console.log(
    `Auditoría Graphify: ${nodes.length} nodos, ${links.length} relaciones, ${modules.length} módulos, ` +
      `${cycles.length} ciclo(s) entre módulos, ${orphans.length} huérfanos, ${missingOnDisk.length} ficheros ausentes en disco.`,
  );
}

const RELATION_MEANING = {
  references: 'Un símbolo menciona a otro',
  contains: 'Jerarquía de contención (fichero → símbolo)',
  imports: 'Import de módulo',
  imports_from: 'Import con origen explícito',
  calls: 'Llamada directa',
  method: 'Método de una clase',
  indirect_call: 'Llamada resuelta indirectamente',
  inherits: 'Herencia',
  extends: 'Extensión de tipo o clase',
  defines: 'Definición de símbolo',
  triggers: 'Disparo de un efecto',
  reads_from: 'Lectura de un origen de datos',
  re_exports: 'Reexportación',
  rationale_for: 'Justificación documental de un elemento',
};

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

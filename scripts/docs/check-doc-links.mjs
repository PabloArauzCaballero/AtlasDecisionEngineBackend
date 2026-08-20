#!/usr/bin/env node
/**
 * Enlaces internos del portal y páginas huérfanas.
 *
 * MkDocs en modo estricto ya falla ante un enlace roto, pero exige Docker y tarda; esto da la
 * misma señal en segundos y además detecta lo que MkDocs no: una página que existe en `docs/`
 * y no está en la navegación, es decir, contenido escrito que nadie puede encontrar.
 *
 *   node scripts/docs/check-doc-links.mjs
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const docsRoot = join(repoRoot, 'docs');

async function markdownFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await markdownFiles(full)));
    else if (entry.name.endsWith('.md')) output.push(full);
  }
  return output;
}

/** Rutas declaradas en la navegación de mkdocs.yml, sin analizar YAML completo. */
async function navigationPaths(config) {
  const nav = config.split(/^nav:/m)[1] ?? '';
  return new Set([...nav.matchAll(/:\s*([A-Za-z0-9_\-./]+\.md)\s*$/gm)].map((match) => match[1]));
}

/**
 * Patrones de `exclude_docs`, la MISMA lista que usa MkDocs. Leerla de ahí evita que las dos
 * definiciones de «qué es parte del portal» se separen — que es exactamente el fallo que este
 * script existe para detectar.
 */
async function excludedPatterns(config) {
  const block = config.match(/^exclude_docs:\s*\|\n([\s\S]*?)(?=\n\S)/m)?.[1] ?? '';
  return (
    block
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      // Los patrones van anclados con `/` inicial en mkdocs.yml (sin anclar, la sintaxis
      // estilo gitignore los aplicaría a cualquier nivel). Aquí se compara contra la ruta
      // relativa a `docs/`, que no lleva esa barra.
      .map((line) => line.replace(/^\//, ''))
      .map((pattern) =>
        pattern.endsWith('/')
          ? new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
          : new RegExp(
              `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
            ),
      )
  );
}

async function main() {
  // Normalizado a LF: el archivo se edita indistintamente en Windows y Linux, y un `\r\n`
  // rompe en silencio el `\n` literal de los regex de abajo — el bloque de exclusión se leería
  // vacío y todo pasaría a considerarse parte del portal.
  const config = (await readFile(join(repoRoot, 'mkdocs.yml'), 'utf8')).replace(/\r\n/g, '\n');
  const allFiles = await markdownFiles(docsRoot);
  const nav = await navigationPaths(config);
  const excluded = await excludedPatterns(config);
  const isExcluded = (relativePath) => excluded.some((pattern) => pattern.test(relativePath));
  const files = allFiles.filter(
    (file) => !isExcluded(relative(docsRoot, file).replace(/\\/g, '/')),
  );
  const brokenLinks = [];
  const orphanPages = [];

  for (const file of files) {
    const relativePath = relative(docsRoot, file).replace(/\\/g, '/');
    const content = await readFile(file, 'utf8');

    for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      // Externos, anclas y correos no se resuelven contra el disco.
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [pathPart] = target.split('#');
      if (!pathPart) continue;
      const resolved = normalize(resolve(dirname(file), pathPart));
      if (!existsSync(resolved)) {
        brokenLinks.push(`${relativePath} → ${target}`);
      }
    }

    // Los ficheros de los catálogos generados por módulo se enlazan desde su índice, que sí
    // está en la navegación; no se exige que cada uno figure por separado.
    const isGeneratedModulePage =
      relativePath.startsWith('modules/') && relativePath !== 'modules/index.md';
    if (!nav.has(relativePath) && !isGeneratedModulePage) orphanPages.push(relativePath);
  }

  console.log(
    `Documentos del portal: ${files.length} (de ${allFiles.length} en docs/) · en navegación: ${nav.size} · ` +
      `enlaces rotos: ${brokenLinks.length} · huérfanos: ${orphanPages.length}`,
  );
  if (brokenLinks.length) {
    console.error('\nEnlaces rotos:');
    console.error(brokenLinks.map((entry) => `- ${entry}`).join('\n'));
  }
  if (orphanPages.length) {
    console.error('\nPáginas fuera de la navegación (nadie puede encontrarlas):');
    console.error(orphanPages.map((entry) => `- ${entry}`).join('\n'));
  }
  if (brokenLinks.length || orphanPages.length) process.exitCode = 1;
  else console.log('Navegación coherente.');
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});

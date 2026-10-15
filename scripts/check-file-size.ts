/**
 * Gate de tamaño de archivos runtime, tipo trinquete (modelo: AtlasBackend/scripts/check-file-size.ts).
 *
 * Objetivo: CONGELAR la deuda, no romper el build por lo que ya existe. Funciona contra un baseline
 * versionado (`.file-size-baseline.json`):
 *
 *   - Un archivo runtime NUEVO con más de 300 líneas  -> ERROR (no entra deuda nueva).
 *   - Un archivo del baseline que CRECE               -> ERROR (la deuda no empeora).
 *   - Un archivo del baseline aún sobre el límite     -> WARN  (deuda pendiente de dividir).
 *   - Un archivo del baseline que ADELGAZA            -> INFO  (corre `--update-baseline` para fijar la mejora).
 *
 * Exentos (datos declarativos, no lógica de control): migraciones, seeders, fixtures, seed-data,
 * constants y archivos generados (`*.generated.ts`).
 *
 * Uso:
 *   yarn check:file-size
 *   yarn check:file-size --update-baseline   # tras dividir un archivo, fija el nuevo piso
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const LIMIT = 300;

const EXEMPT_SEGMENTS = ['/migrations/', '/seeders/', '/seeds/', '/fixtures/'];
const EXEMPT_SUFFIXES = [
  '.fixtures.ts',
  '.seed-data.ts',
  '.constants.ts',
  '.generated.ts',
  '.seeder.ts',
];

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

export function isExempt(relPath: string): boolean {
  const withRoot = `/${relPath}`;
  if (EXEMPT_SEGMENTS.some((segment) => withRoot.includes(segment))) return true;
  return EXEMPT_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
}

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry.endsWith('.ts')) files.push(full);
  }
  return files;
}

/** Cuenta líneas; la cabecera JSDoc de archivo (@file/@business/@system) no cuenta. */
export function countLines(content: string): number {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '/**') return lines.length;

  const headerEnd = lines.slice(0, 10).findIndex((line) => line.trim() === '*/');
  const header = lines.slice(0, headerEnd + 1).join('\n');
  if (
    headerEnd >= 0 &&
    header.includes('@file') &&
    header.includes('@business') &&
    header.includes('@system')
  ) {
    return lines.length - (headerEnd + 1);
  }
  return lines.length;
}

export interface Evaluation {
  errors: string[];
  warnings: string[];
  improvements: string[];
}

/** Lógica pura del trinquete: compara el estado actual con el baseline. */
export function evaluate(
  current: Map<string, number>,
  baseline: Record<string, number>,
): Evaluation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const improvements: string[] = [];

  for (const [file, lines] of current) {
    const frozen = baseline[file];

    if (lines > LIMIT && frozen === undefined) {
      errors.push(
        `${file}: ${lines} líneas (límite ${LIMIT}). Archivo runtime NUEVO por encima del límite: divídelo o documenta la excepción en .file-size-baseline.json.`,
      );
      continue;
    }
    if (frozen !== undefined && lines > frozen) {
      errors.push(
        `${file}: creció de ${frozen} a ${lines} líneas. La deuda congelada no puede empeorar; divide el archivo.`,
      );
      continue;
    }
    if (frozen !== undefined && lines > LIMIT) {
      warnings.push(`${file}: ${lines} líneas (deuda congelada, objetivo ${LIMIT}).`);
    }
    if (frozen !== undefined && lines < frozen) {
      improvements.push(`${file}: ${frozen} -> ${lines} líneas.`);
    }
  }

  for (const file of Object.keys(baseline)) {
    if (!current.has(file)) improvements.push(`${file}: ya no existe (eliminado o renombrado).`);
  }
  return { errors, warnings, improvements };
}

function collect(): Map<string, number> {
  const result = new Map<string, number>();
  for (const file of walk(resolve(process.cwd(), 'src'))) {
    const rel = toPosix(relative(process.cwd(), file));
    if (isExempt(rel)) continue;
    result.set(rel, countLines(readFileSync(file, 'utf8')));
  }
  return result;
}

function baselinePath(): string {
  return resolve(process.cwd(), '.file-size-baseline.json');
}

function loadBaseline(): Record<string, number> {
  if (!existsSync(baselinePath())) return {};
  return JSON.parse(readFileSync(baselinePath(), 'utf8')) as Record<string, number>;
}

function updateBaseline(current: Map<string, number>): void {
  const offenders: Record<string, number> = {};
  for (const [file, lines] of [...current.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (lines > LIMIT) offenders[file] = lines;
  }
  writeFileSync(baselinePath(), `${JSON.stringify(offenders, null, 2)}\n`, 'utf8');
  console.log(
    `Baseline actualizado: ${Object.keys(offenders).length} archivos runtime sobre ${LIMIT} líneas.`,
  );
}

function main(): void {
  const current = collect();

  if (process.argv.includes('--update-baseline')) {
    updateBaseline(current);
    return;
  }

  const { errors, warnings, improvements } = evaluate(current, loadBaseline());

  if (improvements.length > 0) {
    console.log(
      `INFO: ${improvements.length} archivo(s) mejoraron. Corre "yarn check:file-size --update-baseline" para fijar el nuevo piso:`,
    );
    improvements.slice(0, 10).forEach((line) => console.log(`   - ${line}`));
  }
  if (warnings.length > 0) {
    console.warn(
      `WARN: ${warnings.length} archivo(s) runtime siguen sobre ${LIMIT} líneas (deuda congelada, pendiente de dividir).`,
    );
  }
  if (errors.length > 0) {
    console.error('ERROR: gate de tamaño de archivos runtime:');
    errors.forEach((error) => console.error(`   - ${error}`));
    process.exit(1);
  }
  console.log(
    `OK: gate de tamaño: sin archivos runtime nuevos sobre ${LIMIT} líneas ni crecimiento de la deuda congelada.`,
  );
}

if (require.main === module) main();

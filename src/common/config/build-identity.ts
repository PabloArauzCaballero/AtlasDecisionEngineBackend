import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Identidad del artefacto: commit e instante de build sellados en `dist/build-info.json`.
 *
 * Lo escribe `scripts/write-build-info.mjs` una sola vez, en la etapa de build, y viaja dentro de la
 * imagen. `COMMIT_SHA` (variable de runtime) nunca lo pisa: el compose de Coolify la define como
 * `${SOURCE_COMMIT:-local}`, así que sin esa inyección el Motor servía la cadena `local` como si fuera
 * el commit desplegado.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface BuildIdentity {
  commit: string | null;
  builtAt: string | null;
}

export const UNKNOWN_COMMIT = 'unknown';

export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && COMMIT_SHA.test(value);
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseBuildIdentity(raw: string): BuildIdentity {
  try {
    const parsed: unknown = JSON.parse(raw);
    const record =
      typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    return {
      commit: isCommitSha(record.commit) ? record.commit : null,
      builtAt: isIsoInstant(record.builtAt) ? record.builtAt : null,
    };
  } catch {
    return { commit: null, builtAt: null };
  }
}

export function loadBuildIdentity(path: string): BuildIdentity {
  try {
    return parseBuildIdentity(readFileSync(path, 'utf8'));
  } catch {
    return { commit: null, builtAt: null };
  }
}

/** Lo compilado manda. Sin dato compilado se respeta lo declarado en runtime, pero nunca vacío. */
export function resolveCommit(runtimeCommit: string | undefined, compiled: BuildIdentity): string {
  if (compiled.commit) return compiled.commit;
  const runtime = runtimeCommit?.trim();
  return runtime ? runtime : UNKNOWN_COMMIT;
}

export function defaultBuildInfoPath(): string {
  return resolve(process.cwd(), 'dist', 'build-info.json');
}

let cached: BuildIdentity | undefined;

/** Identidad compilada del proceso; se lee una vez porque el archivo es inmutable. */
export function compiledIdentity(): BuildIdentity {
  cached ??= loadBuildIdentity(defaultBuildInfoPath());
  return cached;
}

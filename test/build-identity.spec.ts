import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  isCommitSha,
  loadBuildIdentity,
  parseBuildIdentity,
  resolveCommit,
  UNKNOWN_COMMIT,
} from '../src/common/config/build-identity';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const BUILT_AT = '2026-09-30T01:02:03.000Z';

describe('resolveCommit', () => {
  it('lo compilado manda sobre COMMIT_SHA', () => {
    expect(resolveCommit(SHA_B, { commit: SHA_A, builtAt: BUILT_AT })).toBe(SHA_A);
  });

  it("OP-06: el 'local' del compose (${SOURCE_COMMIT:-local}) no suplanta el commit compilado", () => {
    expect(resolveCommit('local', { commit: SHA_A, builtAt: BUILT_AT })).toBe(SHA_A);
  });

  it('OP-01: sin dato compilado nunca devuelve cadena vacía', () => {
    for (const runtime of [undefined, '', '   ']) {
      expect(resolveCommit(runtime, { commit: null, builtAt: null })).toBe(UNKNOWN_COMMIT);
    }
  });

  it('sin dato compilado respeta lo declarado en runtime (p. ej. un entorno local)', () => {
    expect(resolveCommit('local-compose', { commit: null, builtAt: null })).toBe('local-compose');
    expect(resolveCommit(SHA_B, { commit: null, builtAt: null })).toBe(SHA_B);
  });
});

describe('parseBuildIdentity / loadBuildIdentity', () => {
  it('descarta commit y fecha inválidos', () => {
    expect(parseBuildIdentity(JSON.stringify({ commit: 'no-es-sha', builtAt: 'ayer' }))).toEqual({
      commit: null,
      builtAt: null,
    });
    expect(parseBuildIdentity('{roto')).toEqual({ commit: null, builtAt: null });
    expect(parseBuildIdentity('null')).toEqual({ commit: null, builtAt: null });
  });

  it('acepta un archivo bien formado', () => {
    expect(parseBuildIdentity(JSON.stringify({ commit: SHA_A, builtAt: BUILT_AT }))).toEqual({
      commit: SHA_A,
      builtAt: BUILT_AT,
    });
  });

  it('un archivo ausente da identidad vacía sin lanzar', () => {
    expect(loadBuildIdentity(join(tmpdir(), 'no-existe', 'build-info.json'))).toEqual({
      commit: null,
      builtAt: null,
    });
  });

  it('isCommitSha exige 40 hex en minúsculas', () => {
    expect(isCommitSha(SHA_A)).toBe(true);
    expect(isCommitSha(SHA_A.toUpperCase())).toBe(false);
    expect(isCommitSha(SHA_A.slice(1))).toBe(false);
    expect(isCommitSha(undefined)).toBe(false);
  });
});

describe('scripts/write-build-info.mjs (ejecutado de verdad)', () => {
  const script = resolve(__dirname, '../scripts/write-build-info.mjs');
  const run = (
    cwd: string,
    env: Record<string, string>,
  ): { commit: string | null; builtAt: string } => {
    const out = join(cwd, 'dist', 'build-info.json');
    execFileSync(process.execPath, [script, out], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: 'pipe',
    });
    return JSON.parse(readFileSync(out, 'utf8')) as { commit: string | null; builtAt: string };
  };
  const gitDir = (head: string): string => {
    const cwd = mkdtempSync(join(tmpdir(), 'wbi-'));
    mkdirSync(join(cwd, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(cwd, '.git', 'HEAD'), head);
    return cwd;
  };

  it('toma SOURCE_COMMIT válido, sella builtAt y lo lee el lado TypeScript', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wbi-'));
    const info = run(cwd, { SOURCE_COMMIT: SHA_A });
    expect(info.commit).toBe(SHA_A);
    expect(loadBuildIdentity(join(cwd, 'dist', 'build-info.json'))).toEqual({
      commit: SHA_A,
      builtAt: info.builtAt,
    });
  });

  it('SOURCE_COMMIT vacío cae a .git con HEAD desacoplado (así clona Coolify)', () => {
    expect(run(gitDir(`${SHA_B}\n`), { SOURCE_COMMIT: '' }).commit).toBe(SHA_B);
  });

  it('HEAD que apunta a un ref suelto y a un ref sólo empaquetado', () => {
    const suelto = gitDir('ref: refs/heads/dev\n');
    writeFileSync(join(suelto, '.git', 'refs', 'heads', 'dev'), `${SHA_A}\n`);
    expect(run(suelto, {}).commit).toBe(SHA_A);
    const empaquetado = gitDir('ref: refs/heads/dev\n');
    writeFileSync(
      join(empaquetado, '.git', 'packed-refs'),
      `# pack-refs\n${SHA_B} refs/heads/dev\n`,
    );
    expect(run(empaquetado, {}).commit).toBe(SHA_B);
  });

  it('SOURCE_COMMIT basura y sin .git deja null sin fallar el build', () => {
    expect(run(mkdtempSync(join(tmpdir(), 'wbi-')), { SOURCE_COMMIT: 'HEAD' }).commit).toBeNull();
  });
});

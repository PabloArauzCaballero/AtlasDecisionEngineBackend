/**
 * Escribe `dist/build-info.json` con el commit compilado y el instante del build.
 *
 * Se ejecuta en la etapa de build, después de `yarn build`. El commit sale, por este orden, de:
 *   1. el argumento de build `SOURCE_COMMIT` (Coolify lo define) si es un SHA de 40 hex;
 *   2. `.git` del checkout dentro del contexto de build (sólo HEAD, packed-refs y refs; ver .dockerignore).
 * Si ninguno da un SHA válido escribe `commit: null` y NO falla el build: la identidad no se inventa y el
 * smoke de release rechaza un servicio cuyo commit no coincide con el candidato.
 *
 * La lógica de lectura de `.git` vive sólo aquí (el script es JS plano); el lado TypeScript sólo lee el JSON.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/;

export function readCommitFromGitDir(gitDir) {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (SHA.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    try {
      const loose = readFileSync(join(gitDir, ref), 'utf8').trim();
      if (SHA.test(loose)) return loose;
    } catch {
      // el ref puede estar sólo en packed-refs
    }
    for (const line of readFileSync(join(gitDir, 'packed-refs'), 'utf8').split('\n')) {
      const [sha, name] = line.trim().split(' ');
      if (name === ref && SHA.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

const out = resolve(process.argv[2] ?? 'dist/build-info.json');
const fromArg = process.env.SOURCE_COMMIT?.trim();
const identity = {
  commit: fromArg && SHA.test(fromArg) ? fromArg : readCommitFromGitDir(resolve('.git')),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(identity, null, 2)}\n`);
console.log(`build-info: commit=${identity.commit ?? 'NO DETERMINADO'} builtAt=${identity.builtAt} -> ${out}`);

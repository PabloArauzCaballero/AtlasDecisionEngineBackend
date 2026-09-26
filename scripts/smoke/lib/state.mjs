/**
 * Estado compartido entre los tres smokes.
 *
 * El ciclo de vida de un algoritmo NO cabe en un solo tipo de usuario, y forzarlo sería
 * falsear la prueba: la segregación de funciones exige que quien escribe no apruebe y que
 * quien aprueba no despliegue. Así que el autor deja el artefacto compilado y en revisión,
 * el aprobador lo aprueba y el operador lo despliega; cada uno continúa donde el anterior
 * lo dejó, que es exactamente como ocurre en producción.
 *
 * Se persiste para que cada smoke pueda además correrse suelto: si el estado previo no
 * existe, los casos que dependen de él quedan OMITIDOS con el motivo, nunca en verde.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './config.mjs';

const STATE_FILE = join(OUT_DIR, 'state.json');

export async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export async function saveState(state) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Lectura con motivo: quien la use sabe qué decir cuando el dato no está. */
export function requireState(state, path) {
  const value = path.split('.').reduce((acc, key) => acc?.[key], state);
  if (value === undefined || value === null) {
    return { value: undefined, missing: `falta "${path}" del estado: corre antes el smoke que lo produce` };
  }
  return { value, missing: undefined };
}

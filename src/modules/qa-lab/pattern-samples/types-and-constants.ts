export const DIGITS = '0123456789';
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const WORD = `${LOWER}${UPPER}${DIGITS}_`;
/** Alfabeto para `.` y para los negados: imprimible, sin espacios ni sorpresas. */
export const ANY = `${LOWER}${UPPER}${DIGITS}`;

/**
 * Tope de caracteres emitidos por intento. Un `{1,100000}` es un patrón legítimo pero
 * pedirle su cadena completa reventaría la memoria del proceso por una entrada de
 * prueba; se corta y la comprobación final descarta el intento.
 */
export const EMISSION_BUDGET = 512;
/** Repeticiones añadidas sobre el mínimo en un cuantificador abierto (`*`, `+`, `{n,}`). */
export const OPEN_REPEAT_SLACK = 2;

export type PatternNode =
  | { kind: 'literal'; text: string }
  | { kind: 'class'; chars: readonly string[] }
  | { kind: 'group'; alternatives: PatternNode[][] }
  | { kind: 'repeat'; node: PatternNode; min: number; max: number };

export interface Cursor {
  source: string;
  index: number;
  failed: boolean;
}

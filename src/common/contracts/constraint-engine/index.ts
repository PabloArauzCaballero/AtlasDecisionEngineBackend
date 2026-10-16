/**
 * Motor de restricciones del contrato (§1.2): interpreta la definición declarativa
 * persistida y la impone ANTES de cualquier ejecución.
 *
 * Es la única implementación autoritativa. El frontend puede reproducir estas mismas
 * reglas para dar feedback inmediato, pero su resultado no se acepta como prueba: el
 * backend siempre reevalúa.
 */
export { isRequiredIn, parseConstraints, resolveConstraints } from './parse-and-resolve';
export { validateAgainstConstraints } from './validate';

/**
 * Reglas estáticas de las variables intermedias (§2.3).
 *
 * La disponibilidad se calcula aquí, en validación, y no en ejecución: el requisito es
 * que el motor IMPIDA leer una intermedia antes de crearla, y eso solo se puede
 * garantizar demostrando que el nodo productor domina a todos los lectores en el grafo.
 * Comprobarlo en runtime detectaría el fallo una ejecución demasiado tarde.
 */
export { intermediateAssignmentsOf, referencedIntermediates } from './collect';
export { validateGraphIntermediates } from './validate';
export type { GraphIntermediateResult } from './validate';

/**
 * El reloj de la decisión, inyectable.
 *
 * Una decisión compara fechas en tres sitios —vigencia de la base habilitante, frescura de cada
 * variable y vencimiento de la propia decisión— y tienen que usar EL MISMO instante. Cuando cada
 * uno consultaba `Date.now()` por su cuenta, una prueba con el reloj fijado daba por fresca una
 * fecha que para el evaluador estaba en el futuro, y en producción dos comprobaciones de la misma
 * petición podían caer a ambos lados de una medianoche de vencimiento.
 */
export type Clock = () => Date;

/** Token de inyección. Sin proveedor registrado se usa el reloj del sistema. */
export const DECISION_CLOCK = Symbol('DECISION_CLOCK');

export const systemClock: Clock = () => new Date();

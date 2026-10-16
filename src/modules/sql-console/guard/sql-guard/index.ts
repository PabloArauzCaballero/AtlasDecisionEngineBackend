/**
 * La guardia: qué SQL se deja llegar a la base.
 *
 * Es la PRIMERA de tres barreras, y conviene tener claro que ninguna de las tres se
 * sostiene sola:
 *
 *  1. Esta guardia léxica. Rápida, y sobre todo EXPLICATIVA: rechaza antes de abrir
 *     transacción y dice en qué línea y por qué. Es la que hace que la consola se pueda
 *     usar sin adivinar.
 *  2. El privilegio del rol de base de datos (`atlas_sql_console`, o `atlas_reader` cuando
 *     aquél no está provisionado) más `transaction_read_only` y un `search_path` acotado a
 *     los cinco datasets. Ésta es la barrera REAL: aunque la guardia tuviera un agujero, el
 *     rol no puede escribir porque no tiene el permiso.
 *  3. La inspección del plan (`query-executor.service.ts`): antes de ejecutar se pide el
 *     plan y se comprueba que toda relación recorrida pertenezca a un dataset. Es la que
 *     atrapa lo que un analizador léxico no puede ver —una función que lee otra tabla, una
 *     vista encadenada— porque pregunta al planificador en vez de al texto.
 *
 * Escribir sólo la (1) es el error clásico: una guardia de expresiones regulares que se
 * cree un intérprete. Escribir sólo la (2) deja al analista con `permission denied for
 * table decision_execution`, que no explica nada. Las tres juntas dan un sistema que
 * bloquea de verdad y además sabe decir por qué.
 */
export { guardSql } from './guard';
export { MAX_SQL_BYTES } from './types';
export type { GuardResult, GuardViolation } from './types';

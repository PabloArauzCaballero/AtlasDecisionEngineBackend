/**
 * Adaptador PostgreSQL del puerto de lectura de auditoría.
 *
 * Es el único archivo del módulo que habla Prisma. Toda consulta pasa por el asa que
 * entrega la fábrica, así que hereda sin código extra el enrutamiento por módulo, el
 * interruptor de separación de rutas, el fallback al primario, la normalización de errores
 * y las métricas por conexión.
 *
 * El descriptor pide `rowLevelSecurity`: este módulo sirve evidencia regulatoria de un
 * tenant y no puede enrutarse a un motor sin aislamiento a nivel de fila. Si alguien lo
 * apunta a uno, el contenedor no levanta.
 */
export { PostgresDecisionAuditReadAdapter } from './adapter';
export { AUDIT_QUERY_MODULE, EXECUTION_DETAIL_INCLUDE } from './shared';
export type { ExecutionDetailRow } from './shared';

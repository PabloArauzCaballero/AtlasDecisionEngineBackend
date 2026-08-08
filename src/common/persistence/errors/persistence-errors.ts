/**
 * Errores de persistencia normalizados.
 *
 * El caso de uso no debe ramificar sobre `error.code === '23505'`: eso ata el dominio al
 * motor tan fuerte como importar el driver. Cada adaptador traduce el fallo nativo a uno
 * de estos tipos y guarda la causa técnica en `cause`, que solo lee la observabilidad
 * interna — nunca la respuesta HTTP (§45).
 */

export interface PersistenceErrorContext {
  /** Nombre lógico de la conexión (`postgres-read`), nunca la cadena de conexión. */
  readonly connectionName?: string;
  readonly engine?: string;
  readonly operation?: string;
  /** Código nativo (SQLSTATE, código Prisma). Diagnóstico, no lógica de negocio. */
  readonly nativeCode?: string;
}

export class PersistenceError extends Error {
  readonly context: PersistenceErrorContext;

  constructor(message: string, context: PersistenceErrorContext = {}, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** La conexión no está disponible (caída, timeout de conexión, pool agotado). */
export class ConnectionUnavailableError extends PersistenceError {}
/** La entidad pedida no existe. */
export class EntityNotFoundError extends PersistenceError {}
/** Violación de unicidad. */
export class DuplicateEntityError extends PersistenceError {}
/** Violación de clave foránea. */
export class ForeignKeyConflictError extends PersistenceError {}
/** Columna obligatoria sin valor. */
export class RequiredFieldError extends PersistenceError {}
/** Conflicto de concurrencia optimista o de serialización. */
export class ConcurrencyConflictError extends PersistenceError {}
/** Interbloqueo detectado por el motor. */
export class DeadlockDetectedError extends ConcurrencyConflictError {}
/** La transacción no pudo completarse. */
export class TransactionFailedError extends PersistenceError {}
/** La consulta excedió su presupuesto de tiempo. */
export class QueryTimeoutError extends PersistenceError {}
/** El rol de base de datos no tiene el privilegio requerido. */
export class InsufficientPrivilegeError extends PersistenceError {}
/** La ruta pide una capacidad que el motor no ofrece; se detecta al arrancar. */
export class UnsupportedCapabilityError extends PersistenceError {}
/** La configuración de conexiones o de rutas es inválida. */
export class DataSourceConfigurationError extends PersistenceError {}
/** Se intentó una escritura por una conexión declarada de solo lectura. */
export class ReadOnlyConnectionError extends PersistenceError {}

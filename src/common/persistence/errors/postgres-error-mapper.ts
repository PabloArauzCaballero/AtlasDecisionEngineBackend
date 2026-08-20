/**
 * Traduce el fallo nativo de PostgreSQL (o del cliente Prisma sobre él) a la jerarquía
 * normalizada de `persistence-errors.ts`.
 *
 * El mensaje del driver NO se propaga tal cual: un `duplicate key value violates unique
 * constraint "decision_artifact_tenant_id_artifact_code_key"` filtra nombres de tabla y
 * de índice a quien provocó el error. Se conserva en `cause` para el log interno y se
 * emite un mensaje estable hacia arriba.
 */
import {
  ConcurrencyConflictError,
  ConnectionUnavailableError,
  DeadlockDetectedError,
  DuplicateEntityError,
  ForeignKeyConflictError,
  InsufficientPrivilegeError,
  PersistenceError,
  type PersistenceErrorContext,
  QueryTimeoutError,
  RequiredFieldError,
} from './persistence-errors';

type ErrorFactory = (message: string, context: PersistenceErrorContext, cause: unknown) => Error;

/** SQLSTATE → error normalizado. La clase 08 completa se trata por prefijo, más abajo. */
const BY_SQLSTATE: Record<string, { message: string; create: ErrorFactory }> = {
  '23505': {
    message: 'A record with the same unique key already exists',
    create: (m, c, e) => new DuplicateEntityError(m, c, e),
  },
  '23503': {
    message: 'The operation violates a foreign key relationship',
    create: (m, c, e) => new ForeignKeyConflictError(m, c, e),
  },
  '23502': {
    message: 'A required field was not provided',
    create: (m, c, e) => new RequiredFieldError(m, c, e),
  },
  '40001': {
    message: 'The transaction could not be serialized and must be retried',
    create: (m, c, e) => new ConcurrencyConflictError(m, c, e),
  },
  '40P01': {
    message: 'A deadlock was detected and the transaction was rolled back',
    create: (m, c, e) => new DeadlockDetectedError(m, c, e),
  },
  '42501': {
    message: 'The database role lacks the privilege required by this operation',
    create: (m, c, e) => new InsufficientPrivilegeError(m, c, e),
  },
  '57014': {
    message: 'The query exceeded its time budget and was cancelled',
    create: (m, c, e) => new QueryTimeoutError(m, c, e),
  },
  '53300': {
    message: 'The database refused the connection because it has too many clients',
    create: (m, c, e) => new ConnectionUnavailableError(m, c, e),
  },
};

/** Códigos de Prisma que no llevan SQLSTATE adjunto pero significan lo mismo. */
const BY_PRISMA_CODE: Record<string, { message: string; create: ErrorFactory }> = {
  P2002: BY_SQLSTATE['23505'],
  P2003: BY_SQLSTATE['23503'],
  P2011: BY_SQLSTATE['23502'],
  P1001: {
    message: 'The database is not reachable',
    create: (m, c, e) => new ConnectionUnavailableError(m, c, e),
  },
  P1002: {
    message: 'The database did not answer within the connection timeout',
    create: (m, c, e) => new ConnectionUnavailableError(m, c, e),
  },
  P1017: {
    message: 'The database closed the connection',
    create: (m, c, e) => new ConnectionUnavailableError(m, c, e),
  },
};

function nativeCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  if (typeof candidate.code === 'string') return candidate.code;
  // Prisma envuelve el error del driver: el SQLSTATE original viaja en `meta.code`.
  if (typeof candidate.meta?.code === 'string') return candidate.meta.code;
  return undefined;
}

/**
 * Normaliza cualquier fallo del camino de datos. Un error ya normalizado se devuelve tal
 * cual, para que envolver dos veces no borre el tipo original.
 */
export function normalizePostgresError(
  error: unknown,
  context: Omit<PersistenceErrorContext, 'nativeCode'> = {},
): Error {
  if (error instanceof PersistenceError) return error;

  const nativeCode = nativeCodeOf(error);
  const fullContext: PersistenceErrorContext = { ...context, engine: 'postgresql', nativeCode };

  if (nativeCode) {
    const mapped = BY_SQLSTATE[nativeCode] ?? BY_PRISMA_CODE[nativeCode];
    if (mapped) return mapped.create(mapped.message, fullContext, error);
    // Clase 08 completa: cualquier fallo de establecimiento/pérdida de conexión.
    if (nativeCode.startsWith('08')) {
      return new ConnectionUnavailableError(
        'The database connection is unavailable',
        fullContext,
        error,
      );
    }
  }

  // Los timeouts del pool de `pg` no llevan SQLSTATE; solo un mensaje conocido.
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout exceeded when trying to connect|Connection terminated/i.test(message)) {
    return new ConnectionUnavailableError(
      'The database connection is unavailable',
      fullContext,
      error,
    );
  }

  return new PersistenceError('The persistence operation failed', fullContext, error);
}

/** Solo para pruebas: los SQLSTATE que esta capa promete reconocer. */
export const MAPPED_SQLSTATES = Object.keys(BY_SQLSTATE);
export const MAPPED_PRISMA_CODES = Object.keys(BY_PRISMA_CODE);

import {
  ConcurrencyConflictError,
  ConnectionUnavailableError,
  DeadlockDetectedError,
  DuplicateEntityError,
  ForeignKeyConflictError,
  InsufficientPrivilegeError,
  PersistenceError,
  QueryTimeoutError,
  RequiredFieldError,
} from '../src/common/persistence/errors/persistence-errors';
import { normalizePostgresError } from '../src/common/persistence/errors/postgres-error-mapper';

/**
 * El caso de uso no debe ramificar sobre `error.code === '23505'`: eso ata el dominio al
 * motor tan fuerte como importar el driver. Esto fija la traducción y, sobre todo, que el
 * mensaje del driver —que lleva nombres de tabla e índice— no se propague hacia arriba.
 */
describe('postgres error normalization', () => {
  const pgError = (code: string, message = 'raw driver detail') =>
    Object.assign(new Error(message), { code });

  it.each([
    ['23505', DuplicateEntityError],
    ['23503', ForeignKeyConflictError],
    ['23502', RequiredFieldError],
    ['40001', ConcurrencyConflictError],
    ['40P01', DeadlockDetectedError],
    ['42501', InsufficientPrivilegeError],
    ['57014', QueryTimeoutError],
    ['53300', ConnectionUnavailableError],
  ])('maps SQLSTATE %s to its typed error', (code, type) => {
    const normalized = normalizePostgresError(pgError(code), { connectionName: 'postgres-write' });

    expect(normalized).toBeInstanceOf(type);
    expect((normalized as PersistenceError).context).toMatchObject({
      connectionName: 'postgres-write',
      engine: 'postgresql',
      nativeCode: code,
    });
  });

  it('maps the whole 08 class to a connection failure', () => {
    for (const code of ['08000', '08003', '08006', '08P01']) {
      expect(normalizePostgresError(pgError(code))).toBeInstanceOf(ConnectionUnavailableError);
    }
  });

  it('maps Prisma codes that never carry a SQLSTATE', () => {
    expect(normalizePostgresError(pgError('P2002'))).toBeInstanceOf(DuplicateEntityError);
    expect(normalizePostgresError(pgError('P1001'))).toBeInstanceOf(ConnectionUnavailableError);
    // Prisma envuelve el error del driver y deja el SQLSTATE original en `meta.code`.
    expect(
      normalizePostgresError({ name: 'PrismaClientKnownRequestError', meta: { code: '23505' } }),
    ).toBeInstanceOf(DuplicateEntityError);
  });

  it('recognises a pool timeout, which arrives without a SQLSTATE', () => {
    const timeout = new Error('timeout exceeded when trying to connect');

    expect(normalizePostgresError(timeout)).toBeInstanceOf(ConnectionUnavailableError);
  });

  it('never surfaces the driver message, but keeps it as the cause', () => {
    const raw = pgError(
      '23505',
      'duplicate key value violates unique constraint "decision_artifact_tenant_id_artifact_code_key"',
    );

    const normalized = normalizePostgresError(raw) as PersistenceError;

    expect(normalized.message).toBe('A record with the same unique key already exists');
    expect(normalized.message).not.toContain('decision_artifact');
    expect((normalized as { cause?: unknown }).cause).toBe(raw);
  });

  it('does not re-wrap an already normalized error', () => {
    const already = new DuplicateEntityError('already typed');

    expect(normalizePostgresError(already)).toBe(already);
  });

  it('falls back to the base type for an unknown failure', () => {
    const normalized = normalizePostgresError(new Error('something else entirely'));

    expect(normalized).toBeInstanceOf(PersistenceError);
    expect(normalized.constructor).toBe(PersistenceError);
    expect(normalized.message).toBe('The persistence operation failed');
  });
});

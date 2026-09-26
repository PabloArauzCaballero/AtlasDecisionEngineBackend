/**
 * Ejecutor de la ruta de escritura y gestor de transacciones PostgreSQL.
 *
 * Toda escritura de negocio y toda transacción se resuelven contra `postgres-write`; no
 * hay configuración que lo cambie por accidente porque el router rechaza al arrancar
 * cualquier regla que mande una escritura a una conexión de solo lectura. Una lectura
 * hecha DENTRO de una transacción usa el cliente transaccional que se recibe aquí, no la
 * réplica: mezclarlos rompería la atomicidad que la transacción existe para dar (§30).
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MetricsService } from '../../../observability/metrics.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { WRITE_CONNECTION } from '../../connections/connection-registry.service';
import { normalizePostgresError } from '../../errors/postgres-error-mapper';
import { PersistenceError, TransactionFailedError } from '../../errors/persistence-errors';
import type { TransactionContext, TransactionManager } from '../../ports/data-source.types';

/**
 * Clave del cliente transaccional dentro del contexto opaco.
 *
 * Es un símbolo y no una propiedad con nombre para que la capa de aplicación no pueda
 * alcanzarlo por casualidad: quien recibe un `TransactionContext` puede pasarlo a otro
 * puerto, pero no emitir consultas por su cuenta.
 */
export const TRANSACTION_CLIENT = Symbol('postgres.transactionClient');

export interface PostgresTransactionContext extends TransactionContext {
  readonly [TRANSACTION_CLIENT]: Prisma.TransactionClient;
}

/** Desenvuelve el contexto para un adaptador PostgreSQL; devuelve `undefined` si no es suyo. */
export function transactionClientOf(
  context: TransactionContext | undefined,
): Prisma.TransactionClient | undefined {
  if (!context || context.engine !== 'postgresql') return undefined;
  return (context as PostgresTransactionContext)[TRANSACTION_CLIENT];
}

@Injectable()
export class WritePathService implements TransactionManager {
  constructor(
    private readonly client: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /** Cliente de escritura para operaciones sueltas, dentro o fuera de una transacción. */
  clientFor(context?: TransactionContext): Prisma.TransactionClient | PrismaService {
    return transactionClientOf(context) ?? this.client;
  }

  async run<T>(
    moduleName: string,
    operation: string,
    command: (client: Prisma.TransactionClient | PrismaService) => Promise<T>,
    context?: TransactionContext,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await command(this.clientFor(context));
      this.record(moduleName, operation, 'ok', startedAt);
      return result;
    } catch (error) {
      this.record(moduleName, operation, 'error', startedAt);
      throw normalizePostgresError(error, { connectionName: WRITE_CONNECTION, operation });
    }
  }

  /**
   * Abre una transacción interactiva en la ruta de escritura. El GUC del tenant lo fija
   * `applyTenantRls` como primera sentencia, así que toda consulta dentro del callback ya
   * llega acotada al tenant.
   */
  async execute<T>(operation: (transaction: TransactionContext) => Promise<T>): Promise<T> {
    try {
      return await this.client.$transaction(async (tx) =>
        operation({
          connectionName: WRITE_CONNECTION,
          engine: 'postgresql',
          [TRANSACTION_CLIENT]: tx,
        } as PostgresTransactionContext),
      );
    } catch (error) {
      const normalized = normalizePostgresError(error, {
        connectionName: WRITE_CONNECTION,
        operation: 'transaction',
      });
      // Un fallo de transacción conserva su causa tipada (duplicado, interbloqueo…) para
      // que quien reintenta pueda decidir. Solo el fallo genérico —el que no encaja en
      // ningún código conocido— se reetiqueta como transacción fallida, que es lo único
      // que de verdad se sabe de él.
      throw normalized.constructor === PersistenceError
        ? new TransactionFailedError(
            'The transaction could not be completed',
            { connectionName: WRITE_CONNECTION, operation: 'transaction' },
            error,
          )
        : normalized;
    }
  }

  private record(
    moduleName: string,
    operation: string,
    outcome: 'ok' | 'error',
    startedAt: number,
  ): void {
    this.metrics.recordDatabaseOperation({
      connection: WRITE_CONNECTION,
      engine: 'postgresql',
      module: moduleName,
      operation,
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
}

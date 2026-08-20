import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { MessagingTraceService } from '../src/common/observability/messaging-trace.service';
import { BankStatementRunWorkerService } from '../src/modules/workers/bank-statement/bank-statement-run-worker.service';
import { SemanticRunWorkerService } from '../src/modules/workers/semantic-analysis/semantic-run-worker.service';
import type { SemanticAnalysisProcessor } from '../src/modules/workers/semantic-analysis/core/application/semantic-analysis.processor';

/**
 * La recuperación de leases vencidos, que tenía una fuga silenciosa.
 *
 * `claimNextRun` sólo toma filas con `attempt_count < maxAttempts`. La
 * recuperación las devolvía TODAS a `QUEUED`, incluidas las que ya habían
 * agotado sus intentos: nadie volvía a reclamarlas y nadie las cerraba, así que
 * se quedaban en cola para siempre. En pantalla eso se lee «En cola», que es una
 * promesa sobre un trabajo que no va a ocurrir jamás.
 *
 * Estas pruebas fijan las dos mitades: lo que aún tiene intentos vuelve a la
 * cola, lo que no, termina.
 */

const scheduler = { register: jest.fn(), wake: jest.fn() } as unknown as JobSchedulerService;
const trace = {
  runAsConsumer: (_carrier: unknown, _name: string, fn: () => Promise<void>) => fn(),
} as unknown as MessagingTraceService;

/** Recoge las llamadas a `updateMany` para poder afirmar sobre cada mitad. */
function espiaPrisma(tabla: string) {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  return { prisma: { [tabla]: { updateMany } } as unknown as PrismaService, updateMany };
}

/** La mitad que devuelve a la cola y la que cierra, identificadas por su efecto. */
function mitades(updateMany: jest.Mock) {
  const llamadas = updateMany.mock.calls.map(([argumento]) => argumento);
  return {
    aLaCola: llamadas.find((c) => c.data.status === WorkerRunStatus.QUEUED),
    cerradas: llamadas.find((c) => c.data.status === WorkerRunStatus.FAILED),
  };
}

describe('recuperación de ejecuciones con lease vencido', () => {
  it('el worker semántico devuelve a la cola lo que aún tiene intentos y cierra lo agotado', async () => {
    const { prisma, updateMany } = espiaPrisma('semanticAnalysisRun');
    const worker = new SemanticRunWorkerService(
      prisma,
      new ConfigService({ SEMANTIC_ANALYSIS_MAX_ATTEMPTS: 3 }),
      scheduler,
      {} as SemanticAnalysisProcessor,
      trace,
    );

    await (worker as unknown as { recoverExpiredRuns: () => Promise<void> }).recoverExpiredRuns();

    const { aLaCola, cerradas } = mitades(updateMany);

    expect(aLaCola?.where.attemptCount).toEqual({ lt: 3 });
    expect(aLaCola?.where.status).toBe(WorkerRunStatus.RUNNING);

    // Lo agotado se cierra, y no sólo lo que acaba de perder el lease: también
    // lo que ya estaba en QUEUED, que es el residuo de recuperaciones previas.
    expect(cerradas?.where.attemptCount).toEqual({ gte: 3 });
    expect(cerradas?.where.OR).toEqual(
      expect.arrayContaining([{ status: WorkerRunStatus.QUEUED }]),
    );
    expect(cerradas?.data.errorCode).toBe('SEMANTIC_RETRIES_EXHAUSTED');
    expect(cerradas?.data.finishedAt).toBeInstanceOf(Date);
  });

  it('el worker de extractos hace lo mismo y además suelta el documento', async () => {
    const { prisma, updateMany } = espiaPrisma('bankStatementRun');
    const worker = new BankStatementRunWorkerService(
      prisma,
      new ConfigService({ BANK_STATEMENT_MAX_ATTEMPTS: 3 }),
      scheduler,
      trace,
    );

    await (worker as unknown as { recoverExpiredRuns: () => Promise<void> }).recoverExpiredRuns();

    const { aLaCola, cerradas } = mitades(updateMany);

    expect(aLaCola?.where.attemptCount).toEqual({ lt: 3 });
    expect(cerradas?.where.attemptCount).toEqual({ gte: 3 });
    expect(cerradas?.data.errorCode).toBe('BANK_STATEMENT_RETRIES_EXHAUSTED');
    // Una ejecución que ya no va a procesarse no tiene por qué seguir guardando
    // el PDF de nadie: la promesa de no conservarlo vale también al cerrar.
    expect(cerradas?.data.fileBytes).toBeNull();
  });
});

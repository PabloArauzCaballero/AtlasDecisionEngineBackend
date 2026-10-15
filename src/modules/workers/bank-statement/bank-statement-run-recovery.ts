import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { toReview } from './statement-outcome';

/**
 * La recuperación de las conversiones de extracto que se quedaron sin quien las atienda:
 * leases vencidos, intentos agotados y esperas en cola que ya no tienen sentido.
 */
@Injectable()
export class BankStatementRunRecovery {
  private readonly logger = new Logger('BankStatementRunWorkerService');
  private lastRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Devuelve a la cola lo que perdió su lease porque el proceso que lo tenía
   * murió. Se ejecuta como mucho una vez por intervalo, no en cada ciclo: un
   * lease dura minutos, así que buscar vencidos dos veces por segundo sólo
   * puede encontrar nada.
   */
  async recoverExpiredRuns(): Promise<void> {
    const intervalMs = this.config.get<number>('BANK_STATEMENT_RECOVERY_INTERVAL_MS') ?? 30_000;
    if (Date.now() - this.lastRecoveryAt < intervalMs) return;
    this.lastRecoveryAt = Date.now();

    const maxAttempts = this.config.get<number>('BANK_STATEMENT_MAX_ATTEMPTS') ?? 3;
    const leaseVencido = {
      status: WorkerRunStatus.RUNNING,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
    };

    const recovered = await this.prisma.bankStatementRun.updateMany({
      where: { ...leaseVencido, attemptCount: { lt: maxAttempts } },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
        // Vuelve a esperar DESDE AHORA. Sin esto conserva el `queuedAt` original, que ya es más
        // viejo que el lease (300 s) y que el presupuesto de espera (180 s): `deriveLongWaits`, que
        // corre en la misma pasada, la mandaba a la cola humana como TIMEOUT sin reintentarla.
        queuedAt: new Date(),
      },
    });
    if (recovered.count > 0) {
      this.logger.warn(
        `Recuperadas ${recovered.count} ejecución(es) de extracto con lease vencido`,
      );
    }

    /*
     * Lo que ya agotó sus intentos se CIERRA, no vuelve a la cola.
     *
     * `claimNextRun` filtra por `attempt_count < maxAttempts`: devolver a QUEUED
     * una ejecución agotada la deja ahí para siempre, enseñando «En cola» sobre
     * un trabajo que nadie va a hacer. Se barre también lo que ya estaba en
     * QUEUED con los intentos agotados, que es el residuo de recuperaciones
     * anteriores; reclamarlo es imposible, así que cerrarlo no compite con nadie.
     *
     * El documento se borra al cerrar, igual que en cualquier otro final: una
     * ejecución que no va a procesarse no tiene por qué seguir guardando el PDF
     * de nadie.
     */
    const agotadas = await this.prisma.bankStatementRun.updateMany({
      where: {
        attemptCount: { gte: maxAttempts },
        OR: [leaseVencido, { status: WorkerRunStatus.QUEUED }],
      },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: 'BANK_STATEMENT_RETRIES_EXHAUSTED',
        errorMessage: 'La conversión se interrumpió y ya no quedaban reintentos.',
        finishedAt: new Date(),
        progress: 100,
        leaseExpiresAt: null,
        fileBytes: null,
      },
    });
    if (agotadas.count > 0) {
      this.logger.warn(`Cerradas ${agotadas.count} conversión(es) sin reintentos disponibles`);
    }

    await this.deriveLongWaits();
  }

  /**
   * Deriva a revisión lo que lleva demasiado tiempo esperando SIN QUE NADIE LO
   * HAYA TOMADO.
   *
   * Es el hueco que el presupuesto de procesamiento no puede cubrir: aquél corta
   * un análisis que EMPEZÓ, y esto ataja el caso en que no empezó ninguno —más
   * cola que capacidad, o réplicas saturadas—. Sin esto, «tarda mucho» y «nadie
   * la va a tomar en un rato» se ven exactamente igual desde la pantalla: «En
   * cola», indefinidamente, sobre un documento por el que alguien espera.
   *
   * Lo que NO cubre, y conviene no creerse lo contrario: si ninguna réplica tiene
   * el worker encendido, esto tampoco corre —cuelga de `runOnce`—. Ese caso lo
   * delata el panel de salud del worker, que es donde se mira, y no una fila que
   * se derivaría sola a una cola que nadie está atendiendo.
   *
   * Sale de la cola del worker y entra en la de personas, que es lo honesto: el
   * documento sigue siendo válido y lo que falló fue la capacidad de procesarlo
   * a tiempo. El PDF se conserva —el caso no está cerrado— para que se pueda
   * reprocesar desde la propia cola cuando el worker se recupere.
   */
  private async deriveLongWaits(): Promise<void> {
    const budgetMs = this.config.get<number>('BANK_STATEMENT_QUEUE_WAIT_BUDGET_MS') ?? 180_000;
    const outcome = toReview(StatementReviewReason.TIMEOUT);
    const derived = await this.prisma.bankStatementRun.updateMany({
      where: {
        status: WorkerRunStatus.QUEUED,
        queuedAt: { lt: new Date(Date.now() - budgetMs) },
      },
      data: {
        status: outcome.status,
        reviewReason: outcome.reviewReason,
        reviewPriority: outcome.reviewPriority,
        reviewOpenedAt: new Date(),
        progress: 0,
        leaseExpiresAt: null,
        errorCode: 'BANK_STATEMENT_QUEUE_WAIT_EXCEEDED',
        errorMessage: `La conversión esperó más de ${String(Math.round(budgetMs / 1_000))} s sin que ningún worker la tomara.`,
      },
    });
    if (derived.count > 0) {
      this.logger.warn(
        `Derivadas a revisión ${derived.count} conversión(es) por espera en cola excesiva`,
      );
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IdentityDomainError } from './core/domain/identity-domain.error';
import { describeError } from './describe-error';
import { outcomeForIdentityError, type IdentityRunOutcome } from './identity-outcome';

/** Cómo termina una verificación que no dio veredicto: desenlace de negocio, reintento o fallo definitivo. */
@Injectable()
export class IdentityRunFailureService {
  private readonly logger = new Logger(IdentityRunFailureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Distingue el fallo que no tiene arreglo del que sí.
   *
   * Una foto borrosa va a estar borrosa las tres veces: reintentarla sólo gasta
   * el worker y retrasa el aviso. Un proveedor saturado, en cambio, se cura
   * solo. Esa es la razón de que `IdentityDomainError` traiga `retryable`: la
   * categoría la fija el núcleo absorbido, no una lista de códigos aquí.
   */
  async recordFailure(runId: bigint, error: unknown): Promise<void> {
    /*
     * Antes que nada: ¿esto es un fallo, o es el worker acertando?
     *
     * Rechazar la foto de un recibo y derivar una cédula dudosa a una persona
     * NO son averías, y marcarlas `FAILED` mezclaba «esto no es un documento»
     * con «el proveedor biométrico se cayó» en la misma columna y en la misma
     * métrica. La tasa de fallos del worker subía cada vez que alguien subía una
     * foto equivocada, que es la forma más rápida de que nadie mire el tablero.
     */
    const desenlace = outcomeForIdentityError(error);
    if (desenlace !== null) {
      await this.closeWithOutcome(runId, error as IdentityDomainError, desenlace);
      return;
    }

    if (error instanceof IdentityDomainError && !error.retryable) {
      await this.failRun(runId, error.code, error.message);
      return;
    }

    const maxAttempts = this.config.get<number>('IDENTITY_MAX_ATTEMPTS') ?? 3;
    const current = await this.prisma.identityVerificationRun.findUnique({
      where: { id: runId },
      select: { attemptCount: true },
    });
    const exhausted = (current?.attemptCount ?? maxAttempts) >= maxAttempts;

    this.logger.error(
      `Verificación ${runId.toString()} falló (intento ` +
        `${current?.attemptCount ?? 0}/${maxAttempts}): ${describeError(error)}`,
    );

    if (exhausted) {
      await this.failRun(
        runId,
        error instanceof IdentityDomainError ? error.code : 'IDENTITY_PROCESSING_FAILED',
        'La verificación falló tras agotar los reintentos.',
      );
      return;
    }
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.QUEUED,
        startedAt: null,
        leaseExpiresAt: null,
        progress: 0,
      },
    });
  }

  /**
   * Cierra la ejecución en el estado que su desenlace dicta.
   *
   * Dos diferencias con `failRun`, y las dos importan:
   *
   * - **Un pendiente CONSERVA las imágenes.** La regla de privacidad —borrarlas
   *   al cerrar— sigue intacta porque un caso en revisión no está cerrado: sin
   *   ellas, la pestaña ofrecería «resolver» sobre una fila sin nada que mirar.
   *   Un rechazo, en cambio, es terminal y las borra como cualquier veredicto.
   * - **El mensaje se guarda en `errorMessage` también aquí.** Es lo que la
   *   pantalla enseña a quien subió la foto, y es exactamente la instrucción que
   *   necesita: «esto era un recibo» o «la cédula quedó a la espera de revisión».
   */
  async closeWithOutcome(
    runId: bigint,
    error: IdentityDomainError,
    outcome: IdentityRunOutcome,
  ): Promise<void> {
    const enRevision = outcome.status === WorkerRunStatus.PENDING_REVIEW;
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: outcome.status,
        errorCode: error.code,
        errorMessage: error.message,
        reviewReason: outcome.reviewReason,
        rejectionReason: outcome.rejectionReason,
        arbitrationMode: outcome.arbitrationMode,
        reviewPriority: outcome.reviewPriority,
        reviewOpenedAt: enRevision ? new Date() : null,
        finishedAt: enRevision ? null : new Date(),
        // Una ejecución cerrada deja la barra llena; un pendiente no, que ahí
        // todavía queda trabajo —sólo que lo hace una persona—. Sin esto, un
        // rechazo se quedaba con el progreso del momento en que la puerta dijo
        // que no, y una barra a un quinto se lee como un worker colgado.
        progress: enRevision ? undefined : 100,
        leaseExpiresAt: null,
        ...(enRevision ? {} : { documentBytes: null, documentBackBytes: null, selfieBytes: null }),
      },
    });
    this.logger.log(
      `Verificación ${runId.toString()} cerrada como ${outcome.status}` +
        `${outcome.reviewReason ? ` (${outcome.reviewReason})` : ''}` +
        `${outcome.rejectionReason ? ` (${outcome.rejectionReason})` : ''}.`,
    );
  }

  async failRun(runId: bigint, code: string, message: string): Promise<void> {
    await this.prisma.identityVerificationRun.updateMany({
      where: { id: runId, status: WorkerRunStatus.RUNNING },
      data: {
        status: WorkerRunStatus.FAILED,
        errorCode: code,
        errorMessage: message,
        finishedAt: new Date(),
        progress: 100,
        leaseExpiresAt: null,
        documentBytes: null,
        documentBackBytes: null,
        selfieBytes: null,
      },
    });
  }
}

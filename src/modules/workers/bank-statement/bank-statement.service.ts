import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { newRequestId, type ValidatedStatementInput } from './bank-statement-input';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';

/**
 * Estados terminales SIN resultado: subir otra vez el mismo documento vuelve a
 * intentarlo en lugar de devolver el intento anterior. Ver `createRun`.
 */
const RETRYABLE_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
  /*
   * `PDF_INVALID` está aquí por el MISMO motivo que `FAILED`, y es fácil de
   * pasar por alto: un rechazo es un veredicto del clasificador de ese día. Si
   * no fuera reintentable, ninguna recalibración de los umbrales ni ninguna
   * señal nueva alcanzaría jamás a los documentos que la motivaron —se afina el
   * triage, el mismo archivo sigue devolviendo «PDF no válido», y lo razonable
   * es concluir que el arreglo no sirvió—. Volver a subirlo es exactamente lo
   * que hace quien no está de acuerdo con el rechazo.
   */
  WorkerRunStatus.PDF_INVALID,
];

/** Estados desde los que ya no puede pasar nada más. */
const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
  WorkerRunStatus.PDF_INVALID,
];

/** Columnas que se devuelven al cliente. `fileBytes` NUNCA está entre ellas. */
const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  fileName: true,
  fileHash: true,
  fileSizeBytes: true,
  resultJson: true,
  warningsJson: true,
  confidence: true,
  documentTypeConfidence: true,
  institutionId: true,
  transactionCount: true,
  errorCode: true,
  errorMessage: true,
  reviewReason: true,
  rejectionReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  reviewResolvedBy: true,
  reviewResolvedAt: true,
  reviewNotes: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.BankStatementRunSelect;

export type BankStatementRunView = Prisma.BankStatementRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;

/**
 * Alta y consulta de ejecuciones del worker de extractos.
 *
 * No procesa nada: crea la fila, anuncia el trabajo y responde. El procesado
 * ocurre en `BankStatementRunWorkerService`, en otro proceso si el despliegue
 * lo separa. Esa frontera es el motivo de que el controlador no llame nunca al
 * motor de extractos directamente.
 */
@Injectable()
export class BankStatementService {
  private readonly logger = new Logger(BankStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly config: ConfigService,
    private readonly messagingTrace: MessagingTraceService,
  ) {}

  /**
   * Encola una conversión.
   *
   * Reenviar el mismo documento devuelve la ejecución que ya existe en vez de
   * crear una segunda. La deduplicación se apoya en el índice único
   * `(tenant_id, file_hash)` y **no** en una consulta previa: dos peticiones
   * simultáneas con el mismo archivo pasan las dos por un `SELECT` que no ve
   * nada y crean dos filas. Aquí la segunda choca contra la base, y ese choque
   * se traduce en la ejecución existente.
   */
  async createRun(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedStatementInput,
    source: WorkerInputSource,
    fixtureCode?: string,
  ): Promise<{ run: BankStatementRunView; deduplicated: boolean }> {
    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bankStatementRun.create({
          data: {
            tenantId,
            requestId: newRequestId(),
            status: WorkerRunStatus.QUEUED,
            inputSource: source,
            fixtureCode: fixtureCode ?? null,
            fileName: input.fileName,
            fileHash: input.fileHash,
            fileSizeBytes: input.bytes.byteLength,
            // Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>`, y un `Buffer`
            // de Node declara `ArrayBufferLike`, que en el sistema de tipos
            // admite también `SharedArrayBuffer`. Esto copia —una vez por
            // subida, con 10 MiB de techo— en lugar de resolverlo con un cast:
            // un cast escondería que los dos tipos no son intercambiables.
            fileBytes: new Uint8Array(input.bytes),
            requestedBy: principal.id,
            correlationId: principal.requestId,
            // Contexto de traza capturado AQUÍ, en el proceso de API: tras el commit se pierde,
            // y el worker que reclame esta fila en otro proceso ya no podría recuperarlo. Sin
            // traza activa queda nulo y el worker abre una traza raíz.
            traceCarrier: persistableCarrier(this.messagingTrace.inject()),
          },
          select: RUN_SELECTION,
        });
        // Dentro de la transacción a propósito: Postgres sólo entrega el aviso
        // si esto confirma, así que el worker nunca busca una ejecución que se
        // deshizo ni la busca antes de que sea visible.
        await this.jobSignal.notify(tx, JobName.BankStatement);
        return created;
      });
      return { run, deduplicated: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.bankStatementRun.findFirst({
        where: { tenantId, fileHash: input.fileHash },
        select: RUN_SELECTION,
      });
      // El índice saltó pero la fila no aparece: sólo puede pasar si se borró
      // entre las dos consultas. Propagar el error original es más honesto que
      // fingir un resultado.
      if (!existing) throw error;
      /*
       * Un intento FALLIDO no se sirve de la caché: se vuelve a intentar.
       *
       * La deduplicación es por huella del archivo y no caduca, así que un
       * documento que falló una vez respondía con ese fallo PARA SIEMPRE.
       * Volver a subirlo no cambiaba nada, y tampoco había clave con la que
       * forzar el reanálisis —el de extractos, a diferencia del semántico y el
       * de identidad, no admite `idempotencyKey`—. El efecto es que ninguna
       * corrección del lector de PDF alcanzaba jamás a los documentos que la
       * necesitaban: se arreglaba el motor, el mismo archivo seguía devolviendo
       * el error de antes, y lo razonable era concluir que el arreglo no servía.
       *
       * Lo que la deduplicación protege es no repetir TRABAJO YA HECHO. Un
       * fallo no es trabajo hecho: es la ausencia de resultado. Reintentarlo
       * cuesta lo mismo que costó fallar, y es lo que quiere decir quien vuelve
       * a subir el mismo archivo.
       */
      if (RETRYABLE_STATUSES.includes(existing.status)) {
        this.logger.debug(
          `Extracto con intento ${existing.status} para esta huella; se reencola ${existing.requestId}`,
        );
        return {
          run: await this.requeue(
            existing.requestId,
            tenantId,
            principal,
            input,
            source,
            fixtureCode,
          ),
          deduplicated: false,
        };
      }
      this.logger.debug(`Extracto ya encolado para esta huella; se devuelve ${existing.requestId}`);
      return { run: existing, deduplicated: true };
    }
  }

  /**
   * Devuelve a la cola una ejecución que terminó sin resultado.
   *
   * Se ACTUALIZA la fila en vez de crear otra porque la huella es única por
   * tenant: dos filas para el mismo documento no caben, y borrar y recrear
   * perdería el `requestId` que alguien pueda estar siguiendo.
   *
   * Los bytes se reponen desde la subida nueva, y no es un detalle: el worker
   * borra `fileBytes` en la misma transacción con la que cierra la ejecución
   * —es la decisión de privacidad de esta tabla—, así que la fila que se
   * reencola ya no tiene documento que analizar.
   */
  private async requeue(
    requestId: string,
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedStatementInput,
    source: WorkerInputSource,
    fixtureCode?: string,
  ): Promise<BankStatementRunView> {
    return this.prisma.$transaction(async (tx) => {
      const requeued = await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: {
          status: WorkerRunStatus.QUEUED,
          progress: 0,
          inputSource: source,
          fixtureCode: fixtureCode ?? null,
          fileName: input.fileName,
          fileSizeBytes: input.bytes.byteLength,
          fileBytes: new Uint8Array(input.bytes),
          // El rastro del intento anterior se limpia entero: dejar el código de
          // error junto a un estado QUEUED describiría una ejecución que no
          // existe.
          resultJson: Prisma.DbNull,
          warningsJson: Prisma.DbNull,
          confidence: null,
          documentTypeConfidence: null,
          institutionId: null,
          transactionCount: null,
          errorCode: null,
          errorMessage: null,
          // El expediente de revisión del intento anterior se limpia entero: un
          // motivo de revisión sobre una fila en cola describe un caso que ya no
          // existe, y la restricción de la base lo rechazaría de todos modos.
          reviewReason: null,
          rejectionReason: null,
          reviewPriority: null,
          reviewOpenedAt: null,
          reviewClaimedBy: null,
          reviewClaimedAt: null,
          reviewResolvedBy: null,
          reviewResolvedAt: null,
          reviewNotes: null,
          attemptCount: 0,
          leaseExpiresAt: null,
          queuedAt: new Date(),
          startedAt: null,
          finishedAt: null,
          requestedBy: principal.id,
          correlationId: principal.requestId,
          traceCarrier: persistableCarrier(this.messagingTrace.inject()),
        },
        select: RUN_SELECTION,
      });
      await this.jobSignal.notify(tx, JobName.BankStatement);
      return requeued;
    });
  }

  /** Una ejecución del tenant. Ajena o inexistente responden igual: 404. */
  async getRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_FOUND',
        'No existe esa ejecución.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: BankStatementRunView[]; total: number }> {
    const where: Prisma.BankStatementRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.bankStatementRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.bankStatementRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una ejecución que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`. Cancelar algo ya en curso exigiría que el processor
   * cooperase y una señal entre procesos que el motor no tiene; ofrecerlo en la
   * interfaz sería prometer algo que no se cumple.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<BankStatementRunView> {
    const updated = await this.prisma.bankStatementRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: {
        status: WorkerRunStatus.CANCELLED,
        finishedAt: new Date(),
        // El documento deja de hacer falta en cuanto se cancela.
        fileBytes: null,
      },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La ejecución ya terminó.'
          : 'La ejecución ya está siendo procesada y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }

  /** Máximo aceptado para un archivo, en bytes. Lo publica el catálogo. */
  maxUploadBytes(): number {
    return this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760;
  }
}

/** ¿Es la violación del índice único (P2002) y no otro fallo de la base? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

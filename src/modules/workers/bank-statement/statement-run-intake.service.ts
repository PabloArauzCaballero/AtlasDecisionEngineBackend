import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { newRequestId, type ValidatedStatementInput } from './bank-statement-input';
import { StatementFileStore } from './statement-file-store.service';
import { RETRYABLE_STATUSES, RUN_SELECTION, type BankStatementRunView } from './statement-run.view';
import {
  holderColumns,
  holderConflict,
  holderInputOf,
  type ExpectedHolderInput,
} from './expected-holder';

export { expectedHolderOf, type ExpectedHolderInput } from './expected-holder';

/**
 * Alta de ejecuciones del worker de extractos.
 *
 * No procesa nada: crea la fila, anuncia el trabajo y responde. El procesado
 * ocurre en `BankStatementRunWorkerService`, en otro proceso si el despliegue
 * lo separa. Esa frontera es el motivo de que el controlador no llame nunca al
 * motor de extractos directamente.
 */
@Injectable()
export class StatementRunIntakeService {
  private readonly logger = new Logger(StatementRunIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly files: StatementFileStore,
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
    expected: ExpectedHolderInput | null = null,
  ): Promise<{ run: BankStatementRunView; deduplicated: boolean }> {
    // El `requestId` sale del `create` porque ahora forma parte de la RUTA del objeto, y la ruta
    // hay que conocerla antes de escribirlo.
    const requestId = newRequestId();

    /*
     * El extracto se copia al almacén ANTES de crear la fila, por lo mismo que las imágenes de
     * identidad: al revés, una caída entre las dos operaciones deja una ejecución que se procesa,
     * decide y cierra sin que su documento se guardara nunca. Si el almacén falla no hay alta y el
     * cliente reintenta, que es preferible a una capacidad de pago sin el extracto que la sostiene.
     */
    const guardado = await this.files.store(tenantId, requestId, input, source);

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.bankStatementRun.create({
          data: {
            tenantId,
            requestId,
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
            // La copia que SOBREVIVE al cierre. `fileBytes` se sigue borrando igual.
            fileObjectKey: guardado?.objectKey ?? null,
            fileSha256: guardado?.sha256 ?? null,
            ...holderColumns(expected),
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
      // El objeto que se acaba de escribir quedó sin fila que lo referencie: la ruta lleva un
      // `requestId` que ya no va a existir. Se borra aquí y no en un barrido posterior porque este
      // es el único momento en que se sabe cuál es. Si la huella resulta duplicada y hay que
      // reencolar, `requeue` escribe el suyo bajo el `requestId` que sí sobrevive.
      if (guardado) await this.files.discard(guardado.objectKey);
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.bankStatementRun.findFirst({
        where: { tenantId, fileHash: input.fileHash },
        select: RUN_SELECTION,
      });
      // El índice saltó pero la fila no aparece: sólo puede pasar si se borró
      // entre las dos consultas. Propagar el error original es más honesto que
      // fingir un resultado.
      if (!existing) throw error;

      // El mismo PDF pedido para OTRO titular: ver `holderConflict`.
      const conflicto = holderConflict(existing, expected);
      if (conflicto === 'conflict') {
        throw new DomainException(
          'STATEMENT_HOLDER_CONFLICT',
          'Este extracto ya está en curso para otro titular.',
          HttpStatus.CONFLICT,
        );
      }
      if (conflicto === 'requeue') {
        const run = await this.requeue(
          existing.requestId,
          tenantId,
          principal,
          input,
          source,
          fixtureCode,
          expected,
        );
        return { run, deduplicated: false };
      }
      if (conflicto === 'pin') {
        const run = await this.prisma.bankStatementRun.update({
          where: { tenantId_requestId: { tenantId, requestId: existing.requestId } },
          data: holderColumns(expected),
          select: RUN_SELECTION,
        });
        return { run, deduplicated: true };
      }
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
      /*
       * Salvo que una PERSONA ya lo resolviera: un REJECT o un MARK_INVALID de la cola de revisión
       * deja la fila en FAILED / PDF_INVALID, pero con `reviewResolvedAt`. Reencolarla borraba esa
       * decisión (y su autor y sus notas) y mandaba el mismo archivo a buscar otro revisor. Una
       * resolución humana se respeta: se devuelve la ejecución con su veredicto.
       */
      /*
       * Tampoco se devuelve una ejecución cerrada SIN resultado (2026-10-15): un caso de banco no
       * reconocido aprobado antes de que existiera el análisis provisional quedó `SUCCEEDED_WITH_WARNINGS`
       * sin movimientos, y la deduplicación se lo devolvía para siempre a quien volvía a subir el PDF. No
       * hay análisis que respetar: se vuelve a leer.
       */
      const cerradaSinNada =
        existing.status === WorkerRunStatus.SUCCEEDED_WITH_WARNINGS && existing.resultJson === null;
      if (
        (RETRYABLE_STATUSES.includes(existing.status) && !existing.reviewResolvedAt) ||
        cerradaSinNada
      ) {
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
            expected ?? holderInputOf(existing),
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
    expected: ExpectedHolderInput | null = null,
  ): Promise<BankStatementRunView> {
    const guardado = await this.files.store(tenantId, requestId, input, source);

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
          // La copia duradera del intento NUEVO. Se repone junto con los bytes y por la misma
          // razón: la fila que se reencola perdió su documento al cerrarse el intento anterior.
          fileObjectKey: guardado?.objectKey ?? null,
          fileSha256: guardado?.sha256 ?? null,
          ...holderColumns(expected),
          holderNameRead: null,
          holderVerdict: null,
          // El rastro del intento anterior se limpia entero: dejar el código de
          // error junto a un estado QUEUED describiría una ejecución que no
          // existe.
          resultJson: Prisma.DbNull,
          provisionalResultJson: Prisma.DbNull,
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
}

/** ¿Es la violación del índice único (P2002) y no otro fallo de la base? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

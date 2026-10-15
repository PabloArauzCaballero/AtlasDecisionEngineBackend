import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { IdentityImageStore } from './identity-image-store.service';
import { RUN_SELECTION, type IdentityVerificationRunView } from './identity-run.view';
import type { IdentityVerificationOutcome } from './identity-result';
import { newRequestId, type ValidatedIdentityInput } from './identity-verification-input';

/**
 * Alta de verificaciones de identidad.
 *
 * No verifica nada: crea la fila, anuncia el trabajo y responde. Verificar
 * ocurre en `IdentityRunWorkerService`, en otro proceso si el despliegue lo
 * separa. Misma frontera que en los otros dos workers, y por el mismo motivo:
 * llamar al pipeline desde el controlador dejaría la petición abierta mientras
 * un proveedor biométrico se toma su tiempo.
 */
@Injectable()
export class IdentityRunIntakeService {
  private readonly logger = new Logger(IdentityRunIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly images: IdentityImageStore,
  ) {}

  /**
   * Encola una verificación.
   *
   * Reenviar las mismas imágenes devuelve la ejecución que ya existe en vez de
   * crear una segunda. La deduplicación se apoya en el índice único
   * `(tenant_id, input_hash)` y **no** en una consulta previa: dos peticiones
   * simultáneas con las mismas fotos pasan las dos por un `SELECT` que no ve
   * nada. Aquí la segunda choca contra la base, y ese choque se traduce en la
   * ejecución existente.
   */
  async createRun(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedIdentityInput,
    source: WorkerInputSource,
    options: { fixtureCode?: string; documentCountry: string },
  ): Promise<{ run: IdentityVerificationRunView; deduplicated: boolean }> {
    const imageSizeBytes =
      input.document.bytes.byteLength +
      (input.documentBack?.bytes.byteLength ?? 0) +
      input.selfie.bytes.byteLength;

    /*
     * El `requestId` deja de generarse dentro del `create` porque ahora forma parte de la RUTA de
     * los objetos, y la ruta hay que conocerla antes de escribirlos.
     */
    const requestId = newRequestId();

    /*
     * Las imágenes se copian al almacén ANTES de crear la fila, y esa es la decisión importante.
     *
     * Al revés —crear y luego subir— una caída entre las dos operaciones deja una ejecución que se
     * procesa, decide y cierra sin que su evidencia se haya guardado nunca, y sin que nadie se
     * entere hasta que alguien vaya a mirarla semanas después. En este orden, si el almacén falla
     * no hay alta: el cliente reintenta y vuelve a subir sus fotos, que es un incordio de diez
     * segundos frente a una decisión sin evidencia.
     *
     * El precio son objetos huérfanos cuando la huella resulta duplicada; se limpian abajo.
     */
    const objectKeys = await this.images.store(tenantId, requestId, input, source);

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.identityVerificationRun.create({
          data: {
            tenantId,
            requestId,
            status: WorkerRunStatus.QUEUED,
            inputSource: source,
            fixtureCode: options.fixtureCode ?? null,
            inputHash: input.inputHash,
            documentCountry: options.documentCountry,
            documentFileName: input.document.fileName,
            selfieFileName: input.selfie.fileName,
            imageSizeBytes,
            // `new Uint8Array(...)` y no un cast: Prisma tipa `Bytes` como
            // `Uint8Array<ArrayBuffer>` y un `Buffer` de Node declara
            // `ArrayBufferLike`. Copiar una vez por subida, con el techo de
            // tamaño ya aplicado, es más honesto que esconder con un cast que
            // los dos tipos no son intercambiables.
            documentBytes: new Uint8Array(input.document.bytes),
            documentBackBytes: input.documentBack ? new Uint8Array(input.documentBack.bytes) : null,
            selfieBytes: new Uint8Array(input.selfie.bytes),
            // La copia que SOBREVIVE al cierre. Las tres de arriba se siguen borrando igual.
            documentObjectKey: objectKeys?.document ?? null,
            documentBackObjectKey: objectKeys?.documentBack ?? null,
            selfieObjectKey: objectKeys?.selfie ?? null,
            // La huella del ORIGINAL, no la del objeto que hoy esté en el almacén: es lo único
            // que delata que la evidencia fue reemplazada.
            documentSha256: objectKeys?.documentSha256 ?? null,
            documentBackSha256: objectKeys?.documentBackSha256 ?? null,
            selfieSha256: objectKeys?.selfieSha256 ?? null,
            requestedBy: principal.id,
            correlationId: principal.requestId,
            traceCarrier: persistableCarrier(this.messagingTrace.inject()),
          },
          select: RUN_SELECTION,
        });
        // Dentro de la transacción a propósito: Postgres sólo entrega el aviso
        // si esto confirma, así que el worker nunca busca una ejecución que se
        // deshizo ni la busca antes de que sea visible.
        await this.jobSignal.notify(tx, JobName.IdentityVerification);
        return created;
      });
      return { run, deduplicated: false };
    } catch (error) {
      // Los objetos que se acaban de escribir quedaron sin fila que los referencie. Se borran aquí
      // y no en un barrido posterior porque este es el único momento en que se sabe cuáles son.
      await this.images.discardOrphans(objectKeys);
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.identityVerificationRun.findFirst({
        where: { tenantId, inputHash: input.inputHash },
        select: RUN_SELECTION,
      });
      if (!existing) throw error;
      this.logger.debug(
        `Verificación ya encolada para esta huella; se devuelve ${existing.requestId}`,
      );
      return { run: existing, deduplicated: true };
    }
  }

  /**
   * Conserva las imágenes de una verificación que hizo un nodo `WORKER` del grafo.
   *
   * Por la subida HTTP las imágenes se copiaban al almacén; por el nodo, no: el pipeline corría,
   * la decisión se tomaba, y las variables sensibles se guardaban sólo como huella. El detalle de
   * la ejecución no tenía qué enseñar de la cara y el carnet sobre los que se decidió. Esta fila
   * es esa evidencia, con el mismo almacén, la misma ruta y el mismo endpoint autenticado que una
   * subida —`GET runs/:requestId/images/:kind`—, y su `requestId` viaja en la traza del paso.
   *
   * Nace CERRADA y sin motivo de revisión: la decisión ya la tomó el grafo, y enrutar a una persona
   * es cosa del grafo. Si entrara como `PENDING_REVIEW` cada decisión dudosa aparecería dos veces,
   * una en cada bandeja. Las columnas `Bytes` no se rellenan: sólo existían para el worker.
   *
   * Devuelve `null` sin almacén: una decisión no se cae por no poder guardar su evidencia (quien
   * llama lo deja dicho en la traza). Las mismas fotos con las mismas reglas reutilizan la fila
   * que ya existe, por el índice único `(tenant_id, input_hash)`.
   */
  async recordInlineEvidence(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedIdentityInput,
    outcome: IdentityVerificationOutcome,
    documentCountry: string,
  ): Promise<string | null> {
    if (!this.images.isConfigured()) return null;

    const requestId = newRequestId();
    const objectKeys = await this.images.store(
      tenantId,
      requestId,
      input,
      WorkerInputSource.INLINE,
    );
    const now = new Date();
    try {
      await this.prisma.identityVerificationRun.create({
        data: {
          tenantId,
          requestId,
          status:
            outcome.decision === 'VERIFIED'
              ? WorkerRunStatus.SUCCEEDED
              : WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
          progress: 100,
          inputSource: WorkerInputSource.INLINE,
          inputHash: input.inputHash,
          documentCountry,
          documentFileName: input.document.fileName,
          selfieFileName: input.selfie.fileName,
          imageSizeBytes:
            input.document.bytes.byteLength +
            (input.documentBack?.bytes.byteLength ?? 0) +
            input.selfie.bytes.byteLength,
          resultJson: outcome as unknown as Prisma.InputJsonValue,
          warningsJson: [
            ...new Set([...outcome.reasonCodes, ...outcome.riskFlags]),
          ] as unknown as Prisma.InputJsonValue,
          decision: outcome.decision,
          documentType: outcome.documentType,
          documentTypeConfidence: outcome.documentEvidence.confidence,
          similarityScore: outcome.faceMatch?.similarityScore ?? null,
          documentObjectKey: objectKeys?.document ?? null,
          documentBackObjectKey: objectKeys?.documentBack ?? null,
          selfieObjectKey: objectKeys?.selfie ?? null,
          documentSha256: objectKeys?.documentSha256 ?? null,
          documentBackSha256: objectKeys?.documentBackSha256 ?? null,
          selfieSha256: objectKeys?.selfieSha256 ?? null,
          startedAt: now,
          finishedAt: now,
          requestedBy: principal.id,
          correlationId: principal.requestId,
        },
        select: { id: true },
      });
      return requestId;
    } catch (error) {
      await this.images.discardOrphans(objectKeys);
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.identityVerificationRun.findFirst({
        where: { tenantId, inputHash: input.inputHash },
        select: { requestId: true },
      });
      if (!existing) throw error;
      return existing.requestId;
    }
  }
}

/** ¿Es la violación del índice único (P2002) y no otro fallo de la base? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

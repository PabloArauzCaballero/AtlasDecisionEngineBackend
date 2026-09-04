import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ObjectStorageService } from '../../../common/storage/object-storage.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { IDENTITY_DEFAULTS } from './core/identity-options';
import { IDENTITY_PIPELINE_VERSION } from './identity-pipeline-version';
import {
  newRequestId,
  type ValidatedIdentityImage,
  type ValidatedIdentityInput,
} from './identity-verification-input';

/** Estados desde los que ya no puede pasar nada más. */
const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/**
 * Columnas que se devuelven al cliente.
 *
 * Las tres columnas de imágenes NUNCA están entre ellas. No es una precaución
 * de más: son la foto de la cara y del documento de una persona, y basta con
 * que una consulta las seleccione «por comodidad» para que viajen en cada
 * sondeo del portal mientras la ejecución corre.
 */
const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  documentCountry: true,
  documentFileName: true,
  selfieFileName: true,
  imageSizeBytes: true,
  resultJson: true,
  warningsJson: true,
  decision: true,
  documentType: true,
  similarityScore: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.IdentityVerificationRunSelect;

export type IdentityVerificationRunView = Prisma.IdentityVerificationRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;

/**
 * Alta y consulta de verificaciones de identidad.
 *
 * No verifica nada: crea la fila, anuncia el trabajo y responde. Verificar
 * ocurre en `IdentityRunWorkerService`, en otro proceso si el despliegue lo
 * separa. Misma frontera que en los otros dos workers, y por el mismo motivo:
 * llamar al pipeline desde el controlador dejaría la petición abierta mientras
 * un proveedor biométrico se toma su tiempo.
 */
@Injectable()
export class IdentityVerificationService {
  private readonly logger = new Logger(IdentityVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly config: ConfigService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly objectStorage: ObjectStorageService,
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
    const objectKeys = await this.storeIdentityImages(tenantId, requestId, input);

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
      await this.discardOrphanImages(objectKeys);
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
   * Copia las imágenes al almacén y devuelve sus claves.
   *
   * `null` cuando no hay almacén configurado: el motor tiene que poder correr en local y en las
   * pruebas sin MinIO, y la fila queda con las tres claves en `null`, que es la verdad —esa
   * ejecución no conservó nada—. Quien no acepte esa degradación pone
   * `IDENTITY_IMAGE_RETENTION_REQUIRED=true` y entonces ni siquiera arranca sin almacén, que es
   * donde debe descubrirse.
   *
   * Si el almacén SÍ está y rechaza una escritura, se propaga: «no hay almacén» y «hay almacén y
   * no me deja escribir» son dos cosas distintas, y tratarlas igual fue exactamente lo que dejó al
   * VPS aceptando subidas contra credenciales que MinIO no conocía.
   */
  private async storeIdentityImages(
    tenantId: bigint,
    requestId: string,
    input: ValidatedIdentityInput,
  ): Promise<{ document: string; documentBack: string | null; selfie: string } | null> {
    if (!this.objectStorage.isConfigured()) {
      this.logger.warn(
        `La verificación ${requestId} se encola SIN copia persistente de las imágenes: no hay almacén configurado. ` +
          'Sus imágenes se perderán al cerrar la ejecución.',
      );
      return null;
    }

    const escrituras: Array<{ campo: 'document' | 'documentBack' | 'selfie'; clave: string; imagen: ValidatedIdentityImage }> = [
      { campo: 'document', clave: this.buildKey(tenantId, requestId, 'document', input.document), imagen: input.document },
      { campo: 'selfie', clave: this.buildKey(tenantId, requestId, 'selfie', input.selfie), imagen: input.selfie },
      ...(input.documentBack
        ? [
            {
              campo: 'documentBack' as const,
              clave: this.buildKey(tenantId, requestId, 'document-back', input.documentBack),
              imagen: input.documentBack,
            },
          ]
        : []),
    ];

    // En paralelo: son dos o tres objetos pequeños contra el mismo servidor, y encadenarlos sólo
    // suma latencia a una petición que el cliente está esperando con el teléfono en la mano.
    const escritas: string[] = [];
    try {
      await Promise.all(
        escrituras.map(async ({ clave, imagen }) => {
          await this.objectStorage.put(clave, imagen.bytes, imagen.contentType);
          escritas.push(clave);
        }),
      );
    } catch (error) {
      // Una escritura parcial deja objetos que ninguna fila va a referenciar nunca.
      await Promise.all(escritas.map((clave) => this.objectStorage.remove(clave)));
      throw error;
    }

    return {
      document: escrituras.find((e) => e.campo === 'document')!.clave,
      documentBack: escrituras.find((e) => e.campo === 'documentBack')?.clave ?? null,
      selfie: escrituras.find((e) => e.campo === 'selfie')!.clave,
    };
  }

  private buildKey(
    tenantId: bigint,
    requestId: string,
    kind: 'document' | 'document-back' | 'selfie',
    imagen: ValidatedIdentityImage,
  ): string {
    // La extensión sale del tipo YA DETECTADO por bytes mágicos, no del nombre que mandó el
    // cliente: el nombre es dato de fuera y aquí decide una ruta.
    const extension = imagen.contentType === 'image/png' ? 'png' : imagen.contentType === 'image/webp' ? 'webp' : 'jpg';
    return this.objectStorage.buildIdentityKey({ tenantId, requestId, kind, extension });
  }

  /** Limpieza best-effort de lo que se subió para una fila que no llegó a existir. */
  private async discardOrphanImages(
    objectKeys: { document: string; documentBack: string | null; selfie: string } | null,
  ): Promise<void> {
    if (!objectKeys) return;
    const claves = [objectKeys.document, objectKeys.documentBack, objectKeys.selfie].filter(
      (clave): clave is string => clave !== null,
    );
    await Promise.all(claves.map((clave) => this.objectStorage.remove(clave)));
  }

  /**
   * Una de las tres imágenes de un caso, recuperada del almacén.
   *
   * Es la contrapartida de conservarlas: sin esto, persistir la cara y el carnet sólo llenaría un
   * bucket que nadie puede consultar. Los bytes se sirven POR LA API y no por una URL firmada del
   * almacén, y eso es deliberado — la autorización por tenant y por rol la impone este proceso, y
   * una URL prefirmada se puede reenviar por un chat y sigue funcionando hasta que vence.
   *
   * `null` cuando la ejecución no tiene esa imagen: puede ser un caso sin reverso, o —para las
   * ejecuciones anteriores al 2026-09-03— uno cuyas imágenes ya se perdieron. Quien llama lo
   * traduce a 404; distinguir los dos casos no aportaría nada a quien mira la pantalla.
   */
  async getRunImage(
    tenantId: bigint,
    requestId: string,
    kind: 'document' | 'documentBack' | 'selfie',
  ): Promise<{ content: Buffer; contentType: string } | null> {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: { documentObjectKey: true, documentBackObjectKey: true, selfieObjectKey: true },
    });
    if (!run) {
      // 404 y no 403, igual que en `getRun`: un 403 confirmaría que la ejecución existe y es de
      // otro tenant.
      throw new DomainException(
        'IDENTITY_RUN_NOT_FOUND',
        'No existe esa verificación.',
        HttpStatus.NOT_FOUND,
      );
    }

    const objectKey =
      kind === 'document'
        ? run.documentObjectKey
        : kind === 'documentBack'
          ? run.documentBackObjectKey
          : run.selfieObjectKey;
    if (!objectKey) return null;

    const stored = await this.objectStorage.get(objectKey);
    if (!stored) return null;
    return { content: stored.content, contentType: stored.contentType ?? 'application/octet-stream' };
  }

  /** Una ejecución del tenant. Ajena o inexistente responden igual: 404. */
  async getRun(tenantId: bigint, requestId: string): Promise<IdentityVerificationRunView> {
    const run = await this.prisma.identityVerificationRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'IDENTITY_RUN_NOT_FOUND',
        'No existe esa verificación.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: IdentityVerificationRunView[]; total: number }> {
    const where: Prisma.IdentityVerificationRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.identityVerificationRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.identityVerificationRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una verificación que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`, igual que en el worker de extractos: cancelar algo ya
   * en curso exigiría que el pipeline cooperase y una señal entre procesos que
   * el motor no tiene, y ofrecerlo en la interfaz sería prometer algo que no se
   * cumple. Las imágenes se borran al cancelar: dejaron de hacer falta.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<IdentityVerificationRunView> {
    const updated = await this.prisma.identityVerificationRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: {
        status: WorkerRunStatus.CANCELLED,
        finishedAt: new Date(),
        documentBytes: null,
        documentBackBytes: null,
        selfieBytes: null,
      },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'IDENTITY_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La verificación ya terminó.'
          : 'La verificación ya está en proceso y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }

  /** Máximo aceptado por imagen, en bytes. Lo publica el catálogo. */
  maxUploadBytes(): number {
    return this.config.get<number>('IDENTITY_MAX_UPLOAD_BYTES') ?? IDENTITY_DEFAULTS.maxUploadBytes;
  }

  /**
   * Las REGLAS con las que se decidiría hoy, condensadas en una cadena.
   *
   * Entra en la huella de idempotencia, y no es un adorno. La deduplicación se
   * apoyaba sólo en las imágenes, y un veredicto no es función de las imágenes:
   * es función de las imágenes Y de la calibración con la que se miran. Con la
   * clave anterior, reenviar las mismas fotos después de recalibrar devolvía el
   * veredicto viejo — se vio en una captura de este mismo trabajo, con la
   * pantalla enseñando un resultado calculado por una versión anterior del motor
   * y sin ninguna señal de que lo fuera.
   *
   * Incluye el perfil, los dos umbrales, los proveedores y si la prueba de vida
   * está encendida: cambiar cualquiera de esos cambia el veredicto posible, así
   * que cambia también la huella y la verificación se vuelve a calcular.
   *
   * Y la VERSIÓN DEL CANAL DE LECTURA (`IDENTITY_PIPELINE_VERSION`), que faltaba
   * y costó caro: un veredicto es función de tres cosas —imágenes, calibración
   * y el código que las lee—, no de dos. Al arreglar el lector de la MRZ, la
   * huella no se movía, así que reenviar las mismas fotos devolvía el veredicto
   * guardado con el lector viejo: desde la pantalla, indistinguible de un
   * arreglo que no sirvió.
   *
   * Lo que NO incluye es la versión de la aplicación ni el commit: un despliegue
   * que no toca ni la calibración ni el canal no debe invalidar el historial de
   * idempotencia y hacer que todo el mundo reprocese —y pague— por un cambio en
   * otro worker.
   */
  decisionRulesFingerprint(): string {
    const get = <T>(key: string, fallback: T): T => this.config.get<T>(key) ?? fallback;
    const livenessEnabled = get('IDENTITY_LIVENESS_ENABLED', IDENTITY_DEFAULTS.livenessEnabled);
    return [
      `canal-v${String(IDENTITY_PIPELINE_VERSION)}`,
      get('IDENTITY_THRESHOLD_PROFILE_VERSION', IDENTITY_DEFAULTS.thresholdProfileVersion),
      String(this.config.get<number>('IDENTITY_MATCH_THRESHOLD') ?? 'sin-umbral'),
      String(this.config.get<number>('IDENTITY_REVIEW_THRESHOLD') ?? 'sin-umbral'),
      get('IDENTITY_OCR_PROVIDER', IDENTITY_DEFAULTS.ocrProvider),
      get('IDENTITY_FACE_PROVIDER', IDENTITY_DEFAULTS.faceProvider),
      livenessEnabled
        ? get('IDENTITY_LIVENESS_PROVIDER', IDENTITY_DEFAULTS.livenessProvider)
        : 'disabled',
    ].join('|');
  }

  /** País de emisión asumido cuando quien llama no declara otro. */
  defaultDocumentCountry(): string {
    return (
      this.config.get<string>('IDENTITY_DEFAULT_DOCUMENT_COUNTRY') ??
      IDENTITY_DEFAULTS.defaultDocumentCountry
    );
  }
}

/** ¿Es la violación del índice único (P2002) y no otro fallo de la base? */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

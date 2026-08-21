/**
 * Ejecuta la llamada que declara un nodo `WORKER` del grafo.
 *
 * Es el puente entre el motor de decisión y los dos workers absorbidos (ADR-0026). Lo que
 * un nodo invoca aquí es el NÚCLEO del worker —el motor de extractos, el pipeline
 * semántico—, no su cola: la decisión necesita la respuesta en el mismo instante en que la
 * pide, y una cola sirve justo para lo contrario. La cola sigue siendo el camino de las
 * conversiones que se piden por HTTP y que nadie está esperando en línea; ambos usos
 * conviven porque comparten el núcleo, que no sabe de ninguno de los dos.
 *
 * Se pasa a `ExecutionEngineService.execute()` como argumento de llamada —vía `bind()`—,
 * nunca como dependencia de constructor, para que `GraphModule` no dependa de este módulo.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { DomainException } from '../../common/errors/domain-exception';
import type {
  WorkerServiceInvoker,
  WorkerServiceOutcome,
  WorkerServiceRequest,
} from '../graph/graph.types';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { validateStatementUpload } from './bank-statement/bank-statement-input';
import { StatementProcessingError } from './bank-statement/core/domain/errors';
import { InstitutionCatalogService } from './bank-statement/institutions/institution-catalog.service';
import {
  createStatementEngine,
  type StatementEngine,
} from './bank-statement/core/statement-engine';
import { SemanticAnalysisPipeline } from './semantic-analysis/core/application/semantic-analysis.pipeline';
import type { SemanticAnalysisResult } from './semantic-analysis/core/domain/semantic-analysis.types';
import { AudioTtsRuntimeFactory } from './audio-tts/audio-tts.runtime';
import { IdentityPipelineService } from './identity-verification/identity-pipeline.service';
import { validateIdentityUpload } from './identity-verification/identity-verification-input';
import type { IdentityVerificationOutcome } from './identity-verification/identity-result';
import { buildAudioOutcome } from './audio-tts/audio-tts.result';
import { AudioDomainError } from './audio-tts/core/domain/errors';

/** Techo absoluto de una llamada desde un nodo, en milisegundos. */
const MAX_CALL_TIMEOUT_MS = 120_000;

@Injectable()
export class WorkerServiceInvokerService {
  /**
   * Perezoso y memorizado, igual que en el worker de fondo: construir el motor arrastra
   * `pdfjs-dist` y registra los siete analizadores, y eso no puede pagarse por decisión.
   */
  private readonly statementEngines = new Map<string, StatementEngine>();

  constructor(
    private readonly config: ConfigService,
    private readonly semantic: SemanticAnalysisPipeline,
    private readonly audio: AudioTtsRuntimeFactory,
    private readonly institutions: InstitutionCatalogService,
    private readonly identity: IdentityPipelineService,
  ) {}

  /** Ata el invocador al tenant y al principal de UNA ejecución, para `engine.execute()`. */
  bind(tenantId: bigint, principal: AuthenticatedPrincipal): WorkerServiceInvoker {
    return { invoke: (request) => this.invoke(tenantId, principal, request) };
  }

  private async invoke(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    request: WorkerServiceRequest,
  ): Promise<WorkerServiceOutcome> {
    const started = Date.now();
    const key = `${request.service}.${request.operation}`;
    switch (key) {
      case 'bank-statement.normalize':
        return this.normalizeStatement(tenantId, request, started);
      case 'semantic-analysis.classify':
        return this.classifyText(tenantId, principal, request, started);
      case 'audio-tts.speak':
        return this.speak(tenantId, principal, request, started);
      case 'identity-verification.verify':
        return this.verifyIdentity(request, started);
      default:
        // El validador de grafo ya rechaza un servicio desconocido al aprobar el
        // artefacto. Llegar aquí significa que el catálogo del validador y el de este
        // servicio se separaron, y eso no puede resolverse adivinando.
        throw new DomainException(
          'WORKER_SERVICE_UNKNOWN',
          `El nodo ${request.nodeKey} invoca ${key}, que este motor no sabe ejecutar`,
          HttpStatus.NOT_IMPLEMENTED,
        );
    }
  }

  /**
   * Convierte un extracto en PDF al contrato normalizado.
   *
   * El documento llega en base64 dentro de una variable de la decisión, y no como una
   * referencia a una subida previa, porque el nodo es una LLAMADA: pide el análisis del
   * documento que la petición trae, no el resultado de un trabajo que alguien encoló antes.
   */
  private async normalizeStatement(
    tenantId: bigint,
    request: WorkerServiceRequest,
    started: number,
  ): Promise<WorkerServiceOutcome> {
    this.assertAvailable(
      'bank-statement',
      this.config.get<boolean>('BANK_STATEMENT_WORKER_ENABLED') ?? false,
      request.nodeKey,
    );

    // La MISMA validación que aplica la subida por HTTP: tamaño, firma real del contenido
    // y nombre seguro. Que un documento entre por un nodo en vez de por un formulario no
    // puede relajar lo que se acepta.
    const validated = validateStatementUpload(
      {
        originalname: stringArgument(request, 'fileName') ?? 'extracto.pdf',
        buffer: this.decodeDocument(request),
      },
      this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
    );

    try {
      const normalized = await this.withTimeout(
        this.statementEngineInstance(tenantId).normalize(validated.bytes, {
          fileName: validated.fileName,
        }),
        this.timeoutFor(request, this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000),
        request,
      );
      const warnings = [...normalized.quality.warnings];
      return {
        status: warnings.length ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        // Se entrega el contrato normalizado tal cual, que ya viene con la cuenta
        // enmascarada por el propio motor. La decisión solo verá los trozos que el nodo
        // proyecte, y cada uno pasa por la política de traza de su intermedia.
        result: normalized as unknown as Record<string, unknown>,
        warnings,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /** Clasifica un texto libre contra el catálogo semántico del tenant. */
  private async classifyText(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    request: WorkerServiceRequest,
    started: number,
  ): Promise<WorkerServiceOutcome> {
    this.assertAvailable(
      'semantic-analysis',
      (this.config.get<boolean>('SEMANTIC_ANALYSIS_WORKER_ENABLED') ?? false) &&
        (this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '') !== '',
      request.nodeKey,
    );

    const text = stringArgument(request, 'text');
    if (!text) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a semantic-analysis.classify sin el argumento text`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const maxLength = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH') ?? 8_000;
    if (text.length > maxLength) {
      throw new DomainException(
        'WORKER_ARGUMENT_TOO_LONG',
        `El texto que el nodo ${request.nodeKey} envía a clasificar supera los ${maxLength} caracteres`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // La clave de idempotencia se deriva del texto y del nodo, no de un aleatorio: dos
    // ejecuciones iguales del mismo algoritmo sobre el mismo texto deben poder reconocerse
    // como el mismo trabajo aguas abajo, que es justo lo que una clave sortea.
    const idempotencyKey = createHash('sha256')
      .update(`${tenantId.toString()}|${request.nodeKey}|${text}`)
      .digest('hex');

    try {
      const result = await this.withTimeout(
        this.semantic.analyze({
          requestId: randomUUID(),
          idempotencyKey,
          text,
          tenantId: tenantId.toString(),
          requestedBy: principal.id,
        }),
        this.timeoutFor(request, MAX_CALL_TIMEOUT_MS),
        request,
      );
      /*
       * El worker ya NO devuelve `UNKNOWN`: una glosa que el modelo no resolvió
       * sale con la categoría que sus reglas afirman —o con el cajón de su
       * sentido— y con `requiresReview` puesto. Enrutar por el estado, como se
       * hacía aquí, habría dejado de desviar el día que dejamos de abstenernos:
       * todo llegaría como `SUCCEEDED` y el algoritmo no podría distinguir lo
       * que el modelo entendió de lo que se dedujo de la palabra «TRASPASO».
       */
      const dudosa = result.requiresReview;
      return {
        status: dudosa ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        result: toClassificationResult(result),
        warnings: dudosa
          ? [`Categoría decidida por ${result.decidedBy} y marcada para revisión (${String(result.reviewReason)})`]
          : [],
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /**
   * Locuta una plantilla del catálogo del tenant.
   *
   * A diferencia de los otros dos servicios, esta llamada **normalmente no calcula nada**:
   * si la frase ya se dijo con esta misma voz, devuelve el audio que había. Por eso es
   * aceptable dentro de una decisión, donde los milisegundos cuentan; y por eso la
   * generación, cuando toca, se hace aquí mismo en vez de encolarse — una decisión necesita
   * la respuesta en el instante en que la pide.
   *
   * Lo que la decisión recibe es la IDENTIDAD del audio, no sus bytes: un algoritmo enruta
   * por «hay locución o no la hay», y meter un MP3 en una variable intermedia lo metería
   * también en la traza de la ejecución.
   */
  private async speak(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    request: WorkerServiceRequest,
    started: number,
  ): Promise<WorkerServiceOutcome> {
    this.assertAvailable(
      'audio-tts',
      (this.config.get<boolean>('AUDIO_TTS_WORKER_ENABLED') ?? false) &&
        (this.config.get<string>('AUDIO_TTS_PROVIDER') ?? 'disabled') !== 'disabled',
      request.nodeKey,
    );

    const templateCode = stringArgument(request, 'templateCode');
    if (!templateCode) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a audio-tts.speak sin el argumento templateCode`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const runtime = this.audio.forTenant(tenantId);
    try {
      const resolved = await this.withTimeout(
        runtime.resolver.resolve({
          templateCode,
          variables: variablesArgument(request),
          // El actor es quien pidió la decisión: el techo diario de generaciones se aplica
          // sobre él, igual que cuando locuta desde el portal. Un algoritmo no es una vía
          // para saltarse el presupuesto de nadie.
          actorId: principal.id,
          ...(stringArgument(request, 'language')
            ? { language: stringArgument(request, 'language') as string }
            : {}),
          correlationId: principal.requestId,
        }),
        this.timeoutFor(request, MAX_CALL_TIMEOUT_MS),
        request,
      );
      if (resolved.status === 'QUEUED') {
        await this.withTimeout(
          runtime.processor.process(resolved.assetId, principal.requestId),
          this.timeoutFor(request, MAX_CALL_TIMEOUT_MS),
          request,
        );
      }
      const outcome = await buildAudioOutcome(runtime, resolved);
      return {
        // Quedarse sin audio NO es un fallo —el contrato del worker es que la falta de
        // audio nunca rompe a quien lo pide—, pero tampoco es un éxito limpio: el
        // algoritmo tiene que poder distinguirlo y desviarse, y `call.status` es donde
        // lo ve. Lo mismo vale para el respaldo, que suena pero no dice lo que se pidió.
        status: outcome.warnings.length ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        result: outcome.result as unknown as Record<string, unknown>,
        warnings: outcome.warnings,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /**
   * Un servicio apagado en este despliegue no puede invocarse desde un nodo.
   *
   * Se comprueba con la MISMA bandera que publica el catálogo `/v1/workers`: si la interfaz
   * dice que la capacidad no está disponible, un algoritmo tampoco debe poder usarla por
   * detrás. La bandera gobierna la capacidad, no el proceso: una réplica de API con el
   * trabajo de fondo apagado (`WORKER_ROLE=api`) sigue pudiendo atender esta llamada.
   */
  private assertAvailable(service: string, available: boolean, nodeKey: string): void {
    if (available) return;
    throw new DomainException(
      'WORKER_SERVICE_UNAVAILABLE',
      `El nodo ${nodeKey} llama al servicio ${service}, que no está habilitado en este despliegue`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private decodeDocument(request: WorkerServiceRequest): Buffer {
    return this.decodeBase64(request, 'documentBase64', 'bank-statement.normalize');
  }

  /**
   * Un binario que viaja en base64 dentro de una variable de la decisión.
   *
   * Lo comparten los dos servicios que reciben archivos, y comparten también la
   * comprobación de ida y vuelta: `Buffer.from` con base64 ignora en silencio lo
   * que no reconoce, así que una cadena que no es base64 produciría un búfer
   * corto —y una imagen «válida» de trescientos bytes— en vez de un error.
   */
  private decodeBase64(
    request: WorkerServiceRequest,
    argumento: string,
    servicio: string,
  ): Buffer {
    const encoded = stringArgument(request, argumento);
    if (!encoded) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a ${servicio} sin el argumento ${argumento}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // `Buffer.from` con base64 ignora en silencio lo que no reconoce, así que una cadena
    // que no es base64 produciría un búfer corto en vez de un error. Se comprueba el
    // viaje de ida y vuelta, que es la única señal fiable sin traer un validador nuevo.
    const buffer = Buffer.from(encoded, 'base64');
    if (
      !buffer.byteLength ||
      buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')
    ) {
      throw new DomainException(
        'WORKER_ARGUMENT_INVALID',
        `El argumento ${argumento} que el nodo ${request.nodeKey} envía no es base64 válido`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return buffer;
  }


  /**
   * Verifica una identidad con el carnet y la selfie que trae la decisión.
   *
   * **Es el núcleo, no la cola.** Igual que los otros tres servicios: la
   * decisión necesita el veredicto en el instante en que lo pide, y encolar
   * serviría justo para lo contrario. La cola sigue siendo el camino de las
   * verificaciones que se piden por HTTP y que nadie está esperando en línea;
   * las dos comparten este pipeline, que no sabe de ninguna de las dos.
   *
   * Qué recibe la decisión: el VEREDICTO y su evidencia, nunca las imágenes.
   * Una intermedia con una cédula dentro acaba en la traza de la ejecución, y la
   * traza se conserva años.
   *
   * Qué NO hace: derivar a una persona. Un nodo de decisión no puede esperar a
   * que alguien mire una foto —la decisión se está tomando ahora, con alguien
   * delante— así que un caso dudoso vuelve como `SUCCEEDED_WITH_WARNINGS` con
   * `decision: REVIEW_REQUIRED`, y es el ALGORITMO quien decide qué hacer con
   * eso: pedir otro documento, aprobar con condiciones o abrir un caso. Es la
   * misma diferencia que el worker de extractos hace entre rechazar y preguntar,
   * llevada al sitio donde la política de negocio es visible y versionada.
   */
  private async verifyIdentity(
    request: WorkerServiceRequest,
    started: number,
  ): Promise<WorkerServiceOutcome> {
    this.assertAvailable(
      'identity-verification',
      this.config.get<boolean>('IDENTITY_VERIFICATION_WORKER_ENABLED') ?? false,
      request.nodeKey,
    );

    // La MISMA validación que aplica la subida por HTTP: tamaño, firma real del
    // contenido y formato. Que las imágenes entren por un nodo en vez de por un
    // formulario no puede relajar lo que se acepta.
    const validated = validateIdentityUpload(
      {
        document: {
          originalname: 'carnet.jpg',
          buffer: this.decodeBase64(request, 'documentBase64', 'identity-verification.verify'),
        },
        documentBack: stringArgument(request, 'documentBackBase64')
          ? {
              originalname: 'carnet-reverso.jpg',
              buffer: this.decodeBase64(
                request,
                'documentBackBase64',
                'identity-verification.verify',
              ),
            }
          : undefined,
        selfie: {
          originalname: 'selfie.jpg',
          buffer: this.decodeBase64(request, 'selfieBase64', 'identity-verification.verify'),
        },
      },
      this.config.get<number>('IDENTITY_MAX_UPLOAD_BYTES') ?? 10_485_760,
      undefined,
      'nodo',
    );

    try {
      const outcome = await this.withTimeout(
        this.identity.run({
          documentImage: validated.document.bytes,
          documentBackImage: validated.documentBack?.bytes ?? null,
          selfieImage: validated.selfie.bytes,
          documentCountry:
            stringArgument(request, 'documentCountry') ??
            this.config.get<string>('IDENTITY_DEFAULT_DOCUMENT_COUNTRY') ??
            'BO',
          correlationId: request.nodeKey,
        }),
        this.timeoutFor(request, this.config.get<number>('IDENTITY_TIMEOUT_MS') ?? 90_000),
        request,
      );

      const limpio = outcome.decision === 'VERIFIED';
      return {
        status: limpio ? 'SUCCEEDED' : 'SUCCEEDED_WITH_WARNINGS',
        result: toIdentityResult(outcome),
        warnings: limpio ? [] : [outcome.decision, ...outcome.reasonCodes],
        durationMs: Date.now() - started,
      };
    } catch (error) {
      throw toDomainException(error, request);
    }
  }

  /** El nodo puede pedir menos tiempo que el servicio, nunca más. */
  private timeoutFor(request: WorkerServiceRequest, serviceCeilingMs: number): number {
    const ceiling = Math.min(serviceCeilingMs, MAX_CALL_TIMEOUT_MS);
    if (!request.timeoutMs || request.timeoutMs <= 0) return ceiling;
    return Math.min(request.timeoutMs, ceiling);
  }

  /**
   * Acota la llamada.
   *
   * El motor de extractos tiene su propio presupuesto para la EXTRACCIÓN del PDF, pero no
   * para el análisis completo; sin esta cota, un documento patológico podría tener una
   * decisión —y su petición HTTP— esperando indefinidamente.
   */
  private async withTimeout<T>(
    work: Promise<T>,
    timeoutMs: number,
    request: WorkerServiceRequest,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new DomainException(
                  'WORKER_SERVICE_TIMEOUT',
                  `La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} superó ${timeoutMs} ms`,
                  HttpStatus.GATEWAY_TIMEOUT,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Un motor por tenant, por lo mismo que en el worker asíncrono: el padrón de
   * entidades es tenant-scoped, y uno compartido atribuiría los documentos de un
   * cliente contra las entidades que administró otro.
   */
  private statementEngineInstance(tenantId: bigint): StatementEngine {
    const key = tenantId.toString();
    let engine = this.statementEngines.get(key);
    if (engine) return engine;
    engine = createStatementEngine({
      limits: {
        maxFileSizeBytes: this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
        maxPageCount: 60,
        processingTimeoutMs: this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000,
      },
      triage: {
        accept: this.config.get<number>('BANK_STATEMENT_DOCUMENT_ACCEPT_CONFIDENCE'),
        review: this.config.get<number>('BANK_STATEMENT_DOCUMENT_REVIEW_CONFIDENCE'),
      },
      institutions: this.institutions.registryFor(tenantId),
      issuerGate: {
        requireLicensedIssuer:
          this.config.get<boolean>('BANK_STATEMENT_REQUIRE_LICENSED_ISSUER') ?? true,
      },
    });
    this.statementEngines.set(key, engine);
    return engine;
  }
}

/**
 * Las variables de la plantilla, saneadas a `Record<string, string>`.
 *
 * Un nodo puede proyectar aquí cualquier valor de la decisión —un número, una fecha—, así
 * que se convierten a texto en vez de rechazarlos: locutar «tu saldo es 1500» es un caso
 * legítimo. Lo que NO se convierte son objetos y arrays, que sólo pueden venir de un error
 * de cableado y acabarían diciendo «[object Object]» en voz alta.
 */
function variablesArgument(request: WorkerServiceRequest): Record<string, string> {
  const raw = request.arguments.variables;
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .map(([key, value]) => [key, String(value)] as const);
  return Object.fromEntries(entries);
}

function stringArgument(request: WorkerServiceRequest, name: string): string | undefined {
  const value = request.arguments[name];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

/**
 * Forma con la que la decisión ve una clasificación.
 *
 * No es el resultado crudo del worker: se aplanan los dos datos sobre los que un algoritmo
 * razona de verdad —qué categoría y con cuánta confianza— para que una condición no tenga
 * que indexar dentro de un array. El resto se conserva por si un nodo quiere la evidencia.
 */
function toClassificationResult(result: SemanticAnalysisResult): Record<string, unknown> {
  const best = [...result.matches]
    .filter((match) => match.supported && !match.contradicted)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return {
    status: result.status,
    categoryCode: best?.categoryCode ?? null,
    confidence: best?.confidence ?? 0,
    // Quién decidió y si hay que mirarlo. Es lo que un algoritmo necesita para
    // tratar distinto «el modelo lo entendió» y «lo dedujo una regla»: sin estos
    // dos campos las dos cosas llegan como una categoría con su confianza y son
    // indistinguibles justo donde más importa, que es al aprobar un crédito.
    decidedBy: result.decidedBy,
    requiresReview: result.requiresReview,
    reviewReason: result.reviewReason,
    tierUsed: result.tierUsed,
    model: result.model,
    modelVersion: result.modelVersion,
    entities: result.entities,
    matches: result.matches,
    evaluatedCategoryCodes: result.evaluatedCategoryCodes,
    // La rama, no sólo la hoja: un algoritmo que enruta gasto suele decidir por
    // «es vivienda», y sin la ruta tendría que reconstruir el árbol a mano.
    categoryPath: best === undefined ? [] : (result.categoryPaths[best.categoryCode] ?? []),
    categoryPaths: result.categoryPaths,
    processingTimeMs: result.processingTimeMs,
  };
}

/**
 * Lo que la decisión ve de una verificación de identidad.
 *
 * Se proyecta a mano y no se entrega el desenlace entero por una razón de
 * privacidad, no de tamaño: el resultado completo trae los campos leídos del
 * carnet —nombre, fecha de nacimiento, domicilio— y todo lo que un nodo publica
 * puede acabar en una variable intermedia y, desde ahí, en la traza de la
 * ejecución, que se conserva años. Un algoritmo de decisión necesita saber si la
 * persona es quien dice ser, no cómo se llama su madre.
 */
function toIdentityResult(outcome: IdentityVerificationOutcome): Record<string, unknown> {
  return {
    decision: outcome.decision,
    reasonCodes: outcome.reasonCodes,
    documentType: outcome.documentType,
    documentCountry: outcome.documentCountry,
    // Las dos confianzas, que responden a preguntas distintas: si es un
    // documento de identidad, y cuál.
    documentEvidence: outcome.documentEvidence.confidence,
    classificationConfidence: outcome.classification.confidence,
    faceSimilarity: outcome.faceMatch?.similarityScore ?? null,
    faceDecision: outcome.calibratedFaceDecision,
    liveness: outcome.liveness.outcome,
    thresholdProfileVersion: outcome.thresholdProfileVersion,
    documentExpiresAt: outcome.fields.expirationDate?.value ?? null,
    riskFlags: outcome.riskFlags,
  };
}

/**
 * Traduce el fallo del núcleo a una excepción de dominio conservando su código.
 *
 * El código importa: es lo que acaba en `call.errorCode` de la traza y lo que permite que
 * un algoritmo con `onError: CONTINUE` distinga «el PDF no era un extracto» de «el
 * servicio tardó demasiado».
 */
function toDomainException(error: unknown, request: WorkerServiceRequest): DomainException {
  if (error instanceof DomainException) return error;
  if (error instanceof StatementProcessingError) {
    return new DomainException(error.code, error.message, error.httpStatus, error.details);
  }
  // Una plantilla inexistente o una variable inválida son culpa de quien llama, no del
  // motor: viajan con su código y con 422, para que un `onError: CONTINUE` pueda
  // distinguirlas de que el proveedor de voz se cayera.
  if (error instanceof AudioDomainError) {
    return new DomainException(error.code, error.message, HttpStatus.UNPROCESSABLE_ENTITY);
  }
  return new DomainException(
    'WORKER_SERVICE_FAILED',
    `La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} falló: ` +
      (error instanceof Error ? error.message : String(error)),
    HttpStatus.BAD_GATEWAY,
  );
}

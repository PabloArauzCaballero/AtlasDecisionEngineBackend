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
import {
  createStatementEngine,
  type StatementEngine,
} from './bank-statement/core/statement-engine';
import { SemanticAnalysisPipeline } from './semantic-analysis/core/application/semantic-analysis.pipeline';
import type { SemanticAnalysisResult } from './semantic-analysis/core/domain/semantic-analysis.types';

/** Techo absoluto de una llamada desde un nodo, en milisegundos. */
const MAX_CALL_TIMEOUT_MS = 120_000;

@Injectable()
export class WorkerServiceInvokerService {
  /**
   * Perezoso y memorizado, igual que en el worker de fondo: construir el motor arrastra
   * `pdfjs-dist` y registra los siete analizadores, y eso no puede pagarse por decisión.
   */
  private statementEngine?: StatementEngine;

  constructor(
    private readonly config: ConfigService,
    private readonly semantic: SemanticAnalysisPipeline,
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
        return this.normalizeStatement(request, started);
      case 'semantic-analysis.classify':
        return this.classifyText(tenantId, principal, request, started);
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
        this.statementEngineInstance().normalize(validated.bytes, {
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
      return {
        // El worker degrada a `UNKNOWN` cuando agota el presupuesto del tenant en vez de
        // fallar. Para la decisión eso NO es un éxito limpio: el algoritmo tiene que poder
        // distinguirlo y desviarse, y `call.status` es donde lo ve.
        status: result.status === 'UNKNOWN' ? 'SUCCEEDED_WITH_WARNINGS' : 'SUCCEEDED',
        result: toClassificationResult(result),
        warnings: result.status === 'UNKNOWN' ? ['No se resolvió ninguna categoría'] : [],
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
    const encoded = stringArgument(request, 'documentBase64');
    if (!encoded) {
      throw new DomainException(
        'WORKER_ARGUMENT_MISSING',
        `El nodo ${request.nodeKey} llama a bank-statement.normalize sin el argumento documentBase64`,
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
        `El documento que el nodo ${request.nodeKey} envía no es base64 válido`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return buffer;
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

  private statementEngineInstance(): StatementEngine {
    this.statementEngine ??= createStatementEngine({
      limits: {
        maxFileSizeBytes: this.config.get<number>('BANK_STATEMENT_MAX_UPLOAD_BYTES') ?? 10_485_760,
        maxPageCount: 60,
        processingTimeoutMs: this.config.get<number>('BANK_STATEMENT_TIMEOUT_MS') ?? 60_000,
      },
    });
    return this.statementEngine;
  }
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
  return new DomainException(
    'WORKER_SERVICE_FAILED',
    `La llamada del nodo ${request.nodeKey} a ${request.service}.${request.operation} falló: ` +
      (error instanceof Error ? error.message : String(error)),
    HttpStatus.BAD_GATEWAY,
  );
}

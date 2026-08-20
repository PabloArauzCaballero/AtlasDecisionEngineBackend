import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  SEMANTIC_AUDIT_REPOSITORY,
  SEMANTIC_METRICS_RECORDER,
  SemanticAuditRepository,
  SemanticMetricsRecorder,
} from './ports';
import { SemanticAnalysisPipeline } from './semantic-analysis.pipeline';
import { UNRESOLVED_SINK, type UnresolvedSink } from './ports';
import {
  SemanticAnalysisRequest,
  type CategoryAssessment,
  type SemanticAnalysisResult,
} from '../domain/semantic-analysis.types';
import {
  SemanticExhaustedError,
  isRetryable,
  toStableErrorCode,
} from '../domain/semantic-analysis.errors';
import {
  MOTIVOS_DE_REVISION,
  motivoDeRevisionPara,
  type MotivoDeRevision,
} from '../domain/review-reason';
import { TracingService } from '../../../../../common/observability/tracing.service';
import {
  APP_ATTRIBUTES,
  SEMANTIC_ATTRIBUTES,
  SPAN_NAMES,
} from '../observability/telemetry.constants';

@Injectable()
export class SemanticAnalysisProcessor {
  private readonly logger = new Logger(SemanticAnalysisProcessor.name);

  public constructor(
    @Inject(SEMANTIC_AUDIT_REPOSITORY)
    private readonly auditRepository: SemanticAuditRepository,
    @Inject(SEMANTIC_METRICS_RECORDER)
    private readonly metrics: SemanticMetricsRecorder,
    private readonly pipeline: SemanticAnalysisPipeline,
    private readonly tracing: TracingService,
    @Optional()
    @Inject(UNRESOLVED_SINK)
    private readonly unresolved: UnresolvedSink | null = null,
  ) {}

  /**
   * Protege el pipeline contra entregas repetidas y persiste el resultado auditable.
   *
   * El span cuelga del consumidor de la cola, que a su vez continúa la traza del productor: una
   * sola traza cubre desde que la API encoló la solicitud hasta que el worker escribió la auditoría.
   */
  public async execute(request: SemanticAnalysisRequest): Promise<void> {
    await this.tracing.runInSpan(
      SPAN_NAMES.process,
      {
        [APP_ATTRIBUTES.module]: 'semantic',
        [APP_ATTRIBUTES.operation]: 'process',
        [APP_ATTRIBUTES.entityType]: 'semantic-request',
        [APP_ATTRIBUTES.entityId]: request.requestId,
        ...(request.tenantId === undefined ? {} : { [APP_ATTRIBUTES.tenantId]: request.tenantId }),
      },
      (span) =>
        this.executeClaimed(request, (claimState) => {
          span.setAttribute(SEMANTIC_ATTRIBUTES.claimState, claimState);
        }),
    );
  }

  /**
   * Reclama la solicitud y, si es suya, la analiza.
   *
   * La excepción no se registra aquí: `runInSpan` ya la marca en el span y la relanza. Repetirlo
   * produciría la misma excepción cinco veces en la misma traza, que es exactamente lo que hace
   * ilegible un error en Jaeger.
   */
  private async executeClaimed(
    request: SemanticAnalysisRequest,
    onClaim: (state: string) => void,
  ): Promise<void> {
    const claim = await this.auditRepository.claim(request);
    onClaim(claim.state);
    if (claim.state !== 'ACQUIRED') {
      this.logger.log(`Solicitud ${request.requestId} omitida por idempotencia: ${claim.state}.`);
      return;
    }

    try {
      const result = await this.pipeline.analyze(request);
      await this.auditRepository.complete(request, result);
      await this.escalarSiNoSeResolvio(request, result);
      this.tracing.setAttributes({
        [SEMANTIC_ATTRIBUTES.status]: result.status,
        [SEMANTIC_ATTRIBUTES.tier]: result.tierUsed,
      });
      this.logger.log(
        `Solicitud ${request.requestId} completada con resultado ${result.status} en ${result.processingTimeMs} ms.`,
      );
    } catch (error: unknown) {
      const errorCode = toStableErrorCode(error);
      const retryable = isRetryable(error);
      await this.auditRepository.fail(request, errorCode);
      this.metrics.recordFailure({ errorCode, retryable, tenantId: request.tenantId });
      // Antes de relanzar: una glosa que tardó demasiado NO puede desaparecer.
      await this.escalarPorFallo(request, errorCode, retryable);
      this.logger.error(
        `Falló la solicitud ${request.requestId} con código ${errorCode} (reintentable: ${String(retryable)}).`,
      );
      // Se relanza siempre: la cola decide el reintento según su propio límite y, agotado éste,
      // la solicitud llega a la cola dead-letter donde queda marcada como agotada.
      throw error;
    }
  }

  /**
   * Un análisis que no resolvió no termina en silencio: se escala.
   *
   * Abstenerse es correcto —vale más un hueco que una categoría inventada— pero
   * dejarlo ahí convierte cada abstención en información perdida. Aquí el valor
   * se guarda tal como llegó, con la mejor candidata que el motor llegó a ver y
   * su confianza, para que alguien pueda decidir y para que el catálogo aprenda.
   *
   * **No interrumpe el análisis.** Si el escalado falla, el resultado ya está
   * auditado y devuelto: convertir un fallo de la bandeja en un fallo de la
   * clasificación haría que la cola reintentara un trabajo que salió bien.
   */
  private async escalarSiNoSeResolvio(
    request: SemanticAnalysisRequest,
    result: SemanticAnalysisResult,
  ): Promise<void> {
    if (result.status !== 'UNKNOWN' && result.status !== 'AMBIGUOUS') return;

    await this.escalar(request, MOTIVOS_DE_REVISION.LOW_CONFIDENCE, {
      context: {
        status: result.status,
        tierUsed: result.tierUsed,
        normalizedText: result.normalizedText,
        evaluatedCategoryCodes: result.evaluatedCategoryCodes,
        processingTimeMs: result.processingTimeMs,
      },
      // Las candidatas que el motor evaluó, aunque ninguna alcanzara su
      // umbral: son exactamente la recomendación que el administrador
      // necesita para decidir en un vistazo.
      candidates: (result.matches ?? []).map((match: CategoryAssessment) => ({
        categoryCode: match.categoryCode,
        confidence: match.confidence,
      })),
    });
  }

  /**
   * Un análisis que TARDÓ demasiado tampoco termina en silencio.
   *
   * Éste es el defecto que arregla el método: hasta ahora un `SEMANTIC_TIMEOUT`
   * marcaba la ejecución como fallida y ahí acababa todo. Y «fallido» y «lento»
   * no son lo mismo ni de lejos: lo fallido se reintenta y se olvida, mientras
   * que una glosa que agota el reloj suele ser justo la que MÁS necesita que la
   * mire una persona —un caso ambiguo, una redacción que el modelo no había
   * visto, un proveedor externo que se atascó—. Marcarla como fallida la sacaba
   * del circuito de revisión sin que nadie lo decidiera: no aparecía en la
   * bandeja, no se podía asignar categoría y no dejaba rastro de por qué.
   *
   * **Escala en cada intento, y eso no duplica nada.** La bandeja deduplica por
   * `(tenant, source, valor normalizado)` en la propia base, así que un reintento
   * que vuelva a agotar el reloj suma una aparición al mismo pendiente en vez de
   * abrir otro. Y si el reintento acaba saliendo bien, el término ya escalado se
   * cierra solo en la siguiente reevaluación del catálogo o al aprenderse su
   * alias — que es exactamente lo que ese barrido existe para hacer.
   *
   * **No todo fallo se escala**: `motivoDeRevisionPara` deja fuera lo que ninguna
   * persona puede resolver mirando una glosa (véase su cabecera).
   */
  private async escalarPorFallo(
    request: SemanticAnalysisRequest,
    errorCode: string,
    retryable: boolean,
  ): Promise<void> {
    const motivo = motivoDeRevisionPara(errorCode, retryable);
    if (motivo === null) return;

    await this.escalar(request, motivo, { context: { errorCode, retryable } });
  }

  /**
   * El ÚNICO punto que escribe en la bandeja, con su motivo siempre puesto.
   *
   * Uno solo y no dos por lo de siempre: dos escrituras acaban divergiendo en
   * qué contexto guardan, y la mitad de los pendientes queda sin el campo por el
   * que alguien filtra.
   *
   * **No interrumpe nada.** Si el escalado falla, el desenlace del análisis ya
   * está auditado: convertir un fallo de la bandeja en un fallo de la
   * clasificación haría que la cola reintentara un trabajo que salió bien, y en
   * el camino del error taparía el error de verdad con otro distinto.
   */
  private async escalar(
    request: SemanticAnalysisRequest,
    reason: MotivoDeRevision,
    extra: {
      context: Record<string, unknown>;
      candidates?: readonly { categoryCode: string; confidence: number }[];
    },
  ): Promise<void> {
    if (this.unresolved === null) return;
    if (request.tenantId === undefined) return;

    try {
      await this.unresolved.record({
        tenantId: BigInt(request.tenantId),
        rawValue: request.text,
        source: 'semantic-analysis',
        context: { requestId: request.requestId, reason, ...extra.context },
        ...(extra.candidates === undefined ? {} : { candidates: extra.candidates }),
        correlationId: request.requestId,
      });
      this.metrics.recordReviewEscalation?.({ reason, tenantId: request.tenantId });
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo registrar el pendiente de ${request.requestId}: ` +
          (error instanceof Error ? error.message : 'error desconocido'),
      );
    }
  }

  /**
   * Cierra el ciclo de vida de una solicitud que agotó los reintentos de la cola.
   */
  public async handleExhausted(request: SemanticAnalysisRequest): Promise<void> {
    await this.auditRepository.exhaust(request, 'SEMANTIC_RETRIES_EXHAUSTED');
    this.metrics.recordFailure({
      errorCode: 'SEMANTIC_RETRIES_EXHAUSTED',
      retryable: false,
      tenantId: request.tenantId,
    });
    // Marca el span consumidor de la cola dead-letter: sin esto, la traza de una solicitud agotada
    // terminaría en verde pese a que el trabajo nunca llegó a completarse.
    this.tracing.recordException(new SemanticExhaustedError('Reintentos agotados.'));
    this.logger.error(
      `Solicitud ${request.requestId} agotó los reintentos y quedó registrada como EXHAUSTED.`,
    );
  }
}

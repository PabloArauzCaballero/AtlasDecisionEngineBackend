import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SEMANTIC_AUDIT_REPOSITORY,
  SEMANTIC_METRICS_RECORDER,
  SemanticAuditRepository,
  SemanticMetricsRecorder,
} from './ports';
import { SemanticAnalysisPipeline } from './semantic-analysis.pipeline';
import { SemanticAnalysisRequest } from '../domain/semantic-analysis.types';
import {
  SemanticExhaustedError,
  isRetryable,
  toStableErrorCode,
} from '../domain/semantic-analysis.errors';
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
      this.logger.error(
        `Falló la solicitud ${request.requestId} con código ${errorCode} (reintentable: ${String(retryable)}).`,
      );
      // Se relanza siempre: la cola decide el reintento según su propio límite y, agotado éste,
      // la solicitud llega a la cola dead-letter donde queda marcada como agotada.
      throw error;
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

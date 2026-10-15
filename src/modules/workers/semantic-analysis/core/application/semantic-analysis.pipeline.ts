import { Inject, Injectable, Logger } from '@nestjs/common';
import { SEMANTIC_WORKER_CONFIG } from './ports';
import { CandidateRetrievalStage } from './candidate-retrieval.stage';
import { GlosaPreparationStage } from './glosa-preparation.stage';
import { CachedClassification, ClassificationCache } from './classification-cache';
import { RuleSafetyNet, UNRESOLVED_DECISION } from './rule-safety-net';
import { TenantBudgetGuard } from './tenant-budget.guard';
import { TieredModelClassifier } from './tiered-model-classifier';
import {
  ModelClassificationInput,
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
} from '../domain/semantic-analysis.types';
import { semanticAnalysisRequestSchema } from '../domain/semantic-analysis.schemas';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { SemanticTimeoutError } from '../domain/semantic-analysis.errors';
import { MOTIVOS_DE_REVISION } from '../domain/review-reason';
import { TracingService } from '../../../../../common/observability/tracing.service';
import { SPAN_NAMES } from '../observability/telemetry.constants';
import { analyzeAttributes } from './semantic-analysis.attributes';
import { SemanticAnalysisResultBuilder } from './semantic-analysis.result-builder';

const NO_CATEGORIES_MODEL = 'none';
const BUDGET_EXHAUSTED_MODEL = 'budget-exhausted';
/**
 * Se publica como «modelo» cuando decidió una regla y no hubo llamada.
 *
 * No es un adorno: los tableros agrupan por `model`, y dejar ahí el nombre del
 * proveedor haría que un atajo que nunca lo invocó contara como una llamada suya
 * —inflando su volumen y falseando su latencia media hacia abajo—.
 */
const RULE_MODEL = 'rule-fast-path';
/** Se publica como «modelo» cuando el reloj se agotó y decidieron las reglas. */
const TIMEOUT_MODEL = 'timeout-rescue';

/**
 * Orquesta el análisis semántico completo: catálogo, normalización, entidades, presupuesto,
 * recuperación, clasificación por tiers y decisión.
 *
 * Sólo coordina. Lo que es separable vive fuera: la decisión en `DecisionEngine`, las dos pasadas
 * del modelo en `TieredModelClassifier`, las reglas de respaldo en `RuleSafetyNet`, la preparación de la glosa en `GlosaPreparationStage`, la recuperación en `CandidateRetrievalStage`, el ensamblado del resultado y su telemetría en
 * `SemanticAnalysisResultBuilder` y los atributos de span en `semantic-analysis.attributes.ts`.
 */
@Injectable()
export class SemanticAnalysisPipeline {
  private readonly logger = new Logger(SemanticAnalysisPipeline.name);

  public constructor(
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    private readonly preparation: GlosaPreparationStage,
    private readonly retrieval: CandidateRetrievalStage,
    private readonly clasificaciones: ClassificationCache,
    private readonly budget: TenantBudgetGuard,
    private readonly tracing: TracingService,
    private readonly resultBuilder: SemanticAnalysisResultBuilder,
    private readonly safetyNet: RuleSafetyNet,
    private readonly modelTiers: TieredModelClassifier,
  ) {}

  /**
   * Envuelve el análisis en su span de negocio: la ruta crítica del sistema. Bajo él cuelgan el
   * catálogo, el presupuesto, la recuperación, el proveedor y todo el SQL que disparen.
   */
  public analyze(request: SemanticAnalysisRequest): Promise<SemanticAnalysisResult> {
    return this.tracing.runInSpan(
      SPAN_NAMES.analyze,
      analyzeAttributes(request, this.config.retrievalMode),
      () => this.runAnalysis(request),
    );
  }

  /**
   * Ejecuta recuperación, clasificación rápida, escalamiento selectivo y decisión final.
   *
   * El análisis completo está acotado por `analysisTimeoutSeconds`: agotarlo aborta la llamada al
   * proveedor en curso y produce un error reintentable antes de que la cola expire el job, de modo
   * que un intento colgado nunca coexiste con su propio reintento.
   */
  private async runAnalysis(
    untrustedRequest: SemanticAnalysisRequest,
  ): Promise<SemanticAnalysisResult> {
    const startedAt = performance.now();
    const request = semanticAnalysisRequestSchema.parse(untrustedRequest);
    const budget = AbortSignal.timeout(this.config.analysisTimeoutSeconds * 1_000);

    const { categories, signature, normalizedText, entities } =
      await this.preparation.prepare(request);

    /*
     * Antes del presupuesto, y no después: un acierto de caché no llama al
     * proveedor, así que reservar cuota por él cobraría un gasto que no se ha
     * producido. Con un extracto lleno de glosas repetidas eso agotaba el
     * presupuesto del tenant clasificando veinte conceptos distintos.
     */
    const recordada = this.clasificaciones.read(request.tenantId, signature, normalizedText);
    if (recordada !== undefined) {
      this.logger.debug(`Glosa de ${request.requestId} resuelta desde la caché de clasificación.`);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        candidates: recordada.candidates,
        categories,
        decision: recordada.decision,
        tier: recordada.tier,
        model: recordada.model,
        modelVersion: recordada.modelVersion,
        startedAt,
        escalated: recordada.escalated,
      });
    }

    /*
     * El atajo va DESPUÉS de la caché y ANTES del presupuesto, por el mismo
     * motivo que la caché: no llama al proveedor, así que reservar cuota por él
     * cobraría un gasto que no se produce. Y va antes de recuperar candidatas
     * porque también se ahorra esa consulta.
     */
    const atajo = this.safetyNet.atajoPorRubro(normalizedText, categories);
    if (atajo !== null) {
      this.logger.debug(
        `Glosa de ${request.requestId} resuelta por rubro literal sin invocar al modelo.`,
      );
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates: [],
          decision: atajo,
          tier: 'FAST',
          model: RULE_MODEL,
          modelVersion: RULE_MODEL,
          escalated: false,
        }),
      });
    }

    const allowance = await this.budget.reserve(request.tenantId);
    if (!allowance.allowed) {
      // Degradar en lugar de fallar: un error haría que la cola reintentara y gastara justo la
      // cuota que el presupuesto pretende proteger.
      //
      // Degradar YA NO ES quedarse sin categoría. Las reglas no consultan al
      // proveedor, así que aplicarlas aquí no gasta la cuota que el presupuesto
      // protege: el movimiento sale clasificado por lo que la glosa afirma y
      // marcado para revisión, en vez de salir vacío por una razón que no tiene
      // nada que ver con su texto.
      this.logger.warn(`Solicitud ${request.requestId} degradada por cuota: ${allowance.reason}.`);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        candidates: [],
        categories,
        decision: this.safetyNet.garantizarCategoria(
          UNRESOLVED_DECISION,
          normalizedText,
          categories,
          MOTIVOS_DE_REVISION.PROCESSING_ERROR,
        ),
        tier: 'FAST',
        model: BUDGET_EXHAUSTED_MODEL,
        modelVersion: BUDGET_EXHAUSTED_MODEL,
        startedAt,
        escalated: false,
      });
    }

    const candidates = await this.retrieval.retrieve(normalizedText, categories, budget);

    if (candidates.length === 0) {
      this.logger.warn(
        `Sin categorías activas aplicables para la solicitud ${request.requestId}; no se invoca al modelo.`,
      );
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates,
          decision: this.safetyNet.garantizarCategoria(
            UNRESOLVED_DECISION,
            normalizedText,
            categories,
          ),
          tier: 'FAST',
          model: NO_CATEGORIES_MODEL,
          modelVersion: NO_CATEGORIES_MODEL,
          escalated: false,
        }),
      });
    }

    const modelInput: ModelClassificationInput = {
      originalText: request.text,
      normalizedText,
      entities,
      candidates,
    };

    /*
     * El rescate por lentitud envuelve SÓLO la parte que habla con el proveedor.
     *
     * Agotar el reloj deja de ser un fallo terminal: la glosa se lee por reglas
     * —que responden en microsegundos y sin salir del proceso— y se publica con
     * el motivo `TIMEOUT` puesto, que es exactamente lo que pasó. Antes moría la
     * ejecución, la cola reintentaba y el mismo texto volvía a tardar lo mismo;
     * el movimiento no llegaba nunca al informe.
     *
     * Lo que NO se rescata es un error del proveedor: ahí no se sabe si el
     * modelo habría dicho otra cosa, así que sigue fallando y reintentándose. Un
     * corte del proveedor escondido detrás de miles de «otros gastos» es peor
     * que un corte visible.
     */
    try {
      const outcome = await this.modelTiers.classify(
        request.tenantId,
        modelInput,
        candidates,
        budget,
      );
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates,
          ...outcome,
          decision: this.safetyNet.garantizarCategoria(
            outcome.decision,
            normalizedText,
            categories,
          ),
        }),
      });
    } catch (error: unknown) {
      if (!this.config.timeoutRescueEnabled || !(error instanceof SemanticTimeoutError))
        throw error;
      this.logger.warn(
        `Solicitud ${request.requestId} agotó el reloj; se resuelve por reglas y se marca para revisión.`,
      );
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        candidates,
        categories,
        decision: this.safetyNet.garantizarCategoria(
          UNRESOLVED_DECISION,
          normalizedText,
          categories,
          MOTIVOS_DE_REVISION.TIMEOUT,
        ),
        tier: 'FAST',
        model: TIMEOUT_MODEL,
        modelVersion: TIMEOUT_MODEL,
        startedAt,
        escalated: false,
      });
    }
  }

  /**
   * Graba el veredicto y lo devuelve para armar el resultado de esta solicitud.
   *
   * Se graba la decisión YA pasada por la red de seguridad: es la que el motor
   * publica, y guardar la anterior obligaría a volver a aplicar las reglas en
   * cada acierto para llegar al mismo sitio.
   *
   * Sólo pasa por aquí lo que se calculó de verdad. La degradación por
   * presupuesto agotado retorna antes y no toca esta función: ese `UNKNOWN`
   * describe la cuota, no el texto.
   */
  private recuerda(
    tenantId: string | undefined,
    signature: string,
    normalizedText: string,
    clasificacion: CachedClassification,
  ): CachedClassification {
    this.clasificaciones.write(tenantId, signature, normalizedText, clasificacion);
    return clasificacion;
  }
}

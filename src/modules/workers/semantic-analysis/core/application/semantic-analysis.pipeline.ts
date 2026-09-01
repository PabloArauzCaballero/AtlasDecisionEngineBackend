import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CANDIDATE_RETRIEVER,
  CandidateRetriever,
  SEMANTIC_METRICS_RECORDER,
  SEMANTIC_MODEL_PROVIDER,
  SEMANTIC_WORKER_CONFIG,
  SemanticMetricsRecorder,
  SemanticModelProvider,
} from './ports';
import { CatalogCache } from './catalog-cache';
import { CachedClassification, ClassificationCache } from './classification-cache';
import { EntityResolver } from './entity-resolver';
import { Decision, DecisionEngine } from './decision-engine';
import {
  GlosaFallbackClassifier,
  ladoDelCodigo,
  sentidoDeclarado,
  type DecisionPorRegla,
} from './glosa-fallback';
import { TenantBudgetGuard } from './tenant-budget.guard';
import { TextNormalizer } from './text-normalizer';
import {
  AnalysisTier,
  CategoryCandidate,
  ModelClassification,
  ModelClassificationInput,
  ProviderUsage,
  ResolvedEntity,
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
  SemanticCategory,
} from '../domain/semantic-analysis.types';
import { semanticAnalysisRequestSchema } from '../domain/semantic-analysis.schemas';
import { leavesOf } from '../domain/category-tree';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { SemanticTimeoutError } from '../domain/semantic-analysis.errors';
import { MOTIVOS_DE_REVISION } from '../domain/review-reason';
import { TracingService } from '../../../../../common/observability/tracing.service';
import { SEMANTIC_ATTRIBUTES, SPAN_NAMES } from '../observability/telemetry.constants';
import {
  analyzeAttributes,
  classifyAttributes,
  retrieveAttributes,
} from './semantic-analysis.attributes';
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

const UNRESOLVED: Decision = {
  status: 'UNKNOWN',
  matches: [],
  requiresDeepAnalysis: false,
  decidedBy: 'MODEL',
  requiresReview: true,
  reviewReason: MOTIVOS_DE_REVISION.LOW_CONFIDENCE,
};

/**
 * Orquesta el análisis semántico completo: catálogo, normalización, entidades, presupuesto,
 * recuperación, clasificación por tiers y decisión.
 *
 * Sólo coordina. Lo que es separable vive fuera: la decisión en `DecisionEngine`, la recuperación
 * tras el puerto `CandidateRetriever`, el ensamblado del resultado y su telemetría en
 * `SemanticAnalysisResultBuilder` y los atributos de span en `semantic-analysis.attributes.ts`.
 */
@Injectable()
export class SemanticAnalysisPipeline {
  private readonly logger = new Logger(SemanticAnalysisPipeline.name);

  public constructor(
    @Inject(SEMANTIC_MODEL_PROVIDER)
    private readonly modelProvider: SemanticModelProvider,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    @Inject(SEMANTIC_METRICS_RECORDER)
    private readonly metrics: SemanticMetricsRecorder,
    @Inject(CANDIDATE_RETRIEVER)
    private readonly candidateRetriever: CandidateRetriever,
    private readonly catalog: CatalogCache,
    private readonly clasificaciones: ClassificationCache,
    private readonly budget: TenantBudgetGuard,
    private readonly normalizer: TextNormalizer,
    private readonly entityResolver: EntityResolver,
    private readonly decisionEngine: DecisionEngine,
    private readonly tracing: TracingService,
    private readonly resultBuilder: SemanticAnalysisResultBuilder,
    private readonly fallback: GlosaFallbackClassifier,
  ) {}

  /**
   * La decisión final, con la red de seguridad puesta.
   *
   * Si el modelo resolvió, manda el modelo y aquí no pasa nada. Si no —umbral no
   * alcanzado, empate, contradicción, o ni siquiera hubo candidatas—, la glosa
   * se lee por REGLAS: el rubro (`ELFEC`, `YPFB`, `ALQUILER`) primero y el
   * instrumento (`TRASPASO`, `QR`, `RETIRO DE EFECTIVO`) después. Los dos son
   * literales, están en todos los extractos bolivianos y no necesitan modelo.
   *
   * Lo que se gana no es precisión, es COBERTURA honesta: «salió dinero por
   * transferencia» consta en la glosa; «sin determinar» no dice nada y obliga a
   * quien recibe el informe a resolverlo por su cuenta, fila por fila.
   *
   * **Y lo que se publica lleva su procedencia.** Una decisión rescatada por
   * regla no se disfraza de acierto del modelo: `decidedBy` lo dice y, salvo que
   * el rubro fuera literal e inequívoco, `requiresReview` manda el caso a la
   * bandeja igualmente. No abstenerse nunca sólo es defendible si se distingue
   * lo que se supo de lo que se dedujo.
   */
  private garantizarCategoria(
    decision: Decision,
    normalizedText: string,
    categories: readonly SemanticCategory[],
    motivo: string | null = null,
  ): Decision {
    if (
      this.yaResolvio(decision) &&
      motivo === null &&
      !this.contradiceElLado(decision, normalizedText)
    )
      return decision;
    const disponibles = new Set(leavesOf(categories).map((categoria) => categoria.code));
    const regla = this.fallback.clasificar(normalizedText, disponibles);
    if (regla === null) return decision;

    this.logger.debug(`Glosa resuelta por ${regla.origen} como ${regla.categoryCode}.`);
    return this.desdeRegla(regla, motivo ?? MOTIVOS_DE_REVISION.LOW_CONFIDENCE);
  }

  /**
   * Si el modelo puso el movimiento en el lado del libro que el banco NO dijo.
   *
   * Es la única circunstancia en la que una decisión ya resuelta se descarta, y
   * la razón es que aquí no compiten dos opiniones: compiten una opinión y un
   * dato. Cuando la glosa empieza por `DEBITO`, el banco no está sugiriendo que
   * el dinero salió, lo está afirmando; una similitud coseno de 0,73 no es
   * evidencia contraria de nada.
   *
   * Medido sobre los 473 movimientos de siete extractos reales, esto ocurría en
   * diez: `DEBITO TRANSFERENCIA ACH … CESPEDES VILLARROEL ROMY CECILIA …`
   * —una transferencia SALIENTE— se publicaba como `INGRESOS.TRANSFERENCIA`. En
   * un informe de capacidad de pago ese error cuenta doble: infla el ingreso y
   * descuenta el gasto con el mismo apunte.
   *
   * Sólo vetan las marcas CONTABLES (`sentidoDeclarado`), nunca los verbos de
   * concepto. La diferencia está medida y tiene un caso que la sostiene: «PAGO
   * DE INTERES» es el banco pagando al cliente, y leer ese `PAGO` como salida
   * habría estropeado el único movimiento que ya estaba bien clasificado.
   *
   * Lo que sigue después no es una categoría inventada: se cae a las reglas, que
   * leen el sentido del mismo sitio del que salió el veto, y el resultado va a
   * la bandeja de revisión. El desacuerdo entre el banco y el modelo es
   * exactamente lo que una persona tiene que mirar.
   */
  private contradiceElLado(decision: Decision, normalizedText: string): boolean {
    const declarado = sentidoDeclarado(normalizedText);
    if (declarado === null) return false;
    const elegido = decision.matches[0]?.categoryCode;
    if (elegido === undefined) return false;
    const lado = ladoDelCodigo(elegido);
    if (lado === null || lado === declarado) return false;
    this.logger.warn(
      `El modelo situó «${normalizedText.slice(0, 60)}» en ${elegido}, pero el banco la rotuló como ${declarado}: se resuelve por reglas y se manda a revisión.`,
    );
    return true;
  }

  /** Una decisión ya publicable: el modelo eligió algo y lo sostiene. */
  private yaResolvio(decision: Decision): boolean {
    return decision.status === 'MATCH' || decision.status === 'MULTI_MATCH';
  }

  /**
   * Traduce una regla a la decisión que se publica.
   *
   * El único caso que NO va a la bandeja es el rubro literal e inequívoco: ahí
   * la regla no está supliendo al modelo, está leyendo un nombre propio que el
   * modelo no habría leído mejor. Todo lo demás —instrumento, cajón, rubro
   * degradado por catálogo— se publica Y se revisa.
   */
  private desdeRegla(regla: DecisionPorRegla, motivo: string | null): Decision {
    const inequivoca = regla.origen === 'RUBRO' && regla.certeza === 'ALTA' && !regla.degradado;
    const razon = motivo ?? (inequivoca ? null : MOTIVOS_DE_REVISION.LOW_CONFIDENCE);
    return {
      status: 'MATCH',
      requiresDeepAnalysis: false,
      decidedBy: regla.origen === 'CAJON' ? 'BIN' : 'RULE',
      requiresReview: razon !== null,
      reviewReason: razon as Decision['reviewReason'],
      matches: [
        {
          categoryCode: regla.categoryCode,
          confidence: regla.confidence,
          supported: true,
          contradicted: false,
          evidence: [regla.evidence],
          rationale: regla.rationale,
        },
      ],
    };
  }

  /**
   * El atajo: resolver sin preguntarle a nadie cuando la glosa se explica sola.
   *
   * Sólo lo activan los rubros de certeza ALTA —nombres propios de empresas y
   * trámites bolivianos— y sólo si la hoja existe tal cual en el catálogo del
   * tenant. Ahí el modelo no puede aportar nada: `SAGUAPAC` es agua, y una
   * similitud coseno sobre esa palabra es un rodeo caro para llegar al mismo
   * sitio.
   *
   * El ahorro no es teórico. Un extracto de trescientos movimientos trae más de
   * la mitad de sus filas con el rubro rotulado; sin atajo son trescientas
   * llamadas al proveedor compitiendo por el mismo reloj, y las últimas son las
   * que agotan el presupuesto y acaban en la bandeja por lentitud.
   */
  private atajoPorRubro(
    normalizedText: string,
    categories: readonly SemanticCategory[],
  ): Decision | null {
    if (!this.config.ruleFastPathEnabled) return null;
    const disponibles = new Set(leavesOf(categories).map((categoria) => categoria.code));
    const regla = this.fallback.clasificar(normalizedText, disponibles);
    if (regla === null) return null;
    if (regla.origen !== 'RUBRO' || regla.certeza !== 'ALTA' || regla.degradado) return null;
    return this.desdeRegla(regla, null);
  }

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

    const { categories, aliases, signature } = await this.catalog.load(request.tenantId);
    /*
     * Dos textos, y no por comodidad: el resolutor de entidades busca los
     * nombres canónicos, así que necesita los alias YA desplegados; el
     * clasificador necesita lo contrario —la glosa como el banco la escribió y
     * sin los identificadores que la ahogan—. Compartir un solo texto obligaba a
     * elegir cuál de los dos trabajaba mal, y el que trabajaba mal era el que
     * decide la categoría.
     *
     * `normalizedText` es el que se guarda y se enseña porque es el que se
     * clasificó: una traza que mostrara otro texto no explicaría el veredicto.
     */
    const textoConAlias = this.normalizer.normalize(request.text, aliases);
    const normalizedText = this.normalizer.forClassification(request.text, aliases);
    const entities = this.entityResolver.resolve(textoConAlias, aliases);

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
    const atajo = this.atajoPorRubro(normalizedText, categories);
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
        decision: this.garantizarCategoria(
          UNRESOLVED,
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

    const candidates = await this.retrieveCandidates(normalizedText, categories, budget);

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
          decision: this.garantizarCategoria(UNRESOLVED, normalizedText, categories),
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
      return await this.clasificarConModelo({
        request,
        normalizedText,
        entities,
        categories,
        candidates,
        modelInput,
        signature,
        startedAt,
        budget,
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
        decision: this.garantizarCategoria(
          UNRESOLVED,
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
   * Las dos pasadas del modelo y su decisión, aparte para poder envolverlas.
   *
   * Vive fuera de `runAnalysis` únicamente porque el rescate por lentitud
   * necesita un `try` que abarque las llamadas al proveedor y nada más: dentro
   * de `runAnalysis` ese `try` habría cubierto también el catálogo, la caché y
   * el presupuesto, y un fallo de la base se habría publicado como si el modelo
   * hubiera tardado.
   */
  private async clasificarConModelo(input: {
    request: SemanticAnalysisRequest;
    normalizedText: string;
    entities: readonly ResolvedEntity[];
    categories: readonly SemanticCategory[];
    candidates: readonly CategoryCandidate[];
    modelInput: ModelClassificationInput;
    signature: string;
    startedAt: number;
    budget: AbortSignal;
  }): Promise<SemanticAnalysisResult> {
    const { request, normalizedText, entities, categories, candidates, modelInput, signature } =
      input;
    const { startedAt, budget } = input;
    const candidateCategories = candidates.map((candidate) => candidate.category);

    const fast = await this.classify(modelInput, 'FAST', budget);
    const fastDecision = this.decisionEngine.decide(
      fast.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'FAST',
    );

    if (!fastDecision.requiresDeepAnalysis) {
      await this.budget.recordProviderCalls(request.tenantId, 1);
      return this.resultBuilder.build({
        request,
        normalizedText,
        entities,
        categories,
        startedAt,
        ...this.recuerda(request.tenantId, signature, normalizedText, {
          candidates,
          decision: this.garantizarCategoria(fastDecision, normalizedText, categories),
          tier: 'FAST',
          model: fast.model,
          modelVersion: fast.modelVersion,
          escalated: false,
        }),
      });
    }

    const deep = await this.classify(modelInput, 'DEEP', budget);
    const deepDecision = this.decisionEngine.decide(
      deep.assessments,
      candidateCategories,
      this.config.ambiguityMargin,
      'DEEP',
    );
    await this.budget.recordProviderCalls(request.tenantId, 2);

    return this.resultBuilder.build({
      request,
      normalizedText,
      entities,
      categories,
      startedAt,
      ...this.recuerda(request.tenantId, signature, normalizedText, {
        candidates,
        decision: this.garantizarCategoria(deepDecision, normalizedText, categories),
        tier: 'DEEP',
        model: deep.model,
        modelVersion: deep.modelVersion,
        escalated: true,
      }),
    });
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

  /**
   * Span propio porque es la etapa que más varía entre configuraciones: en modo híbrido añade una
   * llamada de embeddings y una consulta de vectores que, sin él, colgarían del análisis sin
   * explicación.
   *
   * **Sólo se proponen las HOJAS del árbol de categorías.** Un nodo intermedio —«Vivienda»— agrupa
   * a sus hijas y no describe ningún caso concreto: aceptarlo como resultado sería clasificar con
   * menos detalle del que el catálogo ofrece, y encima competiría con sus propias hojas por el
   * mismo texto. En un catálogo plano, donde ninguna categoría tiene hijas, todas son hojas y esto
   * no cambia nada.
   */
  private retrieveCandidates(
    normalizedText: string,
    categories: readonly SemanticCategory[],
    budget: AbortSignal,
  ): Promise<readonly CategoryCandidate[]> {
    const classifiable = leavesOf(categories);
    return this.tracing.runInSpan(
      SPAN_NAMES.retrieve,
      retrieveAttributes(this.config.retrievalMode, classifiable.length),
      async (span) => {
        const candidates = await this.candidateRetriever.retrieve(
          normalizedText,
          classifiable,
          this.config.candidateLimit,
          budget,
        );
        span.setAttribute(SEMANTIC_ATTRIBUTES.candidateCount, candidates.length);
        return candidates;
      },
    );
  }

  private classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    budget: AbortSignal,
  ): Promise<ModelClassification> {
    return this.tracing.runInSpan(
      SPAN_NAMES.classify,
      classifyAttributes(tier, input.candidates.length),
      async (span) => {
        const classification = await this.callProvider(input, tier, budget);
        span.setAttribute(SEMANTIC_ATTRIBUTES.model, classification.model);
        // Sólo lo que el proveedor declaró: un atributo ausente dice «no lo
        // dijo», y un cero puesto por nosotros diría «no gastó». Con un gateway
        // que factura por token esa diferencia es la única pista de que la
        // contabilidad de coste dejó de llegar.
        if (classification.modelVersion !== classification.model) {
          span.setAttribute(SEMANTIC_ATTRIBUTES.resolvedModel, classification.modelVersion);
        }
        setUsageAttributes(span, classification.usage);
        return classification;
      },
    );
  }

  private async callProvider(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    budget: AbortSignal,
  ): Promise<ModelClassification> {
    if (budget.aborted) {
      throw new SemanticTimeoutError(
        `El presupuesto de ${String(this.config.analysisTimeoutSeconds)} s se agotó antes del tier ${tier}.`,
      );
    }
    const startedAt = performance.now();
    try {
      const classification = await this.modelProvider.classify(input, tier, budget);
      this.metrics.recordProviderCall({
        tier,
        model: classification.model,
        durationMs: Math.round(performance.now() - startedAt),
        attempts: 1,
        outcome: 'SUCCESS',
      });
      return classification;
    } catch (error: unknown) {
      this.metrics.recordProviderCall({
        tier,
        model: this.modelProvider.modelFor?.(tier) ?? 'unknown',
        durationMs: Math.round(performance.now() - startedAt),
        attempts: 1,
        outcome: 'FAILURE',
      });
      if (budget.aborted) {
        throw new SemanticTimeoutError(
          `El análisis superó ${String(this.config.analysisTimeoutSeconds)} s durante el tier ${tier}.`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

/** Vuelca el consumo declarado sobre el span, omitiendo lo que no llegó. */
function setUsageAttributes(
  span: { setAttribute: (key: string, value: number) => unknown },
  usage: ProviderUsage | undefined,
): void {
  if (usage === undefined) return;
  const { inputTokens, outputTokens, totalTokens, estimatedCost } = usage;
  if (inputTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.inputTokens, inputTokens);
  if (outputTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.outputTokens, outputTokens);
  if (totalTokens !== undefined) span.setAttribute(SEMANTIC_ATTRIBUTES.totalTokens, totalTokens);
  if (estimatedCost !== undefined) {
    span.setAttribute(SEMANTIC_ATTRIBUTES.estimatedCost, estimatedCost);
  }
}

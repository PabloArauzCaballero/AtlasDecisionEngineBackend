import { Injectable, Logger } from '@nestjs/common';
import { StatementProcessingError } from '../domain/errors';
import type { ParsedStatement } from '../domain/models';
import {
  sanitizeCorrelationId,
  type StatementProcessingContext,
} from '../domain/processing-context';
import { DocumentClassifier } from '../engine/document-classifier';
import { InstitutionDetector } from '../engine/institution-detector';
import { DEFAULT_ISSUER_GATE_OPTIONS, type IssuerGateOptions } from '../engine/issuer-gate';
import {
  DEFAULT_AUTHENTICITY_OPTIONS,
  type AuthenticityGateOptions,
} from '../engine/authenticity/authenticity-gate';
import {
  DEFAULT_AFFORDABILITY_POLICY,
  type AffordabilityPolicy,
} from '../engine/affordability/affordability-policy';
import {
  DEFAULT_SIMILARITY_THRESHOLDS,
  type SimilarityMode,
  type SimilarityThresholds,
} from '../engine/similarity/similarity-scorer';
import { DEFAULT_RECENCY_OPTIONS, type RecencyGateOptions } from '../engine/recency/recency-gate';
import { StatementExtractor } from '../engine/extraction/statement-extractor';
import { StatementParserRegistry } from '../engine/parser-registry';
import type { ResolvedStrategy, StatementParseOutcome } from '../engine/parser-strategy';
import { composeConfidence } from '../engine/quality/confidence';
import { validateStatement } from '../engine/quality/financial-validations';
import type { StatementAnalysis } from '../engine/statement-analysis';
import type { StatementContext } from '../engine/statement-context';
import { ConversionMetrics } from '../engine/telemetry/conversion-metrics';
import { admissionWarnings } from './admission-warnings';
import { diagnoseAnalysis } from './analysis-diagnostics';
import { buildStatementContext } from './statement-context-builder';
import { StageTimer } from './stage-timer';
import { StatementAdmissionGates } from './statement-admission-gates';
import { attachProvisional } from './provisional-analysis';
import { noTransactionsFound, unsupportedStatement } from './statement-rejections';

/** Token de los analizadores especializados con los que se puebla el registro. */
export const STATEMENT_PARSERS = Symbol('STATEMENT_PARSERS');

/**
 * Orquesta el proceso de conversión: extraer, clasificar, identificar la
 * entidad, elegir estrategia, analizar y comprobar.
 *
 * No conoce ningún banco. Todo el conocimiento de formatos vive en las
 * estrategias del registro, y este servicio solo decide qué hacer con lo que
 * ellas devuelven.
 */
@Injectable()
export class BankStatementWorkerService {
  private readonly logger = new Logger(BankStatementWorkerService.name);
  private readonly gates: StatementAdmissionGates;

  constructor(
    private readonly extractor: StatementExtractor,
    private readonly registry: StatementParserRegistry,
    private readonly classifier: DocumentClassifier,
    private readonly institutionDetector: InstitutionDetector,
    private readonly metrics: ConversionMetrics,
    /** Exigencia sobre el EMISOR. Ver `issuer-gate.ts`. */
    issuerGate: IssuerGateOptions = DEFAULT_ISSUER_GATE_OPTIONS,
    /** Exigencia sobre el CONTENEDOR. Ver `authenticity/authenticity-gate.ts`. */
    authenticityGate: AuthenticityGateOptions = DEFAULT_AUTHENTICITY_OPTIONS,
    /** Política de capacidad de pago, con la exigencia de meses dentro. */
    affordabilityPolicy: AffordabilityPolicy = DEFAULT_AFFORDABILITY_POLICY,
    /** Exigencia sobre la VIGENCIA. Ver `recency/recency-gate.ts`. */
    recencyGate: RecencyGateOptions = DEFAULT_RECENCY_OPTIONS,
    /** Umbrales del PARECIDO. Ver `similarity/similarity-scorer.ts`. */
    similarity: SimilarityThresholds = DEFAULT_SIMILARITY_THRESHOLDS,
    /**
     * Qué se hace con el parecido: nada (`OFF`), publicarlo (`MEASURE`) o dejar
     * que sostenga un documento dudoso (`CORROBORATE`).
     *
     * No hay modo que RECHACE por no parecerse, y la ausencia es deliberada: no
     * parecerse es una ausencia de evidencia con mil causas inocentes —el banco
     * cambió su maqueta, el descriptor está incompleto, el PDF venía escaneado—
     * y rechazar por ella castigaría al cliente por lo que no sabemos de su
     * banco. Ver la cabecera de `similarity-scorer.ts`.
     */
    similarityMode: SimilarityMode = 'CORROBORATE',
  ) {
    this.gates = new StatementAdmissionGates({
      issuer: issuerGate,
      authenticity: authenticityGate,
      affordability: affordabilityPolicy,
      recency: recencyGate,
      similarity,
      similarityMode,
    });
  }

  /**
   * @param context Observabilidad opcional. Su `correlationId` se añade a cada
   * traza de esta conversión para poder unirla con la solicitud del anfitrión;
   * omitirlo mantiene el comportamiento anterior sin cambios.
   */
  async process(
    buffer: Buffer,
    context: StatementProcessingContext = {},
  ): Promise<ParsedStatement> {
    return (await this.analyze(buffer, context)).statement;
  }

  /**
   * Igual que `process`, pero devuelve además con qué se leyó el documento y
   * qué tan verificable es. Es la entrada que usa el resultado normalizado; los
   * consumidores que solo quieren los movimientos siguen usando `process`.
   */
  async analyze(
    buffer: Buffer,
    context: StatementProcessingContext = {},
  ): Promise<StatementAnalysis> {
    const startedAt = Date.now();
    const correlation = this.correlationSuffix(context);
    try {
      const analysis = await this.analyzeBuffer(buffer, correlation, context, startedAt);
      this.logger.log(
        `Extracto procesado: entidad=${analysis.statement.metadata.institutionCode} ` +
          `movimientos=${analysis.statement.transactions.length} ` +
          `duracionMs=${Date.now() - startedAt}${correlation}`,
      );
      this.logger.log(
        `Traza de conversión: huella=${analysis.context.source.fileHash.slice(0, 12)} ` +
          `documento=${analysis.context.classification.documentType} ` +
          `estrategia=${analysis.strategy.id}@${analysis.strategy.version} ` +
          `paginas=${analysis.context.source.pageCount} ` +
          `filas=${analysis.statement.transactions.length} ` +
          `comprobaciones=${analysis.validation.checksPassed}/${analysis.validation.checksRun} ` +
          `confianza=${analysis.quality.overallConfidence} ` +
          `banda=${analysis.quality.band}${correlation}`,
      );
      this.metrics.record(analysis);
      return analysis;
    } catch (error) {
      const code = error instanceof StatementProcessingError ? error.code : 'UNKNOWN';
      this.metrics.recordFailure(code, Date.now() - startedAt);
      this.logger.warn(
        `Extracto rechazado: codigo=${code} ` +
          `duracionMs=${Date.now() - startedAt}${correlation}`,
      );
      throw error;
    }
  }

  /**
   * El identificador se sanea aquí y no en la capa HTTP porque el worker
   * también se invoca desde colas, donde nadie garantiza que el valor venga
   * limpio. Sanearlo en el punto donde entra al registro cubre ambas rutas.
   */
  private correlationSuffix(context: StatementProcessingContext): string {
    const correlationId = sanitizeCorrelationId(context.correlationId);
    return correlationId ? ` correlacion=${correlationId}` : '';
  }

  /**
   * Recorre la cascada: prueba las estrategias por orden de confianza y se queda
   * con la primera que produce movimientos.
   *
   * Que continúe con la siguiente en vez de fallar es lo que convierte la lista
   * ordenada en una cascada de verdad: un analizador especializado que reconoce
   * su plantilla pero no encuentra filas —porque el banco cambió la maqueta— deja
   * paso al motor generalista en lugar de rechazar un documento legible.
   */
  private async analyzeBuffer(
    buffer: Buffer,
    correlation: string,
    processing: StatementProcessingContext,
    startedAt: number,
  ): Promise<StatementAnalysis> {
    const timer = new StageTimer();

    const extraction = await timer.time('extraccion', () => this.extractor.extract(buffer));
    const context = timer.timeSync('clasificacion', () =>
      buildStatementContext(
        { classifier: this.classifier, institutionDetector: this.institutionDetector },
        buffer,
        processing,
        extraction,
      ),
    );
    const { authenticity, similarity, rescatado } = this.gates.admitContainer(
      buffer,
      extraction,
      context,
      timer,
      correlation,
    );
    // Emisor en DUDA: va a una persona igual, pero se lee entero (ver `provisional-analysis.ts`).
    const issuerHold = this.gates.holdIssuer(context, timer, correlation);

    const candidates = await timer.time('resolucion', () => this.registry.resolveAll(context));
    if (candidates.length === 0) {
      throw issuerHold ?? unsupportedStatement(context);
    }

    for (const candidate of candidates) {
      const outcome = await timer.time('analisis', () =>
        this.tryStrategy(candidate, context, correlation),
      );
      if (!outcome) continue;

      const statement = outcome.statement;
      const printedTotals = outcome.printedTotals ?? {};
      const validation = timer.timeSync('validacion', () => {
        const lines = diagnoseAnalysis(statement, candidate.strategy.id, correlation, [
          ...extraction.warnings,
          ...outcome.warnings,
        ]);
        for (const line of lines) this.logger.warn(line);
        return validateStatement(statement, printedTotals);
      });
      const quality = composeConfidence({
        documentConfidence: context.classification.confidence,
        institutionConfidence: context.institution.confidence,
        structureConfidence: outcome.structureConfidence,
        reconciliationConfidence: validation.reconciliationConfidence,
        checksRun: validation.checksRun,
      });

      // Con el emisor en duda se MIDE el periodo sin admitirlo: el caso ya va a una persona.
      const { affordability, recency } = issuerHold
        ? this.gates.measurePeriod(statement, timer)
        : this.gates.admitPeriod(statement, timer, correlation);

      const warnings = [
        ...extraction.warnings,
        ...outcome.warnings,
        ...admissionWarnings(affordability, recency, similarity, rescatado),
      ];

      const analysis: StatementAnalysis = {
        statement,
        context,
        authenticity,
        affordability,
        recency,
        similarity,
        strategy: {
          id: candidate.strategy.id,
          kind: candidate.strategy.kind,
          version: candidate.strategy.version,
        },
        detection: candidate.detection,
        quality,
        validation,
        warnings,
        printedTotals,
        accountType: outcome.accountType ?? '',
        accounts: outcome.accounts ?? [],
        ocrPages: extraction.ocrPages,
        stageDurations: timer.durations,
        durationMs: Date.now() - startedAt,
      };
      if (issuerHold) throw attachProvisional(issuerHold, analysis);
      return analysis;
    }

    if (issuerHold) throw issuerHold;
    throw noTransactionsFound(
      context,
      candidates.map((candidate) => candidate.strategy.id),
      extraction.warnings,
    );
  }

  /**
   * Ejecuta una estrategia y decide si su resultado sirve. Un fallo suyo no es
   * un fallo de la conversión: se registra y la cascada continúa.
   */
  private async tryStrategy(
    candidate: ResolvedStrategy,
    context: StatementContext,
    correlation: string,
  ): Promise<StatementParseOutcome | undefined> {
    try {
      const outcome = await candidate.strategy.parse(context);
      if (outcome.statement.transactions.length === 0) {
        this.logger.warn(
          `Estrategia sin movimientos: estrategia=${candidate.strategy.id}${correlation}`,
        );
        return undefined;
      }
      return outcome;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'desconocido';
      this.logger.warn(
        `Estrategia descartada por error: estrategia=${candidate.strategy.id} ` +
          `motivo=${reason.slice(0, 120)}${correlation}`,
      );
      return undefined;
    }
  }
}

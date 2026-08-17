import { Injectable, Logger } from '@nestjs/common';
import { StatementProcessingError } from '../domain/errors';
import type { ParsedStatement } from '../domain/models';
import {
  sanitizeCorrelationId,
  type StatementProcessingContext,
} from '../domain/processing-context';
import { DocumentClassifier } from '../engine/document-classifier';
import { InstitutionDetector } from '../engine/institution-detector';
import {
  StatementExtractor,
  type ExtractionOutcome,
} from '../engine/extraction/statement-extractor';
import { StatementParserRegistry } from '../engine/parser-registry';
import type { ResolvedStrategy, StatementParseOutcome } from '../engine/parser-strategy';
import { composeConfidence } from '../engine/quality/confidence';
import { validateStatement } from '../engine/quality/financial-validations';
import type { StatementAnalysis } from '../engine/statement-analysis';
import { fileDigest, type StatementContext } from '../engine/statement-context';
import { flagAnomalousDescriptions, reconcileRunningBalance } from '../parsers/parser-helpers';
import { ConversionMetrics } from '../engine/telemetry/conversion-metrics';

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

  constructor(
    private readonly extractor: StatementExtractor,
    private readonly registry: StatementParserRegistry,
    private readonly classifier: DocumentClassifier,
    private readonly institutionDetector: InstitutionDetector,
    private readonly metrics: ConversionMetrics,
  ) {}

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
    const stageDurations: Record<string, number> = {};
    const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
      const stageStart = Date.now();
      try {
        return await work();
      } finally {
        stageDurations[stage] = Date.now() - stageStart;
      }
    };

    const extraction = await timed('extraccion', () => this.extractor.extract(buffer));
    const context = timeSync(stageDurations, 'clasificacion', () =>
      this.buildContext(buffer, processing, extraction),
    );
    const candidates = await timed('resolucion', () => this.registry.resolveAll(context));
    if (candidates.length === 0) {
      throw this.unsupported(context);
    }

    for (const candidate of candidates) {
      const outcome = await timed('analisis', () =>
        this.tryStrategy(candidate, context, correlation),
      );
      if (!outcome) continue;

      const statement = outcome.statement;
      const printedTotals = outcome.printedTotals ?? {};
      const validation = timeSync(stageDurations, 'validacion', () => {
        this.verify(statement, candidate, correlation, [
          ...extraction.warnings,
          ...outcome.warnings,
        ]);
        return validateStatement(statement, printedTotals);
      });
      const quality = composeConfidence({
        documentConfidence: context.classification.confidence,
        institutionConfidence: context.institution.confidence,
        structureConfidence: outcome.structureConfidence,
        reconciliationConfidence: validation.reconciliationConfidence,
        checksRun: validation.checksRun,
      });

      return {
        statement,
        context,
        strategy: {
          id: candidate.strategy.id,
          kind: candidate.strategy.kind,
          version: candidate.strategy.version,
        },
        detection: candidate.detection,
        quality,
        validation,
        warnings: [...extraction.warnings, ...outcome.warnings],
        printedTotals,
        accountType: outcome.accountType ?? '',
        accounts: outcome.accounts ?? [],
        ocrPages: extraction.ocrPages,
        stageDurations,
        durationMs: Date.now() - startedAt,
      };
    }

    throw new StatementProcessingError(
      'NO_TRANSACTIONS',
      'El PDF fue reconocido, pero no se encontraron movimientos verificables.',
      422,
      {
        institutionCode: context.institution.code,
        strategies: candidates.map((candidate) => candidate.strategy.id),
      },
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

  /**
   * Construye el contexto que comparten todas las etapas. Se hace una sola vez
   * por documento: la extracción y la clasificación son las dos operaciones más
   * caras del proceso, y ninguna estrategia debe repetirlas.
   */
  private buildContext(
    buffer: Buffer,
    processing: StatementProcessingContext,
    extraction: ExtractionOutcome,
  ): StatementContext {
    const pdf = extraction.pdf;
    return {
      pdf,
      source: {
        fileName: processing.fileName,
        fileHash: fileDigest(buffer),
        byteLength: buffer.byteLength,
        pageCount: pdf.pageCount,
        extractionMethod: extraction.method,
      },
      classification: this.classifier.classify(pdf),
      institution: this.institutionDetector.detect(pdf),
      correlationId: sanitizeCorrelationId(processing.correlationId),
    };
  }

  /**
   * Comprobaciones posteriores al análisis, comunes a cualquier estrategia. No
   * detienen la conversión: degradan la confianza de las filas afectadas y
   * dejan constancia, porque un extracto legítimo puede tener asientos que el
   * analizador no itemiza.
   */
  private verify(
    statement: ParsedStatement,
    resolved: ResolvedStrategy,
    correlation: string,
    warnings: readonly string[],
  ): void {
    const origin =
      `entidad=${statement.metadata.institutionCode} ` + `estrategia=${resolved.strategy.id}`;

    const balanceMismatches = reconcileRunningBalance(statement.transactions);
    if (balanceMismatches > 0) {
      this.logger.warn(
        `Continuidad de saldo inconsistente: ${origin} ` +
          `inconsistencias=${balanceMismatches}${correlation}`,
      );
    }

    const anomalousDescriptions = flagAnomalousDescriptions(statement.transactions);
    if (anomalousDescriptions > 0) {
      // Señal de que el analizador absorbió texto ajeno: una fila cuya glosa
      // se aparta del patrón del propio extracto. Ver flagAnomalousDescriptions.
      this.logger.warn(
        `Descripciones atípicas: ${origin} ` + `filas=${anomalousDescriptions}${correlation}`,
      );
    }

    for (const warning of warnings) {
      this.logger.warn(`Advertencia de análisis: ${origin} ${warning}${correlation}`);
    }
  }

  /**
   * Ninguna estrategia aceptó el documento. Se distingue «no sé de quién es»
   * de «sé de quién es, pero no conozco este formato» porque el segundo caso es
   * accionable: nombra la entidad a la que le falta soporte.
   */
  private unsupported(context: StatementContext): StatementProcessingError {
    // La compuerta va primero: si el documento no demostró ser un estado de
    // cuenta, la entidad que se le atribuya es irrelevante.
    if (!context.classification.isFinancialStatement) {
      const evidence = {
        documentType: context.classification.documentType,
        documentConfidence: context.classification.confidence,
        detectedSignals: context.classification.detectedSignals,
      };
      /*
       * DOS códigos y no uno, y ésta es la distinción que da sentido a la cola
       * de revisión. Con un único `NOT_A_FINANCIAL_STATEMENT` no había forma de
       * separar la factura —que nadie tiene que mirar— del extracto con el
       * encabezado ilegible —que sí—, así que o se derivaban las dos a una
       * persona o ninguna. El clasificador ya lo sabe: sólo hacía falta que el
       * error lo dijera.
       */
      if (context.classification.verdict === 'REVIEW') {
        return new StatementProcessingError(
          'DOUBTFUL_DOCUMENT',
          'El documento se parece a un estado de cuenta, pero las señales no bastan para confirmarlo.',
          422,
          evidence,
        );
      }
      return new StatementProcessingError(
        'NOT_A_FINANCIAL_STATEMENT',
        'El documento no reúne señales suficientes de ser un estado de cuenta.',
        422,
        evidence,
      );
    }
    if (!context.institution.detected) {
      return new StatementProcessingError(
        'UNSUPPORTED_INSTITUTION',
        'No se pudo reconocer una entidad financiera boliviana compatible.',
        422,
        { documentType: context.classification.documentType },
      );
    }
    return new StatementProcessingError(
      'UNSUPPORTED_STATEMENT_FORMAT',
      `Se detectó ${context.institution.name}, pero este formato de extracto aún no tiene un parser verificado.`,
      422,
      { institutionCode: context.institution.code },
    );
  }
}

/**
 * Cronometra una etapa síncrona sin obligar a envolverla en una promesa. Se
 * mide todo el pipeline, no solo lo asíncrono: la clasificación y la validación
 * son las dos etapas que más crecen con el tamaño del documento.
 */
function timeSync<T>(durations: Record<string, number>, stage: string, work: () => T): T {
  const start = Date.now();
  try {
    return work();
  } finally {
    durations[stage] = Date.now() - start;
  }
}

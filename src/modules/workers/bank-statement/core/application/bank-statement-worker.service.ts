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
  assessIssuer,
  DEFAULT_ISSUER_GATE_OPTIONS,
  type IssuerAssessment,
  type IssuerGateOptions,
} from '../engine/issuer-gate';
import {
  assessAuthenticity,
  DEFAULT_AUTHENTICITY_OPTIONS,
  tamperingMessage,
  type AuthenticityAssessment,
  type AuthenticityGateOptions,
} from '../engine/authenticity/authenticity-gate';
import {
  assessAffordability,
  type AffordabilityInput,
} from '../engine/affordability/affordability-engine';
import {
  DEFAULT_AFFORDABILITY_POLICY,
  type AffordabilityPolicy,
} from '../engine/affordability/affordability-policy';
import type { AffordabilityAssessment } from '../engine/affordability/affordability-model';
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
    /** Exigencia sobre el EMISOR. Ver `issuer-gate.ts`. */
    private readonly issuerGate: IssuerGateOptions = DEFAULT_ISSUER_GATE_OPTIONS,
    /** Exigencia sobre el CONTENEDOR. Ver `authenticity/authenticity-gate.ts`. */
    private readonly authenticityGate: AuthenticityGateOptions = DEFAULT_AUTHENTICITY_OPTIONS,
    /** Política de capacidad de pago, con la exigencia de meses dentro. */
    private readonly affordabilityPolicy: AffordabilityPolicy = DEFAULT_AFFORDABILITY_POLICY,
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
    /*
     * La compuerta del CONTENEDOR va antes que la del emisor y que la del
     * contenido, y ese orden es la mitad del arreglo. Las otras dos se contestan
     * leyendo el texto que el PDF imprime, y ese texto lo escribe quien fabrica
     * el archivo: un documento compuesto en Word con la carátula de un banco
     * copiada las pasa las dos y llega al análisis con una tabla de movimientos
     * que redactó el propio solicitante. «Con qué se produjo este archivo» es la
     * única de las tres preguntas que no se puede responder escribiendo el texto
     * correcto.
     */
    const authenticity = timeSync(stageDurations, 'autenticidad', () =>
      assessAuthenticity(buffer, textPageRatio(extraction), this.authenticityGate),
    );
    if (authenticity.disposition !== 'ACCEPT') {
      throw this.rejectedAuthenticity(authenticity, correlation);
    }
    /*
     * La compuerta de emisor va ANTES de la cascada, y esa posición es el
     * arreglo. Estaba —sólo a medias— dentro de `unsupported()`, que únicamente
     * corre cuando NINGUNA estrategia acepta el documento; y el motor generalista
     * acepta cualquier cosa con una tabla de fechas e importes, así que en la
     * práctica el documento ajeno nunca llegaba a esa comprobación: se convertía
     * en movimientos. Preguntar quién lo emitió cuesta una lectura de la
     * carátula que ya está hecha, y ahorra el análisis entero.
     */
    const issuer = timeSync(stageDurations, 'emisor', () =>
      assessIssuer(context.institution, this.issuerGate),
    );
    if (issuer.disposition !== 'ACCEPT') {
      throw this.rejectedIssuer(context, issuer, correlation);
    }

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

      /*
       * La capacidad de pago se calcula AQUÍ, con la estrategia ya elegida y los
       * movimientos ya extraídos, y su exigencia de meses puede tirar el
       * documento. Ponerla después de la conversión —en un servicio que lea el
       * resultado— la convertiría en un análisis opcional que cualquier consumidor
       * puede saltarse; el mínimo de tres meses es una condición de ADMISIÓN, no
       * un informe.
       */
      const affordability = timeSync(stageDurations, 'capacidad', () =>
        assessAffordability(toAffordabilityInput(statement), this.affordabilityPolicy),
      );
      if (!affordability.coverage.satisfied && this.affordabilityPolicy.enforceMinimumMonths) {
        throw this.insufficientPeriod(affordability, correlation);
      }

      return {
        statement,
        context,
        authenticity,
        affordability,
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
    const classification = this.classificationFailure(context);
    if (classification) return classification;
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

  /**
   * El error cuando la clasificación no avala el documento, o nada si sí lo
   * avala.
   *
   * DOS códigos y no uno, y ésta es la distinción que da sentido a la cola de
   * revisión. Con un único `NOT_A_FINANCIAL_STATEMENT` no había forma de separar
   * la factura —que nadie tiene que mirar— del extracto con el encabezado
   * ilegible —que sí—, así que o se derivaban las dos a una persona o ninguna.
   * El clasificador ya lo sabe: sólo hacía falta que el error lo dijera.
   */
  private classificationFailure(context: StatementContext): StatementProcessingError | undefined {
    if (context.classification.isFinancialStatement) return undefined;
    const evidence = {
      documentType: context.classification.documentType,
      documentConfidence: context.classification.confidence,
      detectedSignals: context.classification.detectedSignals,
    };
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

  /**
   * El error del EMISOR, y por qué la clasificación manda sobre él.
   *
   * Cuando el documento además falla la clasificación, quien manda es ella: «no
   * es un estado de cuenta» dice más —y es más accionable para quien lo subió—
   * que «no reconozco a su emisor». Sólo cuando el documento SÍ demostró ser un
   * estado de cuenta el problema es de quién lo firma, y entonces sí se dice.
   */
  private rejectedIssuer(
    context: StatementContext,
    issuer: IssuerAssessment,
    correlation: string,
  ): StatementProcessingError {
    const classification = this.classificationFailure(context);
    if (classification) return classification;

    this.logger.warn(
      `Emisor rechazado: veredicto=${issuer.verdict} ` +
        `motivos=${issuer.reasons.join('|')}${correlation}`,
    );
    const evidence = {
      issuerVerdict: issuer.verdict,
      issuerReasons: issuer.reasons,
      institutionCode: context.institution.code,
      nonBankingIssuer: context.institution.nonBankingIssuer?.name,
    };

    if (issuer.verdict === 'UNLICENSED') {
      return new StatementProcessingError(
        'UNLICENSED_INSTITUTION',
        `El documento se atribuye a ${context.institution.name}, cuya licencia de ASFI no está vigente.`,
        422,
        evidence,
      );
    }
    if (issuer.verdict === 'NON_BANKING') {
      return new StatementProcessingError(
        'NON_BANKING_ISSUER',
        `El documento lo emitió ${context.institution.nonBankingIssuer?.name ?? 'una entidad no financiera'}, ` +
          'que no es una entidad financiera supervisada por ASFI.',
        422,
        evidence,
      );
    }
    if (issuer.disposition === 'REVIEW') {
      return new StatementProcessingError(
        'UNSUPPORTED_INSTITUTION',
        'No se pudo reconocer una entidad financiera boliviana compatible.',
        422,
        evidence,
      );
    }
    return new StatementProcessingError(
      'UNRECOGNIZED_ISSUER',
      'La carátula del documento no identifica a ninguna entidad financiera boliviana.',
      422,
      evidence,
    );
  }

  /**
   * El error del CONTENEDOR.
   *
   * El mensaje que viaja es el de `tamperingMessage`, sin el detalle técnico:
   * decirle a quien subió el archivo qué señal exacta lo delató es enseñarle qué
   * evitar la próxima vez, y a un cliente honesto no le sirve de nada. El detalle
   * va en `details`, que es lo que se guarda y se audita.
   */
  private rejectedAuthenticity(
    authenticity: AuthenticityAssessment,
    correlation: string,
  ): StatementProcessingError {
    this.logger.warn(
      `Documento rechazado por autenticidad: veredicto=${authenticity.verdict} ` +
        `puntaje=${String(authenticity.report.suspicionScore)} ` +
        `senales=${authenticity.report.signals.map((signal) => signal.code).join('|')}${correlation}`,
    );
    const evidence = {
      authenticityVerdict: authenticity.verdict,
      suspicionScore: authenticity.report.suspicionScore,
      signals: authenticity.report.signals.map((signal) => signal.code),
      producer: authenticity.report.provenance.producer,
      creator: authenticity.report.provenance.creator,
      incrementalUpdates: authenticity.report.provenance.incrementalUpdates,
    };

    const active = authenticity.report.signals.some(
      (signal) => signal.code === 'CONTENIDO_ACTIVO' || signal.code === 'ARCHIVOS_INCRUSTADOS',
    );
    if (active) {
      return new StatementProcessingError(
        'ACTIVE_CONTENT_IN_DOCUMENT',
        'El PDF contiene contenido ejecutable o archivos incrustados. No se procesa.',
        422,
        evidence,
      );
    }
    if (authenticity.verdict === 'TAMPERED') {
      return new StatementProcessingError(
        'TAMPERED_DOCUMENT',
        tamperingMessage('TAMPERED'),
        422,
        evidence,
      );
    }
    return new StatementProcessingError(
      'SUSPECTED_TAMPERING',
      tamperingMessage('SUSPECT'),
      422,
      evidence,
    );
  }

  /** El extracto se leyó bien y no alcanza los meses que la política exige. */
  private insufficientPeriod(
    affordability: AffordabilityAssessment,
    correlation: string,
  ): StatementProcessingError {
    const { coverage } = affordability;
    this.logger.warn(
      `Extracto con periodo insuficiente: completos=${String(coverage.monthsComplete)} ` +
        `exigidos=${String(coverage.minimumMonthsRequired)} ` +
        `ventana=${coverage.from ?? '?'}..${coverage.to ?? '?'}${correlation}`,
    );
    return new StatementProcessingError(
      'INSUFFICIENT_STATEMENT_PERIOD',
      `El extracto cubre ${String(coverage.monthsComplete)} mes(es) completo(s) y se necesitan ` +
        `${String(coverage.minimumMonthsRequired)}. Descarga de tu banca por internet el extracto ` +
        `de los últimos ${String(coverage.minimumMonthsRequired)} meses completos y vuelve a subirlo.`,
      422,
      {
        monthsComplete: coverage.monthsComplete,
        monthsObserved: coverage.monthsObserved,
        minimumMonthsRequired: coverage.minimumMonthsRequired,
        periodFrom: coverage.from,
        periodTo: coverage.to,
        gapMonths: coverage.gapMonths,
      },
    );
  }
}

/**
 * Proporción de páginas con capa de texto.
 *
 * Se calcula sobre lo que la extracción ya sabe, y sirve para que la compuerta de
 * autenticidad no penalice a un escaneado por ausencias que en una imagen no
 * significan nada: en una página sin texto no hay fuentes que incrustar ni
 * anotaciones que superponer.
 */
function textPageRatio(extraction: ExtractionOutcome): number {
  const total = extraction.pdf.pageCount;
  if (total <= 0) return 0;
  return Math.max(0, (total - extraction.ocrPages.length) / total);
}

/**
 * Reduce el extracto interno a lo que la capacidad de pago necesita.
 *
 * Los importes pasan de cadena a número aquí y sólo aquí para este consumidor.
 * El núcleo sigue trabajando con cadenas exactas por [ADR-0006]; la evaluación
 * necesita aritmética, y hacer la conversión en el borde deja claro dónde se
 * pierde la exactitud decimal en vez de repartirlo por el módulo.
 */
function toAffordabilityInput(statement: ParsedStatement): AffordabilityInput {
  return {
    transactions: statement.transactions.map((transaction) => ({
      date: normalizeDate(transaction.transactionDate),
      description: transaction.description,
      debit: toNumberOrNull(transaction.debit),
      credit: toNumberOrNull(transaction.credit),
      balance: toNumberOrNull(transaction.balance),
    })),
    periodFrom: normalizeDate(statement.metadata.periodStart),
    periodTo: normalizeDate(statement.metadata.periodEnd),
    currency:
      statement.metadata.accountCurrency === 'UNKNOWN' ? null : statement.metadata.accountCurrency,
    closingBalance: toNumberOrNull(statement.metadata.closingBalance),
  };
}

/** `AAAA-MM-DD`, o `null`. El núcleo ya normaliza las fechas; esto es la red. */
function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(value.trim());
  if (local) return `${local[3]}-${local[2]}-${local[1]}`;
  return null;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

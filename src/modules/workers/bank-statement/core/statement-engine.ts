import { BankStatementWorkerService } from './application/bank-statement-worker.service';
import type { ParsedStatement } from './domain/models';
import type { StatementProcessingContext } from './domain/processing-context';
import type { StatementParser } from './domain/statement-parser';
import { DocumentClassifier } from './engine/document-classifier';
import type { TriageThresholds } from './engine/document-triage';
import type { StatementOcrPort } from './engine/extraction/ocr-port';
import { StatementExtractor } from './engine/extraction/statement-extractor';
import { GenericStatementStrategy } from './engine/generic/generic-statement.strategy';
import { InstitutionDetector } from './engine/institution-detector';
import { DEFAULT_ISSUER_GATE_OPTIONS, type IssuerGateOptions } from './engine/issuer-gate';
import {
  DEFAULT_AUTHENTICITY_OPTIONS,
  type AuthenticityGateOptions,
} from './engine/authenticity/authenticity-gate';
import {
  normalizeAffordabilityPolicy,
  type AffordabilityPolicy,
} from './engine/affordability/affordability-policy';
import { ASFI_SEED_REGISTRY, type InstitutionRegistry } from './institutions/institution-registry';
import { toNormalizedStatement } from './engine/normalized/normalized-mapper';
import type { NormalizedBankStatement } from './engine/normalized/normalized-model';
import {
  listTransactionDescriptions,
  type TransactionDescription,
} from './engine/normalized/transaction-descriptions';
import { StatementParserRegistry } from './engine/parser-registry';
import { ProfileStatementStrategy } from './engine/profiles/profile.strategy';
import { parseStatementProfiles } from './engine/profiles/statement-profile';
import type { StatementAnalysis } from './engine/statement-analysis';
import { ConversionMetrics } from './engine/telemetry/conversion-metrics';
import { BcpStatementParser } from './parsers/bcp.parser';
import { BancoSolStatementParser } from './parsers/bancosol.parser';
import { BnbStatementParser } from './parsers/bnb.parser';
import { EconomicoStatementParser } from './parsers/economico.parser';
import { GanaderoStatementParser } from './parsers/ganadero.parser';
import { MercantilStatementParser } from './parsers/mercantil.parser';
import { UnionStatementParser } from './parsers/union.parser';
import { DEFAULT_BANK_STATEMENT_OPTIONS, type BankStatementModuleOptions } from './options';
import { LayoutPdfReader } from './pdf/layout-pdf-reader';

export interface StatementEngineOptions {
  /** Límites de tamaño, páginas y tiempo. Se completan con los de por defecto. */
  readonly limits?: Partial<BankStatementModuleOptions>;
  /**
   * Fronteras entre procesar, preguntar y rechazar. Se dejan configurables
   * porque son lo primero que hay que recalibrar con documentos reales, y
   * hacerlo no puede exigir recompilar el motor.
   */
  readonly triage?: Partial<TriageThresholds>;
  /**
   * De dónde sale el padrón de entidades. Por defecto, la nómina de ASFI
   * compilada; el motor desplegado inyecta aquí la tabla administrable.
   */
  readonly institutions?: InstitutionRegistry;
  /** Exigencia sobre el emisor del documento. Ver `engine/issuer-gate.ts`. */
  readonly issuerGate?: Partial<IssuerGateOptions>;
  /**
   * Exigencia sobre el CONTENEDOR: si el archivo es el que emitió un banco o lo
   * fabricó alguien. Ver `engine/authenticity/authenticity-gate.ts`.
   */
  readonly authenticityGate?: Partial<AuthenticityGateOptions>;
  /**
   * Política de capacidad de pago, con la exigencia de meses completos dentro.
   * El mínimo de tres no se puede bajar por configuración; ver
   * `engine/affordability/affordability-policy.ts`.
   */
  readonly affordability?: Partial<AffordabilityPolicy>;
  /** Reconocimiento óptico, si el anfitrión lo aporta. */
  readonly ocr?: StatementOcrPort;
  /** Perfiles de formato en JSON, validados al construir el motor. */
  readonly profiles?: readonly unknown[];
  /**
   * Analizadores especializados. Por defecto, los siete verificados; pasar una
   * lista propia permite añadir uno sin tocar el módulo, o quitarlos todos para
   * probar el motor generalista aislado.
   */
  readonly parsers?: readonly StatementParser[];
  /** Registrar el motor generalista al final de la cascada. Por defecto, sí. */
  readonly includeGenericEngine?: boolean;
}

export interface StatementEngine {
  /** Movimientos en el contrato interno, igual que `POST /csv` y `/json`. */
  process(pdf: Buffer, context?: StatementProcessingContext): Promise<ParsedStatement>;
  /** Resultado completo: estrategia elegida, comprobaciones y confianza. */
  analyze(pdf: Buffer, context?: StatementProcessingContext): Promise<StatementAnalysis>;
  /** Contrato normalizado, el mismo que devuelve `POST /normalized`. */
  normalize(pdf: Buffer, context?: StatementProcessingContext): Promise<NormalizedBankStatement>;
  /** Solo las glosas, con su número de transacción y un identificador estable. */
  describe(pdf: Buffer, context?: StatementProcessingContext): Promise<TransactionDescription[]>;
  /** Registro vivo: se pueden añadir estrategias después de construirlo. */
  readonly registry: StatementParserRegistry;
  readonly metrics: ConversionMetrics;
}

/**
 * Construye el motor completo **sin NestJS**.
 *
 * El módulo se diseñó como módulo embebible de Nest, y ese sigue siendo el
 * camino recomendado cuando el anfitrión ya lo usa. Pero el análisis no depende
 * de Nest en nada: esta función arma las mismas piezas con las mismas reglas de
 * composición —los siete analizadores, los perfiles, el generalista al final—
 * para que un backend en Express, en Fastify o en una cola de trabajos pueda
 * usarlo sin adoptar un contenedor de inyección de dependencias.
 *
 * Es la única función del paquete que conoce a la vez el motor y los
 * analizadores concretos: es una raíz de composición, no una capa. El núcleo
 * sigue sin nombrar ningún banco.
 */
export function createStatementEngine(options: StatementEngineOptions = {}): StatementEngine {
  const limits: BankStatementModuleOptions = {
    ...DEFAULT_BANK_STATEMENT_OPTIONS,
    ...options.limits,
  };

  const parsers = options.parsers ?? [
    new GanaderoStatementParser(),
    new EconomicoStatementParser(),
    new BcpStatementParser(),
    new MercantilStatementParser(),
    new BnbStatementParser(),
    new UnionStatementParser(),
    new BancoSolStatementParser(),
  ];

  const registry = StatementParserRegistry.fromSpecializedParsers(parsers);
  for (const profile of parseStatementProfiles([...(options.profiles ?? [])])) {
    registry.register(new ProfileStatementStrategy(profile));
  }
  if (options.includeGenericEngine !== false) {
    registry.register(new GenericStatementStrategy());
  }

  const metrics = new ConversionMetrics();
  const worker = new BankStatementWorkerService(
    new StatementExtractor(new LayoutPdfReader(limits), options.ocr),
    registry,
    new DocumentClassifier(options.triage ?? {}),
    new InstitutionDetector(options.institutions ?? ASFI_SEED_REGISTRY),
    metrics,
    { ...DEFAULT_ISSUER_GATE_OPTIONS, ...options.issuerGate },
    { ...DEFAULT_AUTHENTICITY_OPTIONS, ...options.authenticityGate },
    normalizeAffordabilityPolicy(options.affordability),
  );

  return {
    registry,
    metrics,
    process: (pdf, context) => worker.process(pdf, context),
    analyze: (pdf, context) => worker.analyze(pdf, context),
    normalize: async (pdf, context) => toNormalizedStatement(await worker.analyze(pdf, context)),
    describe: async (pdf, context) =>
      listTransactionDescriptions(await worker.analyze(pdf, context)),
  };
}

import { detectWithAnalyzer, parseWithAnalyzer } from '../generic/generic-statement.strategy';
import type { CanonicalField } from '../generic/header-lexicon';
import { DEFAULT_NUMBER_FORMAT, type NumberFormat } from '../generic/number-format';
import { TableAnalyzer } from '../generic/table-analyzer';
import type {
  ParserDetectionResult,
  StatementParseOutcome,
  StatementParserStrategy,
} from '../parser-strategy';
import type { StatementContext } from '../statement-context';
import { DEFAULT_PROFILE_CEILING, type StatementProfile } from './statement-profile';

/**
 * Estrategia que aplica un perfil configurable.
 *
 * Usa exactamente el mismo analizador que el motor generalista, con los ajustes
 * del perfil. Esa reutilización es deliberada: si un perfil pudiera traer su
 * propia forma de leer tablas, el proyecto acabaría con dos motores que se
 * comportan distinto ante el mismo documento y solo uno de los dos probado.
 */
/**
 * Evidencia documental que aporta un perfil cuyas señales coincidieron todas.
 * Alta, pero no total: quien escribió el perfil pudo equivocarse de formato.
 */
const PROFILE_SIGNAL_EVIDENCE = 0.9;

export class ProfileStatementStrategy implements StatementParserStrategy {
  readonly kind = 'PROFILE' as const;
  readonly id: string;
  readonly version = '1';

  private readonly analyzer: TableAnalyzer;

  constructor(private readonly profile: StatementProfile) {
    this.id = `profile:${profile.id}`;
    this.analyzer = new TableAnalyzer({
      extraAliases: toAliasMap(profile),
      numberFormat: toNumberFormat(profile),
      dayFirst: profile.dayFirst,
      ignoredPatterns: profile.ignoredPatterns,
    });
  }

  canHandle(context: StatementContext): Promise<ParserDetectionResult> {
    const missing = this.profile.documentSignals.filter((signal) => !signal.test(context.pdf.text));
    if (missing.length > 0) {
      return Promise.resolve({
        canHandle: false,
        confidence: 0,
        reasons: [`senales-ausentes:${missing.length}`],
      });
    }

    const detection = detectWithAnalyzer(this.analyzer, context, {
      ceiling: this.profile.confidenceCeiling ?? DEFAULT_PROFILE_CEILING,
      gateOnClassification: false,
      // Todas las señales declaradas coincidieron: esa es la evidencia de que
      // el documento es lo que el perfil dice, y pesa más que la heurística.
      documentEvidence: Math.max(context.classification.confidence, PROFILE_SIGNAL_EVIDENCE),
    });
    return Promise.resolve({
      ...detection,
      reasons: [`perfil:${this.profile.id}`, ...detection.reasons],
    });
  }

  parse(context: StatementContext): Promise<StatementParseOutcome> {
    const outcome = parseWithAnalyzer(this.analyzer.analyze(context.pdf), context);
    // El perfil puede nombrar la entidad que el registro no reconoce: es
    // información declarada por quien configuró el perfil, no una deducción.
    if (!this.profile.institutionCode && !this.profile.institutionName) {
      return Promise.resolve(outcome);
    }
    return Promise.resolve({
      ...outcome,
      statement: {
        ...outcome.statement,
        metadata: {
          ...outcome.statement.metadata,
          institutionCode:
            this.profile.institutionCode ?? outcome.statement.metadata.institutionCode,
          institutionName:
            this.profile.institutionName ?? outcome.statement.metadata.institutionName,
        },
      },
    });
  }
}

function toAliasMap(
  profile: StatementProfile,
): ReadonlyMap<CanonicalField, readonly RegExp[]> | undefined {
  const entries = Object.entries(profile.headerAliases ?? {}) as Array<
    [CanonicalField, readonly RegExp[]]
  >;
  if (entries.length === 0) return undefined;
  return new Map(entries);
}

function toNumberFormat(profile: StatementProfile): NumberFormat | undefined {
  if (!profile.decimalSeparator) return undefined;
  return {
    decimalSeparator: profile.decimalSeparator,
    thousandSeparator:
      profile.thousandSeparator ??
      (profile.decimalSeparator === ',' ? '.' : DEFAULT_NUMBER_FORMAT.thousandSeparator),
    // La convención viene declarada, no medida: la evidencia es el propio
    // perfil, y así queda distinguible de una deducción del documento.
    evidence: 0,
  };
}

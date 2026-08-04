import type { StatementParser } from '../domain/statement-parser';
import type { StatementContext } from './statement-context';
import type {
  ParserDetectionResult,
  StatementParseOutcome,
  StatementParserStrategy,
} from './parser-strategy';

/**
 * Confianza de un analizador especializado que acepta el documento.
 *
 * Es 1 y no un valor calculado porque su `supports()` exige tres marcas
 * simultáneas de una plantilla **medida sobre un extracto real**: no hay
 * evidencia más fuerte disponible en este módulo, y ninguna otra estrategia
 * debe poder superarla.
 */
const SPECIALIZED_CONFIDENCE = 1;

/**
 * Adapta un analizador de banco al contrato de estrategia.
 *
 * Es lo que permite que los siete analizadores verificados entren en la cascada
 * **sin tocar su código**: siguen recibiendo un `ExtractedPdf` y devolviendo un
 * `ParsedStatement`, y este adaptador aporta la confianza, la identidad y la
 * versión que el registro necesita para ordenarlos frente a las demás
 * estrategias.
 */
export class SpecializedParserStrategy implements StatementParserStrategy {
  readonly kind = 'SPECIALIZED' as const;
  readonly id: string;
  readonly version: string;

  constructor(private readonly parser: StatementParser) {
    this.id = `specialized:${parser.formatId}`;
    // El sufijo del `formatId` ya versiona la plantilla: `-v2` significa que el
    // banco cambió el formato y que el detector anterior no se relajó.
    this.version = parser.formatId.match(/-v(\d+)$/)?.[1] ?? '1';
  }

  get institutionCode(): string {
    return this.parser.institutionCode;
  }

  canHandle(context: StatementContext): Promise<ParserDetectionResult> {
    const supported = this.parser.supports(context.pdf);
    return Promise.resolve({
      canHandle: supported,
      confidence: supported ? SPECIALIZED_CONFIDENCE : 0,
      reasons: [
        supported
          ? `marcas-del-formato:${this.parser.formatId}`
          : `formato-no-reconocido:${this.parser.formatId}`,
      ],
    });
  }

  parse(context: StatementContext): Promise<StatementParseOutcome> {
    return Promise.resolve({
      statement: this.parser.parse(context.pdf),
      structureConfidence: SPECIALIZED_CONFIDENCE,
      warnings: [],
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { ExtractedPdf } from '../domain/models';
import type { DocumentClassification } from './statement-context';

/**
 * Señal de que un documento es —o no es— un estado de cuenta.
 *
 * Cada una aporta un peso fijo y **justificado por lo que demuestra**, no un
 * porcentaje elegido a ojo: un título financiero identifica el documento por sí
 * solo, mientras que un rótulo suelto como «Saldo» aparece también en un
 * comprobante individual y por eso pesa un tercio.
 */
interface ClassificationSignal {
  readonly id: string;
  readonly weight: number;
  readonly matches: (evidence: DocumentEvidence) => boolean;
}

interface DocumentEvidence {
  readonly text: string;
  /**
   * Encabezado: donde un documento DICE lo que es.
   *
   * Se separa del cuerpo porque las dos preguntas son distintas. «¿De qué habla
   * este documento?» se responde con el texto entero; «¿qué dice ser?» sólo con
   * su cabecera, y confundirlas es lo que hacía que un extracto de sesenta
   * páginas se rechazara por llevar la palabra «contrato» en la glosa de una
   * cuota de hipoteca.
   */
  readonly header: string;
  readonly dateRows: number;
  readonly amountRows: number;
}

/** Tipos de documento que el motor sabe nombrar, por su título. */
const DOCUMENT_TYPES: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  {
    type: 'BANK_STATEMENT',
    pattern: /extracto\s+(?:de\s+)?(?:cuenta|caja|movimiento|ahorro)/i,
  },
  {
    type: 'ACCOUNT_STATEMENT',
    pattern: /estado\s+de\s+cuenta|resumen\s+de\s+cuenta|account\s+statement/i,
  },
  {
    type: 'TRANSACTION_HISTORY',
    pattern:
      /(?:historial|reporte)\s+de\s+(?:movimiento|transaccion)|transaction\s+(?:history|report)/i,
  },
  // Solo la tarjeta: «resumen de cuenta» es un estado de cuenta, y confundirlos
  // etiquetaba como resumen de tarjeta el extracto real del Banco Nacional.
  {
    type: 'CARD_SUMMARY',
    pattern: /resumen\s+de\s+tarjeta|estado\s+de\s+tarjeta/i,
  },
  {
    type: 'BANK_STATEMENT',
    pattern: /extracto\s+de\s+movimientos|extracto\s+bancario/i,
  },
];

/** Documentos que se parecen a un extracto pero no lo son. */
const COUNTER_INDICATORS =
  /\bfactura\b|\binvoice\b|nota\s+fiscal|\bcontrato\b|\bcertificad[oa]\b|\bp[oó]liza\b|\bcurr[ií]culum\b|informe\s+de\s+laboratorio|\brecibo\s+de\s+(?:sueldo|haberes)\b/i;

const AMOUNT = /(?<![\d.,])-?(?:Bs|\$us|USD)?\s?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b/;
const DATE =
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4}\b/;

/**
 * Mínimo de filas con fecha y con importe para hablar de una tabla de
 * movimientos. Con dos filas no hay tabla que valga: el extracto real más
 * pequeño medido tiene dos movimientos, así que el umbral se fija en dos y la
 * decisión final la toma la suma de señales, no este número.
 */
const MINIMUM_TABLE_ROWS = 2;

const SIGNALS: readonly ClassificationSignal[] = [
  {
    id: 'titulo-financiero',
    weight: 0.3,
    matches: (evidence) =>
      DOCUMENT_TYPES.some((candidate) => candidate.pattern.test(evidence.text)),
  },
  {
    id: 'rotulo-de-cuenta',
    weight: 0.1,
    matches: (evidence) =>
      /\bcuenta\b|\bn[uú]mero\s+de\s+cuenta\b|\baccount\s+number\b|\bIBAN\b/i.test(evidence.text),
  },
  {
    id: 'rotulo-de-saldo',
    weight: 0.1,
    matches: (evidence) => /\bsaldo\b|\bbalance\b/i.test(evidence.text),
  },
  {
    id: 'columna-de-importe',
    weight: 0.1,
    matches: (evidence) =>
      /\bmonto\b|\bimporte\b|\bd[eé]bito[s]?\b|\bcr[eé]dito[s]?\b|\bdebit\b|\bcredit\b|\bamount\b/i.test(
        evidence.text,
      ),
  },
  {
    id: 'filas-con-fecha',
    weight: 0.2,
    matches: (evidence) => evidence.dateRows >= MINIMUM_TABLE_ROWS,
  },
  {
    id: 'filas-con-importe',
    weight: 0.2,
    matches: (evidence) => evidence.amountRows >= MINIMUM_TABLE_ROWS,
  },
];

/**
 * Peso que se resta cuando el documento **se anuncia** como otra cosa. No es
 * definitivo a propósito: un extracto puede contener la palabra «factura» en la
 * glosa de un pago, así que resta en lugar de descartar.
 */
const COUNTER_INDICATOR_PENALTY = 0.35;

/**
 * Tope del encabezado, para el documento que nunca llega a tener tabla.
 *
 * El encabezado termina de verdad donde EMPIEZA LA TABLA —la primera línea con
 * fecha e importe a la vez—, no en un número fijo de líneas: así se ajusta solo
 * a un extracto de sesenta páginas y a uno de cinco. Este tope sólo actúa cuando
 * no hay ninguna fila de datos, que es el caso de un documento que no es un
 * extracto en absoluto.
 */
const MAX_HEADER_LINES = 40;

/**
 * Umbral a partir del cual se acepta procesar el documento.
 *
 * Un extracto sin ningún rótulo reconocible todavía suma 0.70 —título, filas
 * con fecha y filas con importe—, y un documento que solo tenga fechas e
 * importes, como una factura, se queda en 0.40 antes de la penalización. El
 * umbral se sitúa entre ambos.
 */
export const FINANCIAL_STATEMENT_THRESHOLD = 0.55;

/**
 * Decide si un PDF es un estado de cuenta **antes** de intentar extraer
 * movimientos.
 *
 * Es la compuerta que permite que el motor generalista exista sin convertir un
 * contrato o una factura en movimientos inventados: sin esta etapa, un analizador
 * que acepta cualquier documento produciría filas plausibles de cualquier cosa
 * que tenga fechas e importes.
 */
@Injectable()
export class DocumentClassifier {
  classify(pdf: ExtractedPdf): DocumentClassification {
    const evidence = this.collect(pdf);
    const detectedSignals: string[] = [];
    let score = 0;

    for (const signal of SIGNALS) {
      if (!signal.matches(evidence)) continue;
      detectedSignals.push(signal.id);
      score += signal.weight;
    }

    // Sólo en el encabezado: ahí es donde un documento dice lo que es.
    if (COUNTER_INDICATORS.test(evidence.header)) {
      detectedSignals.push('contraindicador-de-otro-documento');
      score -= COUNTER_INDICATOR_PENALTY;
    }

    const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));
    return {
      documentType: this.documentType(evidence.text, confidence),
      isFinancialStatement: confidence >= FINANCIAL_STATEMENT_THRESHOLD,
      confidence,
      detectedSignals,
    };
  }

  private collect(pdf: ExtractedPdf): DocumentEvidence {
    let dateRows = 0;
    let amountRows = 0;
    for (const line of pdf.lines) {
      if (DATE.test(line.text)) dateRows += 1;
      if (AMOUNT.test(line.text)) amountRows += 1;
    }
    return { text: pdf.text, header: this.header(pdf), dateRows, amountRows };
  }

  /**
   * Lo que va ANTES de la primera fila de movimientos.
   *
   * Una fila de movimiento lleva fecha e importe en la misma línea; en cuanto
   * aparece una, lo que sigue son datos y ya no es el documento hablando de sí
   * mismo. Cortar ahí es lo que permite que la palabra «contrato» de una cuota de
   * hipoteca no se lea como «este documento es un contrato».
   */
  private header(pdf: ExtractedPdf): string {
    const encabezado: string[] = [];
    for (const line of pdf.lines.slice(0, MAX_HEADER_LINES)) {
      if (DATE.test(line.text) && AMOUNT.test(line.text)) break;
      encabezado.push(line.text);
    }
    return encabezado.join('\n');
  }

  private documentType(text: string, confidence: number): string {
    const matched = DOCUMENT_TYPES.find((candidate) => candidate.pattern.test(text));
    if (matched) return matched.type;
    return confidence >= FINANCIAL_STATEMENT_THRESHOLD ? 'FINANCIAL_DOCUMENT' : 'UNKNOWN_DOCUMENT';
  }
}

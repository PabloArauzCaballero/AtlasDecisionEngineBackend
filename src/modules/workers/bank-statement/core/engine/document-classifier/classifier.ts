import { Injectable } from '@nestjs/common';
import type { ExtractedPdf } from '../../domain/models';
import { normalizeThresholds, triageDocument, type TriageThresholds } from '../document-triage';
import type { DocumentClassification } from '../statement-context';
import { routeForDocumentType } from '../document-routes';
import {
  AMOUNT,
  COUNTER_INDICATORS,
  COUNTER_INDICATOR_PENALTY,
  DATE,
  DECISIVE_COUNTER_INDICATORS,
  DOCUMENT_TYPES,
  DocumentEvidence,
  MAX_HEADER_LINES,
  OTHER_DOCUMENT_TYPES,
  SIGNALS,
} from './patterns';

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
  private readonly thresholds: TriageThresholds;

  /**
   * Las fronteras se inyectan para poder calibrarlas con datos reales sin
   * recompilar. Omitirlas deja las medidas sobre los documentos del módulo.
   */
  constructor(thresholds: Partial<TriageThresholds> = {}) {
    this.thresholds = normalizeThresholds(thresholds);
  }

  classify(pdf: ExtractedPdf): DocumentClassification {
    const evidence = this.collect(pdf);
    const decisive = DECISIVE_COUNTER_INDICATORS.find((candidate) =>
      candidate.pattern.test(evidence.header),
    );
    if (decisive) {
      /*
       * Se sale antes de sumar nada. No es un atajo de rendimiento: sumar las
       * señales y restar después dejaría un número entre 0 y 1 que invita a
       * recalibrarlo, y aquí no hay nada que calibrar. El documento trae impresa
       * la marca de otro documento.
       */
      return {
        documentType: decisive.type,
        isFinancialStatement: false,
        confidence: 0,
        detectedSignals: [`documento-de-otra-clase:${decisive.type}`],
        verdict: 'REJECT',
        routing: routeForDocumentType(decisive.type),
      };
    }

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
    const verdict = triageDocument(confidence, this.thresholds);
    const documentType = this.documentType(evidence.text, confidence);
    return {
      documentType,
      isFinancialStatement: verdict === 'ACCEPT',
      confidence,
      detectedSignals,
      verdict,
      routing: routeForDocumentType(documentType),
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
    // Los otros títulos se miran DESPUÉS: un extracto que además menciona un
    // comprobante en una glosa sigue siendo un extracto.
    const other = OTHER_DOCUMENT_TYPES.find((candidate) => candidate.pattern.test(text));
    if (other) return other.type;
    return confidence >= this.thresholds.accept ? 'FINANCIAL_DOCUMENT' : 'UNKNOWN_DOCUMENT';
  }
}

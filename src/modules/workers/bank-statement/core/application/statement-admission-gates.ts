import { Logger } from '@nestjs/common';
import type { ParsedStatement } from '../domain/models';
import { assessAffordability } from '../engine/affordability/affordability-engine';
import type { AffordabilityAssessment } from '../engine/affordability/affordability-model';
import type { AffordabilityPolicy } from '../engine/affordability/affordability-policy';
import {
  assessAuthenticity,
  type AuthenticityAssessment,
  type AuthenticityGateOptions,
} from '../engine/authenticity/authenticity-gate';
import type { ExtractionOutcome } from '../engine/extraction/statement-extractor';
import { assessIssuer, type IssuerGateOptions } from '../engine/issuer-gate';
import {
  assessRecency,
  type RecencyAssessment,
  type RecencyGateOptions,
} from '../engine/recency/recency-gate';
import { buildDocumentFingerprint } from '../engine/similarity/document-fingerprint';
import {
  assessSimilarity,
  similarityLabel,
  type SimilarityAssessment,
  type SimilarityMode,
  type SimilarityThresholds,
} from '../engine/similarity/similarity-scorer';
import type { StatementContext } from '../engine/statement-context';
import { toAffordabilityInput } from './affordability-input';
import {
  authenticityRejection,
  authenticityRejectionLog,
  insufficientPeriod,
  insufficientPeriodLog,
  recencyRejection,
  recencyRejectionLog,
} from './period-and-container-rejections';
import { classificationFailure, issuerRejection, issuerRejectionLog } from './statement-rejections';
import type { StageTimer } from './stage-timer';

/** Exigencias con las que se admite un extracto, una por compuerta. */
export interface AdmissionPolicy {
  /** Exigencia sobre el EMISOR. Ver `issuer-gate.ts`. */
  issuer: IssuerGateOptions;
  /** Exigencia sobre el CONTENEDOR. Ver `authenticity/authenticity-gate.ts`. */
  authenticity: AuthenticityGateOptions;
  /** Política de capacidad de pago, con la exigencia de meses dentro. */
  affordability: AffordabilityPolicy;
  /** Exigencia sobre la VIGENCIA. Ver `recency/recency-gate.ts`. */
  recency: RecencyGateOptions;
  /** Umbrales del PARECIDO. Ver `similarity/similarity-scorer.ts`. */
  similarity: SimilarityThresholds;
  /** Qué se hace con el parecido: `OFF`, `MEASURE` o `CORROBORATE`. */
  similarityMode: SimilarityMode;
}

/** Lo que dejó la admisión del contenedor. */
export interface ContainerAdmission {
  authenticity: AuthenticityAssessment;
  similarity: SimilarityAssessment;
  /** El documento quedó en duda por su contenedor y el parecido lo sostuvo. */
  rescatado: boolean;
}

/** Lo que dejó la admisión del periodo. */
export interface PeriodAdmission {
  affordability: AffordabilityAssessment;
  recency: RecencyAssessment;
}

/**
 * Las compuertas que deciden si un extracto se admite: contenedor, emisor y
 * periodo. Cada una lanza el error de negocio que corresponde; la cascada de
 * estrategias no sabe nada de ellas.
 */
export class StatementAdmissionGates {
  private readonly logger = new Logger('BankStatementWorkerService');

  constructor(private readonly policy: AdmissionPolicy) {}

  /**
   * La compuerta del CONTENEDOR va antes que la del emisor y que la del
   * contenido, y ese orden es la mitad del arreglo. Las otras dos se contestan
   * leyendo el texto que el PDF imprime, y ese texto lo escribe quien fabrica
   * el archivo: un documento compuesto en Word con la carátula de un banco
   * copiada las pasa las dos y llega al análisis con una tabla de movimientos
   * que redactó el propio solicitante. «Con qué se produjo este archivo» es la
   * única de las tres preguntas que no se puede responder escribiendo el texto
   * correcto.
   *
   * El PARECIDO se mide aquí, entre evaluar el contenedor y actuar sobre él, y
   * ese hueco es su razón de estar en este punto exacto: necesita la
   * procedencia que la autenticidad acaba de leer —el generador declarado es
   * una de las señales que más cuesta falsificar— y tiene que estar disponible
   * ANTES de que el veredicto del contenedor tire el documento, porque su único
   * efecto es sostener lo que ese veredicto dejó en duda.
   *
   * Se mide siempre, incluso en `OFF`, salvo que no haya descriptor: medir es
   * barato —unas decenas de expresiones regulares sobre texto ya extraído— y es
   * lo que permite responder «¿cuánto rescataríamos?» antes de rescatar nada.
   */
  admitContainer(
    buffer: Buffer,
    extraction: ExtractionOutcome,
    context: StatementContext,
    timer: StageTimer,
    correlation: string,
  ): ContainerAdmission {
    const authenticity = timer.timeSync('autenticidad', () =>
      assessAuthenticity(buffer, textPageRatio(extraction), this.policy.authenticity),
    );
    const similarity = timer.timeSync('parecido', () =>
      assessSimilarity(
        buildDocumentFingerprint(extraction.pdf, authenticity.report.provenance),
        context.institution.signalDescriptor,
        this.policy.similarity,
      ),
    );
    const rescatado =
      this.policy.similarityMode === 'CORROBORATE' &&
      authenticity.disposition === 'REVIEW' &&
      similarity.corroborates;
    if (
      authenticity.disposition === 'REJECT' ||
      (authenticity.disposition !== 'ACCEPT' && !rescatado)
    ) {
      this.logger.warn(authenticityRejectionLog(authenticity, correlation));
      throw authenticityRejection(authenticity);
    }
    if (rescatado) {
      this.logger.log(
        `Sospecha del contenedor sostenida por el parecido: ` +
          `puntaje=${String(authenticity.report.suspicionScore)} ` +
          `${similarityLabel(similarity)}${correlation}`,
      );
    }
    return { authenticity, similarity, rescatado };
  }

  /**
   * La compuerta de emisor va ANTES de la cascada, y esa posición es el
   * arreglo. Estaba —sólo a medias— dentro de `unsupported()`, que únicamente
   * corre cuando NINGUNA estrategia acepta el documento; y el motor generalista
   * acepta cualquier cosa con una tabla de fechas e importes, así que en la
   * práctica el documento ajeno nunca llegaba a esa comprobación: se convertía
   * en movimientos. Preguntar quién lo emitió cuesta una lectura de la
   * carátula que ya está hecha, y ahorra el análisis entero.
   *
   * Cuando el documento además falla la clasificación, quien manda es ella:
   * «no es un estado de cuenta» dice más —y es más accionable para quien lo
   * subió— que «no reconozco a su emisor».
   */
  admitIssuer(context: StatementContext, timer: StageTimer, correlation: string): void {
    const issuer = timer.timeSync('emisor', () =>
      assessIssuer(context.institution, this.policy.issuer),
    );
    if (issuer.disposition === 'ACCEPT') return;
    const classification = classificationFailure(context);
    if (classification) throw classification;
    this.logger.warn(issuerRejectionLog(issuer, correlation));
    throw issuerRejection(context, issuer);
  }

  /**
   * La capacidad de pago se calcula AQUÍ, con la estrategia ya elegida y los
   * movimientos ya extraídos, y su exigencia de meses puede tirar el
   * documento. Ponerla después de la conversión —en un servicio que lea el
   * resultado— la convertiría en un análisis opcional que cualquier consumidor
   * puede saltarse; el mínimo de tres meses es una condición de ADMISIÓN, no
   * un informe.
   *
   * La vigencia se mide sobre la MISMA ventana que la cobertura, y por eso va
   * después: `coverage.to` ya reconcilió lo que promete la carátula con lo que
   * entregan los movimientos. Preguntarle la fecha a la carátula dejaría pasar
   * el extracto que dice llegar hasta agosto y cuyo último apunte es de mayo,
   * que es justo el documento que esta compuerta existe para detener.
   */
  admitPeriod(statement: ParsedStatement, timer: StageTimer, correlation: string): PeriodAdmission {
    const affordability = timer.timeSync('capacidad', () =>
      assessAffordability(toAffordabilityInput(statement), this.policy.affordability),
    );
    if (!affordability.coverage.satisfied && this.policy.affordability.enforceMinimumMonths) {
      this.logger.warn(insufficientPeriodLog(affordability, correlation));
      throw insufficientPeriod(affordability);
    }

    const recency = timer.timeSync('vigencia', () =>
      assessRecency(affordability.coverage.to, this.policy.recency),
    );
    if (recency.disposition !== 'ACCEPT') {
      this.logger.warn(recencyRejectionLog(recency, correlation));
      throw recencyRejection(recency);
    }
    return { affordability, recency };
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

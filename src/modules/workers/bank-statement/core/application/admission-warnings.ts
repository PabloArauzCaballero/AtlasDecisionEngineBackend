import type { AffordabilityAssessment } from '../engine/affordability/affordability-model';
import type { RecencyAssessment } from '../engine/recency/recency-gate';
import { similarityLabel, type SimilarityAssessment } from '../engine/similarity/similarity-scorer';

/**
 * Lo que se admitió CON REPAROS, dicho en la misma lista de advertencias que
 * ya viaja con el resultado.
 *
 * Existe porque bajar una exigencia a advertencia sólo sirve si la advertencia
 * llega a alguien. Con la cobertura mínima apagada y sin esto, un extracto de
 * un mes y uno de seis salían idénticos —los dos «procesados», sin ninguna
 * marca— y la capacidad de pago del primero se leía con la misma confianza que
 * la del segundo. La exigencia dejó de bloquear; no dejó de importar.
 */
export function admissionWarnings(
  affordability: AffordabilityAssessment,
  recency: RecencyAssessment,
  similarity: SimilarityAssessment,
  rescatado: boolean,
): string[] {
  const warnings: string[] = [];
  /*
   * Un documento sostenido por el parecido SIEMPRE lo dice. Es la advertencia
   * más importante de la lista: significa que una compuerta lo había dejado en
   * duda y otra evidencia lo sacó, y quien lea el resultado tiene derecho a
   * saber que ese documento no entró limpio.
   */
  if (rescatado) {
    warnings.push(
      `sospecha-sostenida-por-parecido: el contenedor quedó en duda y el documento ` +
        `coincide al ${String(similarity.score)} % con el patrón medido de ` +
        `${similarity.institutionCode ?? '?'}.`,
    );
  }
  if (similarity.verdict === 'MISMATCH') {
    warnings.push(
      `parecido-bajo: ${similarityLabel(similarity)}. No es motivo de rechazo —puede ser ` +
        'una maqueta nueva o un descriptor incompleto— pero sí de mirarlo.',
    );
  }
  const { coverage } = affordability;
  if (!coverage.satisfied) {
    warnings.push(
      `cobertura-insuficiente: el extracto cubre ${String(coverage.monthsComplete)} mes(es) ` +
        `completo(s) y la política pide ${String(coverage.minimumMonthsRequired)}. ` +
        'La capacidad de pago se calculó igual y es menos fiable: con menos de tres ' +
        'observaciones, un ingreso extraordinario o un gasto puntual desvían la mediana.',
    );
  }
  if (coverage.gapMonths.length > 0) {
    warnings.push(`meses-sin-movimientos: ${coverage.gapMonths.join(', ')}`);
  }
  if (recency.verdict === 'STALE') {
    warnings.push(
      `extracto-no-vigente: cerró hace ${String(recency.ageDays ?? 0)} día(s) ` +
        `(${recency.periodTo ?? '?'}) y la compuerta de vigencia está en medición.`,
    );
  }
  return warnings;
}

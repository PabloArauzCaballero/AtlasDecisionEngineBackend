import { StatementProcessingError } from '../domain/errors';
import type { AffordabilityAssessment } from '../engine/affordability/affordability-model';
import type { AuthenticityAssessment } from '../engine/authenticity/authenticity-gate';
import { tamperingMessage } from '../engine/authenticity/authenticity-gate';
import type { RecencyAssessment } from '../engine/recency/recency-gate';
import { stalenessMessage } from '../engine/recency/recency-gate';

/**
 * Los rechazos de las compuertas de CONTENEDOR y PERIODO: autenticidad,
 * vigencia y cobertura mínima. Funciones puras; quien las llama decide qué
 * dejar en el registro.
 */

/** Línea de registro del rechazo por autenticidad. */
export function authenticityRejectionLog(
  authenticity: AuthenticityAssessment,
  correlation: string,
): string {
  return (
    `Documento rechazado por autenticidad: veredicto=${authenticity.verdict} ` +
    `puntaje=${String(authenticity.report.suspicionScore)} ` +
    `senales=${authenticity.report.signals.map((signal) => signal.code).join('|')}${correlation}`
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
export function authenticityRejection(
  authenticity: AuthenticityAssessment,
): StatementProcessingError {
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

/** Línea de registro del rechazo por vigencia. */
export function recencyRejectionLog(recency: RecencyAssessment, correlation: string): string {
  return (
    `Vigencia del extracto: veredicto=${recency.verdict} ` +
    `cierre=${recency.periodTo ?? '?'} antiguedadDias=${String(recency.ageDays ?? 0)} ` +
    `evaluadoEl=${recency.evaluatedOn} motivos=${recency.reasons.join('|')}${correlation}`
  );
}

/**
 * El error de la VIGENCIA.
 *
 * Dos códigos, porque son dos hechos distintos y dos acciones distintas: el
 * extracto vencido lo arregla quien lo subió descargando el periodo actual; el
 * fechado en el futuro no lo arregla nadie desde fuera, porque probablemente el
 * defecto sea nuestro al leer el orden de día y mes.
 */
export function recencyRejection(recency: RecencyAssessment): StatementProcessingError {
  const evidence = {
    recencyVerdict: recency.verdict,
    periodTo: recency.periodTo,
    ageDays: recency.ageDays,
    evaluatedOn: recency.evaluatedOn,
    recencyReasons: recency.reasons,
  };

  if (recency.verdict === 'STALE') {
    return new StatementProcessingError(
      'STALE_STATEMENT',
      stalenessMessage(recency),
      422,
      evidence,
    );
  }
  if (recency.verdict === 'FUTURE_DATED') {
    return new StatementProcessingError(
      'FUTURE_DATED_STATEMENT',
      stalenessMessage(recency),
      422,
      evidence,
    );
  }
  return new StatementProcessingError(
    'UNDATED_STATEMENT',
    'No pudimos leer las fechas del extracto, así que no podemos comprobar que esté vigente. ' +
      'Una persona lo está revisando.',
    422,
    evidence,
  );
}

/** Línea de registro del periodo insuficiente. */
export function insufficientPeriodLog(
  affordability: AffordabilityAssessment,
  correlation: string,
): string {
  const { coverage } = affordability;
  return (
    `Extracto con periodo insuficiente: completos=${String(coverage.monthsComplete)} ` +
    `exigidos=${String(coverage.minimumMonthsRequired)} ` +
    `ventana=${coverage.from ?? '?'}..${coverage.to ?? '?'}${correlation}`
  );
}

/** El extracto se leyó bien y no alcanza los meses que la política exige. */
export function insufficientPeriod(
  affordability: AffordabilityAssessment,
): StatementProcessingError {
  const { coverage } = affordability;
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

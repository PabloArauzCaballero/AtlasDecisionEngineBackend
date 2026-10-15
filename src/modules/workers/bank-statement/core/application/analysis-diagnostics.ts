import type { ParsedStatement } from '../domain/models';
import { flagAnomalousDescriptions, reconcileRunningBalance } from '../parsers/parser-helpers';

/**
 * Comprobaciones posteriores al análisis, comunes a cualquier estrategia. No
 * detienen la conversión: degradan la confianza de las filas afectadas y
 * dejan constancia, porque un extracto legítimo puede tener asientos que el
 * analizador no itemiza.
 *
 * Devuelve las líneas de registro, en orden; quien llama decide cómo emitirlas.
 */
export function diagnoseAnalysis(
  statement: ParsedStatement,
  strategyId: string,
  correlation: string,
  warnings: readonly string[],
): string[] {
  const lines: string[] = [];
  const origin = `entidad=${statement.metadata.institutionCode} estrategia=${strategyId}`;

  const balanceMismatches = reconcileRunningBalance(statement.transactions);
  if (balanceMismatches > 0) {
    lines.push(
      `Continuidad de saldo inconsistente: ${origin} ` +
        `inconsistencias=${balanceMismatches}${correlation}`,
    );
  }

  const anomalousDescriptions = flagAnomalousDescriptions(statement.transactions);
  if (anomalousDescriptions > 0) {
    // Señal de que el analizador absorbió texto ajeno: una fila cuya glosa
    // se aparta del patrón del propio extracto. Ver flagAnomalousDescriptions.
    lines.push(`Descripciones atípicas: ${origin} filas=${anomalousDescriptions}${correlation}`);
  }

  for (const warning of warnings) {
    lines.push(`Advertencia de análisis: ${origin} ${warning}${correlation}`);
  }
  return lines;
}

import type { ParsedStatement } from '../../domain/models';
import { reconcileRunningBalance } from '../../parsers/parser-helpers';

export type IssueSeverity = 'WARNING' | 'ERROR';

export interface ValidationIssue {
  readonly code: string;
  readonly severity: IssueSeverity;
  readonly detail: string;
}

export interface ValidationReport {
  readonly issues: readonly ValidationIssue[];
  /** Comprobaciones que se pudieron ejecutar con los datos disponibles. */
  readonly checksRun: number;
  readonly checksPassed: number;
  readonly reconciliationConfidence: number;
}

export interface PrintedTotals {
  readonly debit?: string;
  readonly credit?: string;
}

/**
 * Tolerancia de redondeo, en centavos de la moneda del extracto.
 *
 * Un céntimo cubre el redondeo de un importe con más decimales de los que el
 * banco imprime. Más margen empezaría a tapar errores de lectura de columna,
 * que es justo lo que estas comprobaciones existen para descubrir.
 */
const TOLERANCE = 0.01;

/**
 * Comprueba el extracto **contra sí mismo y contra lo que el banco imprimió**.
 *
 * Cada comprobación solo se ejecuta si hay datos para ella, y se cuenta cuántas
 * corrieron: una conciliación que no se pudo hacer no puede contar como
 * aprobada. Es lo que evita que un extracto sin saldos publicados parezca tan
 * verificado como uno que cuadra al céntimo.
 */
export function validateStatement(
  statement: ParsedStatement,
  totals: PrintedTotals = {},
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const { metadata, transactions } = statement;
  let checksRun = 0;
  let checksPassed = 0;

  const check = (ran: boolean, passed: boolean, issue: () => ValidationIssue): void => {
    if (!ran) return;
    checksRun += 1;
    if (passed) {
      checksPassed += 1;
      return;
    }
    issues.push(issue());
  };

  // 1. Continuidad del saldo entre movimientos consecutivos.
  const withBalance = transactions.filter((item) => item.balance).length;
  const mismatches = reconcileRunningBalance(transactions);
  check(withBalance >= 2, mismatches === 0, () => ({
    code: 'continuidad-de-saldo',
    severity: 'WARNING',
    detail: `${mismatches} movimientos no encadenan con el saldo anterior`,
  }));

  // 2. Cuadre contra los saldos que publica el banco.
  const opening = Number(metadata.openingBalance);
  const closing = Number(metadata.closingBalance);
  const sum = transactions.reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const balancesPublished =
    Boolean(metadata.openingBalance) &&
    Boolean(metadata.closingBalance) &&
    Number.isFinite(opening) &&
    Number.isFinite(closing);
  const drift = Number((sum - (closing - opening)).toFixed(2));
  check(balancesPublished, Math.abs(drift) <= TOLERANCE, () => ({
    code: 'cuadre-de-saldos',
    severity: 'ERROR',
    detail: `la suma de importes se aparta ${drift.toFixed(2)} de la variación entre saldos`,
  }));

  // 3. Totales impresos frente a la suma de lo extraído.
  for (const [field, printed] of [
    ['debit', totals.debit],
    ['credit', totals.credit],
  ] as const) {
    const declared = Number(printed);
    const extracted = transactions.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    const difference = Number((extracted - declared).toFixed(2));
    check(Boolean(printed) && Number.isFinite(declared), Math.abs(difference) <= TOLERANCE, () => ({
      code: `total-${field === 'debit' ? 'debitos' : 'creditos'}`,
      severity: 'ERROR',
      detail: `la suma extraída se aparta ${difference.toFixed(2)} del total impreso`,
    }));
  }

  // 4. Todas las filas llevan fecha válida.
  const withoutDate = transactions.filter(
    (item) => !/^\d{4}-\d{2}-\d{2}$/.test(item.transactionDate),
  ).length;
  check(transactions.length > 0, withoutDate === 0, () => ({
    code: 'fechas-validas',
    severity: 'ERROR',
    detail: `${withoutDate} movimientos sin fecha legible`,
  }));

  // 5. Las fechas caen dentro del período declarado.
  const outsidePeriod = transactions.filter(
    (item) =>
      item.transactionDate &&
      (item.transactionDate < metadata.periodStart || item.transactionDate > metadata.periodEnd),
  ).length;
  check(Boolean(metadata.periodStart && metadata.periodEnd), outsidePeriod === 0, () => ({
    code: 'fechas-en-el-periodo',
    severity: 'WARNING',
    detail: `${outsidePeriod} movimientos fuera de ${metadata.periodStart}..${metadata.periodEnd}`,
  }));

  // 6. Las fechas avanzan en un solo sentido. Un extracto puede imprimirse del
  // más reciente al más antiguo, pero no alternar: alternar delata filas
  // desordenadas por una lectura equivocada.
  const dates = transactions.map((item) => item.transactionDate).filter(Boolean);
  const ascending = dates.every((date, index) => index === 0 || date >= (dates[index - 1] ?? date));
  const descending = dates.every(
    (date, index) => index === 0 || date <= (dates[index - 1] ?? date),
  );
  check(dates.length >= 2, ascending || descending, () => ({
    code: 'orden-cronologico',
    severity: 'WARNING',
    detail: 'las fechas no avanzan en un solo sentido',
  }));

  // 7. Toda fila tiene importe legible.
  const withoutAmount = transactions.filter((item) => !item.amount).length;
  check(transactions.length > 0, withoutAmount === 0, () => ({
    code: 'importes-legibles',
    severity: 'ERROR',
    detail: `${withoutAmount} movimientos sin importe`,
  }));

  return {
    issues,
    checksRun,
    checksPassed,
    reconciliationConfidence: checksRun === 0 ? 0 : Number((checksPassed / checksRun).toFixed(2)),
  };
}

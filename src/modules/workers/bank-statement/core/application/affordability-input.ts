import type { ParsedStatement } from '../domain/models';
import type { AffordabilityInput } from '../engine/affordability/affordability-engine';

/**
 * Reduce el extracto interno a lo que la capacidad de pago necesita.
 *
 * Los importes pasan de cadena a número aquí y sólo aquí para este consumidor.
 * El núcleo sigue trabajando con cadenas exactas por [ADR-0006]; la evaluación
 * necesita aritmética, y hacer la conversión en el borde deja claro dónde se
 * pierde la exactitud decimal en vez de repartirlo por el módulo.
 */
export function toAffordabilityInput(statement: ParsedStatement): AffordabilityInput {
  return {
    transactions: statement.transactions.map((transaction) => ({
      date: normalizeDate(transaction.transactionDate),
      description: transaction.description,
      debit: toNumberOrNull(transaction.debit),
      credit: toNumberOrNull(transaction.credit),
      balance: toNumberOrNull(transaction.balance),
    })),
    periodFrom: normalizeDate(statement.metadata.periodStart),
    periodTo: normalizeDate(statement.metadata.periodEnd),
    currency:
      statement.metadata.accountCurrency === 'UNKNOWN' ? null : statement.metadata.accountCurrency,
    closingBalance: toNumberOrNull(statement.metadata.closingBalance),
    // Con el emisor resuelto, las glosas se leen contra el glosario que ese
    // emisor publica. Sin él —`UNKNOWN`— se sigue con el léxico de siempre.
    issuerCode:
      statement.metadata.institutionCode && statement.metadata.institutionCode !== 'UNKNOWN'
        ? statement.metadata.institutionCode
        : null,
  };
}

/** `AAAA-MM-DD`, o `null`. El núcleo ya normaliza las fechas; esto es la red. */
function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const local = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(value.trim());
  if (local) return `${local[3]}-${local[2]}-${local[1]}`;
  return null;
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

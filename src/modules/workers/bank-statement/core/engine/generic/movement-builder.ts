import type { BankTransaction } from '../../domain/models';
import { assignToColumns, columnText, type DetectedColumn } from './column-detector';
import { findDate, type DateInterpretation } from './date-reader';
import { parseAmount, type NumberFormat } from './number-format';
import type { AssembledRow } from './row-assembler';

export interface MovementRules {
  readonly columns: readonly DetectedColumn[];
  readonly numberFormat: NumberFormat;
  readonly dateInterpretation: DateInterpretation;
}

export interface BuiltMovement {
  readonly transaction: BankTransaction;
  readonly warnings: readonly string[];
  /** Cómo se determinó el signo. Viaja a la traza y a la confianza de la fila. */
  readonly signSource: SignSource;
}

export type SignSource =
  | 'COLUMNAS_SEPARADAS'
  | 'SIGNO_EXPLICITO'
  | 'INDICADOR_DC'
  | 'COLUMNA_TIPO'
  | 'GLOSA'
  | 'SALDO'
  | 'SIN_DETERMINAR';

/**
 * Palabras con las que las glosas nombran la dirección del movimiento. Es el
 * último recurso y el único que no se apoya en una cifra, así que su uso baja la
 * confianza de la fila y deja advertencia.
 */
const CREDIT_WORDS =
  /\b(?:abono|dep[oó]sito|credito|cr[eé]dito|ingreso|recib|transferencia\s+recibida|n\/c|deposit|credit)/i;
const DEBIT_WORDS =
  /\b(?:cargo|retiro|d[eé]bito|debito|pago|compra|egreso|comisi[oó]n|n\/d|withdrawal|debit|purchase)/i;

/**
 * Construye un movimiento a partir de una fila ya ensamblada.
 *
 * La parte difícil es el signo. Los extractos lo expresan de seis maneras
 * distintas y ninguna está garantizada, así que se resuelve por **cascada de
 * evidencia**: primero lo que el banco publica sin ambigüedad, y solo al final
 * lo que hay que interpretar.
 */
export function buildMovement(row: AssembledRow, rules: MovementRules): BuiltMovement | undefined {
  const { columns, numberFormat, dateInterpretation } = rules;
  const anchorCells = assignToColumns(row.anchor, columns);
  const dateText = columnText(anchorCells, columns, 'transactionDate');
  const date = findDate(dateText, dateInterpretation);
  if (!date.iso) return undefined;

  const warnings: string[] = [];
  if (date.inferredYear) warnings.push('ano-inferido-del-periodo');

  const description = row.lines
    .map((line) => columnText(assignToColumns(line, columns), columns, 'description'))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const debitCell = parseAmount(columnText(anchorCells, columns, 'debit'), numberFormat);
  const creditCell = parseAmount(columnText(anchorCells, columns, 'credit'), numberFormat);
  const amountCell = parseAmount(columnText(anchorCells, columns, 'amount'), numberFormat);
  const balanceCell = parseAmount(columnText(anchorCells, columns, 'balance'), numberFormat);

  const signed = resolveSign({
    debit: debitCell.value,
    credit: creditCell.value,
    amount: amountCell,
    movementType: columnText(anchorCells, columns, 'movementType'),
    description,
  });
  if (signed === undefined) return undefined;

  if (signed.source === 'GLOSA') {
    warnings.push('signo-deducido-de-la-glosa');
  }
  if (signed.source === 'SIN_DETERMINAR') {
    warnings.push('signo-no-determinado');
  }

  const amount = signed.amount;
  const numeric = Number(amount);
  const time =
    columnText(anchorCells, columns, 'time') ||
    dateText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ||
    '';

  return {
    transaction: {
      transactionDate: date.iso,
      transactionTime: time,
      transactionId:
        columnText(anchorCells, columns, 'documentNumber') ||
        columnText(anchorCells, columns, 'reference'),
      description,
      channel: columnText(anchorCells, columns, 'channel'),
      location: columnText(anchorCells, columns, 'branch'),
      debit: numeric < 0 ? Math.abs(numeric).toFixed(2) : '',
      credit: numeric > 0 ? numeric.toFixed(2) : '',
      amount,
      balance: balanceCell.value,
      sourcePage: row.anchor.page,
      extractionConfidence: '',
      rawText: row.lines.map((line) => line.text).join(' · '),
    },
    warnings,
    signSource: signed.source,
  };
}

interface SignInput {
  readonly debit: string;
  readonly credit: string;
  readonly amount: ReturnType<typeof parseAmount>;
  readonly movementType: string;
  readonly description: string;
}

function resolveSign(input: SignInput): { amount: string; source: SignSource } | undefined {
  // 1. Columnas separadas: el banco ya dijo de qué lado va cada cifra.
  if (input.debit || input.credit) {
    const debit = Math.abs(Number(input.debit || '0'));
    const credit = Math.abs(Number(input.credit || '0'));
    if (debit === 0 && credit === 0) {
      return { amount: '0.00', source: 'COLUMNAS_SEPARADAS' };
    }
    return {
      amount: (credit - debit).toFixed(2),
      source: 'COLUMNAS_SEPARADAS',
    };
  }

  if (!input.amount.value) return undefined;
  const value = Number(input.amount.value);

  // 2. La propia ficha traía signo, paréntesis o sufijo DB/CR.
  if (value < 0) return { amount: value.toFixed(2), source: 'SIGNO_EXPLICITO' };
  if (input.amount.indicator) {
    const signed = input.amount.indicator === 'DEBIT' ? -value : value;
    return { amount: signed.toFixed(2), source: 'INDICADOR_DC' };
  }

  // 3. Columna de tipo de movimiento.
  const type = input.movementType.trim().toUpperCase();
  if (/^(?:D|DB|DEB|DEBITO|CARGO)$/.test(type)) {
    return { amount: (-value).toFixed(2), source: 'COLUMNA_TIPO' };
  }
  if (/^(?:C|CR|CRE|CREDITO|ABONO|H)$/.test(type)) {
    return { amount: value.toFixed(2), source: 'COLUMNA_TIPO' };
  }

  // 4. La glosa. Se usa solo si nombra la dirección sin ambigüedad.
  const saysCredit = CREDIT_WORDS.test(input.description);
  const saysDebit = DEBIT_WORDS.test(input.description);
  if (saysDebit && !saysCredit) {
    return { amount: (-value).toFixed(2), source: 'GLOSA' };
  }
  if (saysCredit && !saysDebit) {
    return { amount: value.toFixed(2), source: 'GLOSA' };
  }

  // 5. Sin evidencia: se emite en positivo y se advierte. La corrección por
  // continuidad de saldo, si el extracto publica saldo, ocurre después.
  return { amount: value.toFixed(2), source: 'SIN_DETERMINAR' };
}

/**
 * Corrige el signo de los movimientos cuyo origen fue débil, usando la
 * continuidad del saldo publicado por el banco.
 *
 * Es la única señal que no depende de cómo esté redactado el documento: si el
 * saldo baja, el movimiento fue un cargo, diga lo que diga la glosa. Solo actúa
 * donde la evidencia previa era débil —glosa o nada—, para no contradecir a un
 * banco que sí publicó columnas separadas o un signo explícito.
 *
 * @returns cuántas filas se corrigieron.
 */
export function correctSignsWithBalance(movements: BuiltMovement[]): number {
  let corrected = 0;
  for (let index = 1; index < movements.length; index += 1) {
    const previous = movements[index - 1];
    const current = movements[index];
    if (!previous || !current) continue;
    if (current.signSource !== 'GLOSA' && current.signSource !== 'SIN_DETERMINAR') {
      continue;
    }
    const previousBalance = Number(previous.transaction.balance);
    const currentBalance = Number(current.transaction.balance);
    const amount = Number(current.transaction.amount);
    if (
      !previous.transaction.balance ||
      !current.transaction.balance ||
      !Number.isFinite(previousBalance) ||
      !Number.isFinite(currentBalance) ||
      !Number.isFinite(amount)
    ) {
      continue;
    }

    const delta = Number((currentBalance - previousBalance).toFixed(2));
    if (Math.abs(Math.abs(delta) - Math.abs(amount)) > 0.01) continue;
    if (Math.abs(delta - amount) <= 0.01) continue;

    const fixed = delta.toFixed(2);
    movements[index] = {
      ...current,
      transaction: {
        ...current.transaction,
        amount: fixed,
        debit: delta < 0 ? Math.abs(delta).toFixed(2) : '',
        credit: delta > 0 ? delta.toFixed(2) : '',
      },
      signSource: 'SALDO',
      warnings: [...current.warnings, 'signo-corregido-por-continuidad-de-saldo'],
    };
    corrected += 1;
  }
  return corrected;
}

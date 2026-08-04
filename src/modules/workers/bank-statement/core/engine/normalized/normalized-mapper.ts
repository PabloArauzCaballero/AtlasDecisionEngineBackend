import type { BankTransaction } from '../../domain/models';
import type { StatementAnalysis } from '../statement-analysis';
import { newTransactionId } from './transaction-descriptions';
import { UNKNOWN_INSTITUTION_CODE } from '../statement-context';
import type {
  MovementType,
  NormalizedBankStatement,
  NormalizedTransaction,
} from './normalized-model';

/** Dígitos que quedan visibles al enmascarar una cuenta. */
const VISIBLE_DIGITS = 4;

/**
 * Proyecta el resultado interno al contrato normalizado.
 *
 * Es el único punto donde los importes pasan de cadena a número y donde las
 * ausencias pasan de cadena vacía a `null`. Concentrarlo aquí es lo que permite
 * que el núcleo siga trabajando con cadenas exactas —sin coma flotante— y que
 * el consumidor reciba tipos con los que pueda operar.
 */
export function toNormalizedStatement(analysis: StatementAnalysis): NormalizedBankStatement {
  const { statement, context, strategy, detection, quality, validation } = analysis;
  const { metadata } = statement;

  return {
    source: {
      fileName: blankToNull(context.source.fileName),
      fileHash: context.source.fileHash,
      pageCount: context.source.pageCount,
      extractionMethod: context.source.extractionMethod,
    },
    institution: {
      id:
        metadata.institutionCode === UNKNOWN_INSTITUTION_CODE
          ? null
          : blankToNull(metadata.institutionCode),
      name: blankToNull(metadata.institutionName),
      normalizedName: normalizeName(metadata.institutionName),
      // Este módulo solo registra entidades bolivianas; para una no
      // identificada, el país es tan desconocido como la entidad.
      country: context.institution.detected ? 'BO' : null,
      detected: context.institution.detected,
      confidence: context.institution.confidence,
    },
    account: {
      holderName: blankToNull(metadata.accountHolder),
      accountNumberMasked: maskAccountNumber(metadata.accountNumber),
      accountType: blankToNull(analysis.accountType),
      currency: metadata.accountCurrency === 'UNKNOWN' ? null : metadata.accountCurrency,
      allAccountsMasked:
        analysis.accounts.length > 1
          ? analysis.accounts
              .map((account) => maskAccountNumber(account))
              .filter((account): account is string => account !== null)
          : [],
    },
    period: {
      from: blankToNull(metadata.periodStart),
      to: blankToNull(metadata.periodEnd),
    },
    balances: {
      opening: toNumber(metadata.openingBalance),
      closing: toNumber(metadata.closingBalance),
    },
    totals: {
      debit: toNumber(analysis.printedTotals.debit),
      credit: toNumber(analysis.printedTotals.credit),
    },
    processing: {
      documentType: context.classification.documentType,
      strategyId: strategy.id,
      strategyKind: strategy.kind,
      strategyVersion: strategy.version,
      detectionReasons: detection.reasons,
      durationMs: analysis.durationMs,
    },
    transactions: statement.transactions.map((transaction, index) =>
      toNormalizedTransaction(transaction, index, context.source.fileHash),
    ),
    quality: {
      documentConfidence: quality.documentConfidence,
      institutionConfidence: quality.institutionConfidence,
      structureConfidence: quality.structureConfidence,
      reconciliationConfidence: quality.reconciliationConfidence,
      overallConfidence: quality.overallConfidence,
      band: quality.band,
      checksRun: validation.checksRun,
      checksPassed: validation.checksPassed,
      warnings: [
        ...analysis.warnings,
        ...validation.issues
          .filter((issue) => issue.severity === 'WARNING')
          .map((issue) => `${issue.code}: ${issue.detail}`),
      ],
      errors: validation.issues
        .filter((issue) => issue.severity === 'ERROR')
        .map((issue) => `${issue.code}: ${issue.detail}`),
    },
  };
}

function toNormalizedTransaction(
  transaction: BankTransaction,
  index: number,
  fileHash: string,
): NormalizedTransaction {
  const amount = toNumber(transaction.amount) ?? 0;
  const movementType: MovementType = amount < 0 ? 'DEBIT' : amount > 0 ? 'CREDIT' : 'UNKNOWN';

  return {
    id: newTransactionId(fileHash, index, transaction),
    index,
    transactionDate: blankToNull(transaction.transactionDate),
    // Ningún formato medido publica fecha valor aparte; se declara para que el
    // contrato no cambie el día que aparezca.
    valueDate: null,
    description: transaction.description,
    reference: blankToNull(transaction.transactionId),
    documentNumber: null,
    debit: toNumber(transaction.debit),
    credit: toNumber(transaction.credit),
    amount,
    balance: toNumber(transaction.balance),
    currency: null,
    movementType,
    channel: blankToNull(transaction.channel),
    branch: blankToNull(transaction.location),
    rawText: blankToNull(transaction.rawText),
    sourcePage: transaction.sourcePage,
    confidence: Number(transaction.extractionConfidence) || 0,
    warnings: transaction.warnings ?? [],
    accountMasked: transaction.account ? maskAccountNumber(transaction.account) : null,
  };
}

/**
 * Deja visibles los últimos dígitos y nada más. Un número de cuenta completo en
 * una respuesta o en un registro es un dato que ya no se puede retirar.
 */
export function maskAccountNumber(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length <= VISIBLE_DIGITS) return '*'.repeat(digits.length);
  return `${'*'.repeat(digits.length - VISIBLE_DIGITS)}${digits.slice(-VISIBLE_DIGITS)}`;
}

function normalizeName(value: string): string | null {
  if (!value.trim()) return null;
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

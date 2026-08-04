import { stringify } from 'csv-stringify/sync';
import type { NormalizedBankStatement } from './core/engine/normalized/normalized-model';
import type { StatementDownloadFormat } from '../workers.dto';

/**
 * Serializa el resultado de una conversión para descargarlo.
 *
 * Se escribe sobre el **contrato normalizado**, no sobre el interno. El paquete
 * original traía serializadores de CSV y JSON que trabajaban sobre
 * `ParsedStatement` y publicaban `account_number` con el número de cuenta
 * COMPLETO; el contrato normalizado sólo expone `accountNumberMasked`.
 *
 * Como aquí sólo se persiste el contrato normalizado —el PDF se borra al
 * terminar—, aquellos serializadores no tenían de dónde leer y quedaron
 * huérfanos al descartar los controladores del paquete. Se eliminaron en vez de
 * conservarse: código muerto capaz de publicar un número de cuenta es una
 * responsabilidad, no un activo.
 */

export interface StatementDownload {
  readonly body: Buffer;
  readonly contentType: string;
  readonly fileName: string;
}

/** Columnas del CSV. Fijas y en este orden: es un contrato para quien lo consuma. */
const CSV_COLUMNS = [
  'indice',
  'fecha',
  'fecha_valor',
  'descripcion',
  'referencia',
  'tipo',
  'debito',
  'credito',
  'importe',
  'saldo',
  'moneda',
  'cuenta_enmascarada',
] as const;

/**
 * Neutraliza la inyección de fórmulas en hojas de cálculo.
 *
 * Excel y sus equivalentes interpretan como fórmula toda celda que empiece por
 * `=`, `+`, `-` o `@`. Una glosa bancaria es texto que escribió un tercero, así
 * que puede empezar por cualquiera de esos caracteres —a propósito o no—, y al
 * abrir el CSV descargado se ejecutaría. El apóstrofo inicial fuerza a tratarla
 * como texto. También se quitan los bytes nulos, que truncan la celda.
 */
function safeCell(value: string | null): string {
  if (value === null) return '';
  const clean = value.split('\0').join('').trim();
  return /^[=+@-]/.test(clean) ? `'${clean}` : clean;
}

function toCsv(statement: NormalizedBankStatement): Buffer {
  const rows = statement.transactions.map((transaction) => ({
    indice: transaction.index,
    fecha: transaction.transactionDate ?? '',
    fecha_valor: transaction.valueDate ?? '',
    descripcion: safeCell(transaction.description),
    referencia: safeCell(transaction.reference),
    tipo: transaction.movementType,
    debito: transaction.debit ?? '',
    credito: transaction.credit ?? '',
    importe: transaction.amount,
    saldo: transaction.balance ?? '',
    moneda: transaction.currency ?? statement.account.currency ?? '',
    cuenta_enmascarada: transaction.accountMasked ?? statement.account.accountNumberMasked ?? '',
  }));
  return Buffer.from(
    stringify(rows, { header: true, columns: [...CSV_COLUMNS], bom: true }),
    'utf8',
  );
}

/**
 * `bom: true` en el CSV no es decoración: sin la marca de orden de bytes, Excel
 * en Windows lee el archivo como ANSI y toda glosa con tilde sale rota. El
 * destinatario típico de este archivo es exactamente esa combinación.
 */
export function serializeStatement(
  statement: NormalizedBankStatement,
  format: StatementDownloadFormat,
  baseName: string,
): StatementDownload {
  const stem = baseName.replace(/\.pdf$/i, '') || 'extracto';

  if (format === 'csv') {
    return {
      body: toCsv(statement),
      contentType: 'text/csv; charset=utf-8',
      fileName: `${stem}.csv`,
    };
  }

  if (format === 'json') {
    // Sólo los movimientos, para quien quiere cargarlos en una hoja o en una
    // tabla sin arrastrar el resto del contrato.
    return {
      body: Buffer.from(JSON.stringify(statement.transactions, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
      fileName: `${stem}-movimientos.json`,
    };
  }

  return {
    body: Buffer.from(JSON.stringify(statement, null, 2), 'utf8'),
    contentType: 'application/json; charset=utf-8',
    fileName: `${stem}-normalizado.json`,
  };
}

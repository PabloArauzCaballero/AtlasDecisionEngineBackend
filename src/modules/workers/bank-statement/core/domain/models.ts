export type CurrencyCode = 'BOB' | 'USD' | 'UNKNOWN';

export interface StatementMetadata {
  institutionCode: string;
  institutionName: string;
  accountNumber: string;
  accountCurrency: CurrencyCode;
  accountHolder: string;
  periodStart: string;
  periodEnd: string;
  /**
   * Saldo con el que abre el período, **tal como lo imprime el banco**.
   *
   * Es deliberadamente el valor impreso y no uno derivado de los movimientos:
   * derivarlo produciría una comprobación que nunca puede fallar. Con el valor
   * del banco, un consumidor puede exigir que
   * `suma(montos) === closingBalance - openingBalance` y detectar así un
   * movimiento perdido o una columna mal leída.
   *
   * Cadena vacía cuando el formato no lo imprime.
   */
  openingBalance: string;
  /** Saldo de cierre impreso por el banco, o cadena vacía. Ver `openingBalance`. */
  closingBalance: string;
}

export interface BankTransaction {
  transactionDate: string;
  transactionTime: string;
  transactionId: string;
  description: string;
  channel: string;
  location: string;
  debit: string;
  credit: string;
  amount: string;
  balance: string;
  sourcePage: number;
  extractionConfidence: string;
  /**
   * Texto del renglón tal como se leyó del PDF. Lo publica el motor generalista,
   * donde permite auditar una lectura inferida; los analizadores especializados,
   * cuya plantilla está medida contra un extracto real, lo omiten.
   */
  rawText?: string;
  /** Señales de por qué esta fila vale menos que sus vecinas. */
  warnings?: readonly string[];
  /**
   * Cuenta a la que pertenece el movimiento. Solo se emite en documentos que
   * publican **varias**: con una sola, repetirla en cada fila sería ruido.
   */
  account?: string;
}

export interface ParsedStatement {
  metadata: StatementMetadata;
  transactions: BankTransaction[];
}

export interface TextToken {
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface PageLine {
  page: number;
  pageWidth: number;
  y: number;
  tokens: TextToken[];
  text: string;
}

export interface ExtractedPdf {
  pageCount: number;
  lines: PageLine[];
  text: string;
}

import { DEFAULT_TRIAGE_THRESHOLDS } from '../document-triage';

/**
 * Señal de que un documento es —o no es— un estado de cuenta.
 *
 * Cada una aporta un peso fijo y **justificado por lo que demuestra**, no un
 * porcentaje elegido a ojo: un título financiero identifica el documento por sí
 * solo, mientras que un rótulo suelto como «Saldo» aparece también en un
 * comprobante individual y por eso pesa un tercio.
 */
interface ClassificationSignal {
  readonly id: string;
  readonly weight: number;
  readonly matches: (evidence: DocumentEvidence) => boolean;
}

export interface DocumentEvidence {
  readonly text: string;
  /**
   * Encabezado: donde un documento DICE lo que es.
   *
   * Se separa del cuerpo porque las dos preguntas son distintas. «¿De qué habla
   * este documento?» se responde con el texto entero; «¿qué dice ser?» sólo con
   * su cabecera, y confundirlas es lo que hacía que un extracto de sesenta
   * páginas se rechazara por llevar la palabra «contrato» en la glosa de una
   * cuota de hipoteca.
   */
  readonly header: string;
  readonly dateRows: number;
  readonly amountRows: number;
}

/** Tipos de documento que el motor sabe nombrar, por su título. */
export const DOCUMENT_TYPES: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  {
    type: 'BANK_STATEMENT',
    pattern: /extracto\s+(?:de\s+)?(?:cuenta|caja|movimiento|ahorro)/i,
  },
  {
    type: 'ACCOUNT_STATEMENT',
    pattern: /estado\s+de\s+cuenta|resumen\s+de\s+cuenta|account\s+statement/i,
  },
  {
    type: 'TRANSACTION_HISTORY',
    pattern:
      /(?:historial|reporte)\s+de\s+(?:movimiento|transaccion)|transaction\s+(?:history|report)/i,
  },
  // Solo la tarjeta: «resumen de cuenta» es un estado de cuenta, y confundirlos
  // etiquetaba como resumen de tarjeta el extracto real del Banco Nacional.
  {
    type: 'CARD_SUMMARY',
    pattern: /resumen\s+de\s+tarjeta|estado\s+de\s+tarjeta/i,
  },
  {
    type: 'BANK_STATEMENT',
    pattern: /extracto\s+de\s+movimientos|extracto\s+bancario/i,
  },
];

/**
 * Títulos de documentos que NO son extractos, y que aun así conviene nombrar.
 *
 * Viven en su propia lista y no en `DOCUMENT_TYPES` por un motivo concreto: esa
 * otra lista alimenta una SEÑAL POSITIVA del clasificador —«el documento se
 * titula como un estado de cuenta»— y meter aquí una boleta de pago le regalaría
 * peso a un documento que no es un extracto. Se reconocen para poder explicar,
 * no para puntuar.
 *
 * Antes caían todos en `UNKNOWN_DOCUMENT` y recibían la misma frase —«no reúne
 * señales suficientes de ser un estado de cuenta»—, que es verdadera y no dice
 * qué hacer. Con el tipo reconocido, `document-routes.ts` puede decir que a un
 * comprobante le falta el periodo, que un certificado de saldo es una foto y no
 * una historia, y que un resumen de tarjeta describe deuda y no ingreso.
 */
export const OTHER_DOCUMENT_TYPES: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  {
    type: 'TRANSFER_RECEIPT',
    pattern:
      /comprobante\s+de\s+(?:transferencia|pago|dep[oó]sito|env[ií]o)|constancia\s+de\s+transferencia/i,
  },
  {
    type: 'BALANCE_CERTIFICATE',
    pattern: /certificad[oa]\s+de\s+(?:saldo|cuenta|dep[oó]sito)/i,
  },
  {
    type: 'PAYSLIP',
    pattern: /boleta\s+de\s+pago|recibo\s+de\s+(?:sueldo|haberes)|papeleta\s+de\s+pago/i,
  },
  {
    type: 'WALLET_STATEMENT',
    pattern: /billetera\s+m[oó]vil|\bTIGO\s*MONEY\b|\bE-?\s?FECTIVO\b/i,
  },
];

/** Documentos que se parecen a un extracto pero no lo son. */
export const COUNTER_INDICATORS =
  /\bfactura\b|\binvoice\b|nota\s+fiscal|\bcontrato\b|\bcertificad[oa]\b|\bp[oó]liza\b|\bcurr[ií]culum\b|informe\s+de\s+laboratorio|\brecibo\s+de\s+(?:sueldo|haberes)\b|\bcotizaci[oó]n\b|\bpresupuesto\b|\borden\s+de\s+compra\b|\bnota\s+de\s+remisi[oó]n\b|\bdeclaraci[oó]n\s+jurada\b|\bplan\s+de\s+(?:pagos|amortizaci[oó]n)\b|\bkardex\b/i;

/**
 * Lo que un extracto bancario NO lleva jamás, y por tanto cierra la pregunta.
 *
 * La penalización de 0.35 es una opinión sobre cuánta evidencia resta un rótulo
 * ambiguo, y para el documento ambiguo está bien calibrada. Pero hay documentos
 * que no son ambiguos en absoluto y aun así superaban el umbral, porque suman
 * todas las señales legítimas a la vez: **la factura boliviana** —que imprime
 * «Estado de Cuenta» del cliente, número de cuenta, saldo, columna de importes y
 * una tabla de consumos fechados— alcanza 1.00 sobre 1.00 y se quedaba en 0.65
 * después de restar. Se procesaba.
 *
 * Lo que hay aquí no son palabras que «suenan» a otra cosa: son marcas que sólo
 * existen en ese otro documento. El código de control y el número de
 * autorización los pone el SIN en cada factura; la leyenda de la Ley 453 la
 * imprime la propia factura; una cláusula numerada o un testimonio notarial sólo
 * están en un contrato. Ningún banco los imprime en un extracto, así que
 * encontrarlos en la carátula no es evidencia en contra: es la respuesta.
 */
export const DECISIVE_COUNTER_INDICATORS: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  {
    type: 'TAX_INVOICE',
    pattern:
      /C[OÓ]DIGO\s+DE\s+CONTROL|N[UÚ]MERO\s+DE\s+AUTORIZACI[OÓ]N|ESTA\s+FACTURA\s+CONTRIBUYE|FACTURA\s+(?:ELECTR[OÓ]NICA|COMPUTARIZADA)|LEY\s+N[°º.]?\s*453/i,
  },
  {
    type: 'CONTRACT',
    pattern:
      /CL[AÁ]USULA\s+(?:PRIMERA|SEGUNDA|TERCERA)|TESTIMONIO\s+N[°º]|MINUTA\s+DE\s+(?:COMPRA|VENTA|PR[EÉ]STAMO|CONTRATO)/i,
  },
  { type: 'RESUME', pattern: /HOJA\s+DE\s+VIDA|CURR[IÍ]CULUM\s+VITAE/i },
  {
    type: 'PAYROLL_SLIP',
    pattern: /BOLETA\s+DE\s+PAGO|PLANILLA\s+DE\s+(?:SUELDOS|HABERES)|APORTES\s+PATRONALES/i,
  },
];

export const AMOUNT = /(?<![\d.,])-?(?:Bs|\$us|USD)?\s?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b/;
export const DATE =
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|\b\d{1,2}\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4}\b/;

/**
 * Mínimo de filas con fecha y con importe para hablar de una tabla de
 * movimientos. Con dos filas no hay tabla que valga: el extracto real más
 * pequeño medido tiene dos movimientos, así que el umbral se fija en dos y la
 * decisión final la toma la suma de señales, no este número.
 */
const MINIMUM_TABLE_ROWS = 2;

export const SIGNALS: readonly ClassificationSignal[] = [
  {
    id: 'titulo-financiero',
    weight: 0.3,
    matches: (evidence) =>
      DOCUMENT_TYPES.some((candidate) => candidate.pattern.test(evidence.text)),
  },
  {
    id: 'rotulo-de-cuenta',
    weight: 0.1,
    matches: (evidence) =>
      /\bcuenta\b|\bn[uú]mero\s+de\s+cuenta\b|\baccount\s+number\b|\bIBAN\b/i.test(evidence.text),
  },
  {
    id: 'rotulo-de-saldo',
    weight: 0.1,
    matches: (evidence) => /\bsaldo\b|\bbalance\b/i.test(evidence.text),
  },
  {
    id: 'columna-de-importe',
    weight: 0.1,
    matches: (evidence) =>
      /\bmonto\b|\bimporte\b|\bd[eé]bito[s]?\b|\bcr[eé]dito[s]?\b|\bdebit\b|\bcredit\b|\bamount\b/i.test(
        evidence.text,
      ),
  },
  {
    id: 'filas-con-fecha',
    weight: 0.2,
    matches: (evidence) => evidence.dateRows >= MINIMUM_TABLE_ROWS,
  },
  {
    id: 'filas-con-importe',
    weight: 0.2,
    matches: (evidence) => evidence.amountRows >= MINIMUM_TABLE_ROWS,
  },
];

/**
 * Peso que se resta cuando el documento **se anuncia** como otra cosa. No es
 * definitivo a propósito: un extracto puede contener la palabra «factura» en la
 * glosa de un pago, así que resta en lugar de descartar.
 */
export const COUNTER_INDICATOR_PENALTY = 0.35;

/**
 * Tope del encabezado, para el documento que nunca llega a tener tabla.
 *
 * El encabezado termina de verdad donde EMPIEZA LA TABLA —la primera línea con
 * fecha e importe a la vez—, no en un número fijo de líneas: así se ajusta solo
 * a un extracto de sesenta páginas y a uno de cinco. Este tope sólo actúa cuando
 * no hay ninguna fila de datos, que es el caso de un documento que no es un
 * extracto en absoluto.
 */
export const MAX_HEADER_LINES = 40;

/**
 * Umbral a partir del cual se acepta procesar el documento.
 *
 * Un extracto sin ningún rótulo reconocible todavía suma 0.70 —título, filas
 * con fecha y filas con importe—, y un documento que solo tenga fechas e
 * importes, como una factura, se queda en 0.40 antes de la penalización. El
 * umbral se sitúa entre ambos.
 *
 * Es el mismo valor que `DEFAULT_TRIAGE_THRESHOLDS.accept` y se deriva de él:
 * dos constantes con el mismo significado se separan a la primera calibración.
 */
export const FINANCIAL_STATEMENT_THRESHOLD = DEFAULT_TRIAGE_THRESHOLDS.accept;

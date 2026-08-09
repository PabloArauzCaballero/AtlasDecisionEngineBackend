/**
 * Extracto de «QA Bank Laboratorio Financiero», en PDF, para el demo de llamada a servicio.
 *
 * Es el mismo documento de prueba con el que se diseñó el demo: periodo 01/07/2026–
 * 31/07/2026, 42 movimientos, Bs 25.665,64 en abonos y Bs 4.639,33 en cargos sobre un saldo
 * inicial de Bs 8.425,70 que cierra en Bs 29.452,01. Los datos son sintéticos y la entidad
 * no existe.
 *
 * Se genera en memoria en vez de versionar el binario, por el mismo motivo que los
 * escenarios del worker: un PDF en el repositorio es un blob que nadie puede revisar en un
 * diff, y aquí se ve la línea exacta que cambia. Además lo hace determinista: la misma
 * huella SHA-256 en cada ejecución, que es lo que permite comprobar la idempotencia.
 *
 * El seeder usa este documento cuando no se le pasa `--pdf`. Con `--pdf <ruta>` lee el
 * archivo que se le indique, que es el camino para un extracto propio.
 */
import {
  buildSyntheticPdf,
  lineY,
  type PdfCell,
} from '../../src/modules/workers/bank-statement/fixtures/synthetic-pdf';

/** Un renglón del detalle. `debit` y `credit` son excluyentes, como en el documento. */
interface Movement {
  readonly date: string;
  readonly description: string;
  readonly reference: string;
  readonly debit?: string;
  readonly credit?: string;
  readonly balance: string;
}

/**
 * Coordenadas de las columnas, en puntos PDF.
 *
 * El motor generalista deduce las columnas de la posición del texto, no de un separador,
 * así que estas `x` son el contrato real de la tabla: importes de débito y de crédito en
 * columnas distintas y bien separadas, y el saldo al final.
 */
const COLUMN = {
  date: 20,
  description: 110,
  reference: 330,
  debit: 460,
  credit: 550,
  balance: 650,
} as const;

const MOVEMENTS: readonly Movement[] = [
  {
    date: '01/07/2026',
    description: 'PAGO SERVICIO INTERNET TEST',
    reference: 'QA07010001',
    debit: '214,87',
    balance: '8.210,83',
  },
  {
    date: '02/07/2026',
    description: 'INTERES GANADO SIMULADO',
    reference: 'QA07020002',
    credit: '3,35',
    balance: '8.214,18',
  },
  {
    date: '03/07/2026',
    description: 'ABONO NOMINA EMPRESA DEMO',
    reference: 'QA07030003',
    credit: '4.750,00',
    balance: '12.964,18',
  },
  {
    date: '04/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07040004',
    debit: '28,95',
    balance: '12.935,23',
  },
  {
    date: '05/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07050005',
    credit: '1.986,70',
    balance: '14.921,93',
  },
  {
    date: '05/07/2026',
    description: 'PAGO SUSCRIPCION SOFTWARE QA',
    reference: 'QA07050006',
    debit: '113,46',
    balance: '14.808,47',
  },
  {
    date: '06/07/2026',
    description: 'ABONO NOMINA EMPRESA DEMO',
    reference: 'QA07060007',
    credit: '4.552,68',
    balance: '19.361,15',
  },
  {
    date: '07/07/2026',
    description: 'COMPRA TARJETA POS PRUEBA',
    reference: 'QA07070008',
    debit: '328,63',
    balance: '19.032,52',
  },
  {
    date: '08/07/2026',
    description: 'INTERES GANADO SIMULADO',
    reference: 'QA07080009',
    credit: '5,18',
    balance: '19.037,70',
  },
  {
    date: '08/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07080010',
    credit: '2.105,81',
    balance: '21.143,51',
  },
  {
    date: '09/07/2026',
    description: 'TRANSFERENCIA SALIENTE QA',
    reference: 'QA07090011',
    debit: '679,69',
    balance: '20.463,82',
  },
  {
    date: '10/07/2026',
    description: 'ABONO NOMINA EMPRESA DEMO',
    reference: 'QA07100012',
    credit: '4.979,62',
    balance: '25.443,44',
  },
  {
    date: '11/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07110013',
    debit: '88,49',
    balance: '25.354,95',
  },
  {
    date: '12/07/2026',
    description: 'PAGO SUSCRIPCION SOFTWARE QA',
    reference: 'QA07120014',
    debit: '92,25',
    balance: '25.262,70',
  },
  {
    date: '13/07/2026',
    description: 'DEVOLUCION COMPRA SIMULADA',
    reference: 'QA07130015',
    credit: '62,93',
    balance: '25.325,63',
  },
  {
    date: '13/07/2026',
    description: 'REVERSO DEBITO DUPLICADO TEST',
    reference: 'QA07130016',
    credit: '186,40',
    balance: '25.512,03',
  },
  {
    date: '15/07/2026',
    description: 'PAGO SUSCRIPCION SOFTWARE QA',
    reference: 'QA07150017',
    debit: '93,61',
    balance: '25.418,42',
  },
  {
    date: '15/07/2026',
    description: 'COMPRA TARJETA POS PRUEBA',
    reference: 'QA07150018',
    debit: '202,39',
    balance: '25.216,03',
  },
  {
    date: '16/07/2026',
    description: 'COMPRA TARJETA POS PRUEBA',
    reference: 'QA07160019',
    debit: '335,15',
    balance: '24.880,88',
  },
  {
    date: '17/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07170020',
    debit: '43,64',
    balance: '24.837,24',
  },
  {
    date: '17/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07170021',
    debit: '142,51',
    balance: '24.694,73',
  },
  {
    date: '18/07/2026',
    description: 'COMPRA TARJETA POS PRUEBA',
    reference: 'QA07180022',
    debit: '237,62',
    balance: '24.457,11',
  },
  {
    date: '19/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07190023',
    credit: '1.779,80',
    balance: '26.236,91',
  },
  {
    date: '19/07/2026',
    description: 'COMPRA TARJETA POS PRUEBA',
    reference: 'QA07190024',
    debit: '64,50',
    balance: '26.172,41',
  },
  {
    date: '20/07/2026',
    description: 'DEVOLUCION COMPRA SIMULADA',
    reference: 'QA07200025',
    credit: '183,72',
    balance: '26.356,13',
  },
  {
    date: '21/07/2026',
    description: 'PAGO SERVICIO ELECTRICO TEST',
    reference: 'QA07210026',
    debit: '371,31',
    balance: '25.984,82',
  },
  {
    date: '22/07/2026',
    description: 'DEVOLUCION COMPRA SIMULADA',
    reference: 'QA07220027',
    credit: '28,29',
    balance: '26.013,11',
  },
  {
    date: '23/07/2026',
    description: 'DEVOLUCION COMPRA SIMULADA',
    reference: 'QA07230028',
    credit: '150,71',
    balance: '26.163,82',
  },
  {
    date: '24/07/2026',
    description: 'COMISION MANTENIMIENTO PRUEBA',
    reference: 'QA07240029',
    debit: '15,00',
    balance: '26.148,82',
  },
  {
    date: '25/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07250030',
    credit: '1.929,41',
    balance: '28.078,23',
  },
  {
    date: '26/07/2026',
    description: 'PAGO SERVICIO INTERNET TEST',
    reference: 'QA07260031',
    debit: '197,95',
    balance: '27.880,28',
  },
  {
    date: '27/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07270032',
    credit: '1.617,25',
    balance: '29.497,53',
  },
  {
    date: '27/07/2026',
    description: 'COMISION MANTENIMIENTO PRUEBA',
    reference: 'QA07270033',
    debit: '14,75',
    balance: '29.482,78',
  },
  {
    date: '28/07/2026',
    description: 'INTERES GANADO SIMULADO',
    reference: 'QA07280034',
    credit: '14,32',
    balance: '29.497,10',
  },
  {
    date: '29/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07290035',
    debit: '254,93',
    balance: '29.242,17',
  },
  {
    date: '29/07/2026',
    description: 'PAGO SERVICIO INTERNET TEST',
    reference: 'QA07290036',
    debit: '211,04',
    balance: '29.031,13',
  },
  {
    date: '30/07/2026',
    description: 'INTERES GANADO SIMULADO',
    reference: 'QA07300037',
    credit: '7,56',
    balance: '29.038,69',
  },
  {
    date: '31/07/2026',
    description: 'PAGO SERVICIO ELECTRICO TEST',
    reference: 'QA07310038',
    debit: '167,91',
    balance: '28.870,78',
  },
  {
    date: '31/07/2026',
    description: 'TRANSFERENCIA SALIENTE QA',
    reference: 'QA07310039',
    debit: '504,01',
    balance: '28.366,77',
  },
  {
    date: '31/07/2026',
    description: 'PAGO QR COMERCIO DEMO',
    reference: 'QA07310040',
    debit: '114,78',
    balance: '28.251,99',
  },
  {
    date: '31/07/2026',
    description: 'PAGO SUSCRIPCION SOFTWARE QA',
    reference: 'QA07310041',
    debit: '121,89',
    balance: '28.130,10',
  },
  {
    date: '31/07/2026',
    description: 'ABONO TRANSFERENCIA RECIBIDA',
    reference: 'QA07310042',
    credit: '1.321,91',
    balance: '29.452,01',
  },
];

/** Totales impresos en el documento. El motor los usa para reconciliar lo que leyó. */
export const QA_BANK_STATEMENT_TOTALS = {
  openingBalance: 8_425.7,
  totalCredit: 25_665.64,
  totalDebit: 4_639.33,
  closingBalance: 29_452.01,
  movementCount: MOVEMENTS.length,
} as const;

export const QA_BANK_STATEMENT_FILE_NAME = 'extracto-qa-bank.pdf';

/** Construye el PDF. Determinista: siempre los mismos bytes. */
export function buildQaBankStatementPdf(): Buffer {
  const cells: PdfCell[] = [
    { text: 'QA BANK LABORATORIO FINANCIERO FICTICIO', x: COLUMN.date, y: lineY(0) },
    { text: 'EXTRACTO DE CUENTA', x: COLUMN.date, y: lineY(1) },
    {
      text: 'DOCUMENTO FICTICIO. DATOS DE PRUEBA, NO VALIDO COMO COMPROBANTE.',
      x: COLUMN.date,
      y: lineY(2),
    },
    { text: 'TITULAR: CLIENTE DEMOSTRACION QA', x: COLUMN.date, y: lineY(3) },
    { text: 'CUENTA: 0000-0000-0000-4821', x: COLUMN.date, y: lineY(4) },
    { text: 'MONEDA: BOB', x: COLUMN.reference, y: lineY(4) },
    { text: 'PERIODO: 01/07/2026 AL 31/07/2026', x: COLUMN.date, y: lineY(5) },
    { text: 'SALDO INICIAL', x: COLUMN.date, y: lineY(6) },
    { text: '8.425,70', x: COLUMN.balance, y: lineY(6) },
    { text: 'TOTAL CREDITOS', x: COLUMN.date, y: lineY(7) },
    { text: '25.665,64', x: COLUMN.credit, y: lineY(7) },
    { text: 'TOTAL DEBITOS', x: COLUMN.date, y: lineY(8) },
    { text: '4.639,33', x: COLUMN.debit, y: lineY(8) },
    // Cabecera de la tabla. Su posición es lo que fija las columnas del detalle.
    { text: 'FECHA', x: COLUMN.date, y: lineY(10) },
    { text: 'DESCRIPCION', x: COLUMN.description, y: lineY(10) },
    { text: 'REFERENCIA', x: COLUMN.reference, y: lineY(10) },
    { text: 'DEBITO', x: COLUMN.debit, y: lineY(10) },
    { text: 'CREDITO', x: COLUMN.credit, y: lineY(10) },
    { text: 'SALDO', x: COLUMN.balance, y: lineY(10) },
  ];

  MOVEMENTS.forEach((movement, index) => {
    const row = 11 + index;
    cells.push(
      { text: movement.date, x: COLUMN.date, y: lineY(row) },
      { text: movement.description, x: COLUMN.description, y: lineY(row) },
      { text: movement.reference, x: COLUMN.reference, y: lineY(row) },
      { text: movement.balance, x: COLUMN.balance, y: lineY(row) },
    );
    if (movement.debit) cells.push({ text: movement.debit, x: COLUMN.debit, y: lineY(row) });
    if (movement.credit) cells.push({ text: movement.credit, x: COLUMN.credit, y: lineY(row) });
  });

  const closingRow = 11 + MOVEMENTS.length + 1;
  cells.push(
    { text: 'SALDO FINAL', x: COLUMN.date, y: lineY(closingRow) },
    { text: '29.452,01', x: COLUMN.balance, y: lineY(closingRow) },
  );

  return buildSyntheticPdf(cells);
}

/**
 * Escenarios de prueba del worker de extractos.
 *
 * Son sintéticos y deterministas: ningún extracto bancario real entra en este
 * repositorio. Cada escenario declara qué demuestra, de modo que la interfaz
 * pueda explicarlo antes de ejecutarlo en vez de ofrecer cuatro nombres
 * opacos.
 *
 * Se generan en memoria en lugar de guardarse como binarios en base64 porque
 * un PDF versionado es un blob que nadie puede revisar en un diff: si mañana
 * cambia una columna del escenario, la revisión sólo ve que cambió un bloque
 * ilegible. Aquí se ve la línea exacta que cambió.
 *
 * Cubren los cuatro casos que el encargo exige: válido básico, válido
 * completo, caso límite e inválido.
 */
import { buildSyntheticPdf, lineY, type PdfCell } from './synthetic-pdf';

export interface BankStatementFixture {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** Qué se muestra en la vista previa antes de ejecutar. */
  readonly preview: string;
  /** Si el escenario debe terminar en un error controlado. */
  readonly expectsFailure: boolean;
  readonly fileName: string;
  build(): Buffer;
}

/** Encabezado común: los renglones que hacen del documento un estado de cuenta. */
function header(institution: string, account: string): PdfCell[] {
  return [
    { text: institution, x: 20, y: lineY(0) },
    { text: 'EXTRACTO DE CUENTA CORRIENTE', x: 20, y: lineY(1) },
    { text: 'CLIENTE: CLIENTE DE PRUEBA', x: 20, y: lineY(2) },
    { text: `CUENTA: ${account}`, x: 20, y: lineY(3) },
    { text: 'PERIODO: 01/03/2026 AL 31/03/2026', x: 20, y: lineY(4) },
  ];
}

/** Cabecera de la tabla de movimientos. */
function columns(row: number): PdfCell[] {
  return [
    { text: 'FECHA', x: 20, y: lineY(row) },
    { text: 'DESCRIPCION', x: 120, y: lineY(row) },
    { text: 'DEBITO', x: 420, y: lineY(row) },
    { text: 'CREDITO', x: 520, y: lineY(row) },
    { text: 'SALDO', x: 620, y: lineY(row) },
  ];
}

interface Movement {
  readonly date: string;
  readonly description: string;
  readonly debit?: string;
  readonly credit?: string;
  readonly balance: string;
}

function movement(row: number, m: Movement): PdfCell[] {
  const cells: PdfCell[] = [
    { text: m.date, x: 20, y: lineY(row) },
    { text: m.description, x: 120, y: lineY(row) },
    { text: m.balance, x: 620, y: lineY(row) },
  ];
  if (m.debit) cells.push({ text: m.debit, x: 420, y: lineY(row) });
  if (m.credit) cells.push({ text: m.credit, x: 520, y: lineY(row) });
  return cells;
}

export const BANK_STATEMENT_FIXTURES: readonly BankStatementFixture[] = [
  {
    code: 'valid-basic',
    name: 'Extracto mínimo',
    description:
      'Una institución reconocida y dos movimientos. Es el camino feliz: debe terminar en éxito con confianza alta.',
    preview: 'Banco Ganadero · cuenta ****7890 · 2 movimientos · marzo 2026',
    expectsFailure: false,
    fileName: 'extracto-basico.pdf',
    build: () =>
      buildSyntheticPdf([
        ...header('BANCO GANADERO S.A.', '1234567890'),
        { text: 'SALDO INICIAL', x: 20, y: lineY(5) },
        { text: '10.000,00', x: 620, y: lineY(5) },
        ...columns(7),
        ...movement(8, {
          date: '02/03/2026',
          description: 'PAGO SERVICIOS (CUOTA 3)',
          debit: '250,00',
          balance: '9.750,00',
        }),
        ...movement(9, {
          date: '05/03/2026',
          description: 'DEPOSITO EN EFECTIVO',
          credit: '1.500,00',
          balance: '11.250,00',
        }),
        { text: 'SALDO FINAL', x: 20, y: lineY(11) },
        { text: '11.250,00', x: 620, y: lineY(11) },
      ]),
  },
  {
    code: 'valid-complete',
    name: 'Extracto completo',
    description:
      'Seis movimientos con glosas largas, referencias y saldos que cuadran contra los totales declarados.',
    preview: 'Banco Nacional de Bolivia · cuenta ****4321 · 6 movimientos · marzo 2026',
    expectsFailure: false,
    fileName: 'extracto-completo.pdf',
    build: () =>
      buildSyntheticPdf([
        ...header('BANCO NACIONAL DE BOLIVIA S.A.', '9999884321'),
        { text: 'SALDO INICIAL', x: 20, y: lineY(5) },
        { text: '25.000,00', x: 620, y: lineY(5) },
        ...columns(7),
        ...movement(8, {
          date: '01/03/2026',
          description: 'TRANSFERENCIA RECIBIDA REF 8891',
          credit: '3.200,50',
          balance: '28.200,50',
        }),
        ...movement(9, {
          date: '04/03/2026',
          description: 'PAGO PROVEEDOR SERVICIOS GENERALES',
          debit: '1.100,00',
          balance: '27.100,50',
        }),
        ...movement(10, {
          date: '09/03/2026',
          description: 'COMISION MANTENIMIENTO DE CUENTA',
          debit: '35,00',
          balance: '27.065,50',
        }),
        ...movement(11, {
          date: '15/03/2026',
          description: 'DEPOSITO CHEQUE REF 00231',
          credit: '5.000,00',
          balance: '32.065,50',
        }),
        ...movement(12, {
          date: '22/03/2026',
          description: 'RETIRO CAJERO AUTOMATICO',
          debit: '800,00',
          balance: '31.265,50',
        }),
        ...movement(13, {
          date: '30/03/2026',
          description: 'ABONO INTERESES DEL PERIODO',
          credit: '12,75',
          balance: '31.278,25',
        }),
        { text: 'SALDO FINAL', x: 20, y: lineY(15) },
        { text: '31.278,25', x: 620, y: lineY(15) },
      ]),
  },
  {
    code: 'boundary-case',
    name: 'Caso límite',
    description:
      'Entidad del padrón sin analizador propio y un renglón que no se puede atribuir a ninguna columna. Se procesa igual, pero termina con advertencias y confianza menor: es el escenario que demuestra que «con advertencias» no es lo mismo que «bien».',
    preview: 'Cooperativa sin analizador · 1 movimiento · 1 renglón ambiguo',
    expectsFailure: false,
    fileName: 'extracto-limite.pdf',
    build: () =>
      buildSyntheticPdf([
        /*
         * Una cooperativa REAL del padrón de ASFI, y no un nombre inventado como
         * antes. Desde que la compuerta de emisor exige atribución, «entidad que
         * nadie catalogó» dejó de ser un caso límite y pasó a ser un caso de
         * revisión humana —tiene su propio escenario—. Lo que este escenario
         * demuestra sigue intacto y es lo que siempre demostró de verdad: el
         * RENGLÓN que no encaja en ninguna columna.
         */
        ...header('COOPERATIVA DE AHORRO Y CREDITO ABIERTA QUILLACOLLO R.L.', '5555000111'),
        { text: 'SALDO INICIAL', x: 20, y: lineY(5) },
        { text: '1.000,00', x: 620, y: lineY(5) },
        ...columns(7),
        ...movement(8, {
          date: '03/03/2026',
          description: 'PAGO UNICO DEL PERIODO',
          debit: '100,00',
          balance: '900,00',
        }),
        // Renglón deliberadamente ambiguo: tiene forma de dato pero no encaja
        // en la tabla. El motor debe avisar en vez de inventarse un movimiento.
        { text: 'OBSERVACION: SALDO SUJETO A CONFIRMACION 999,99', x: 120, y: lineY(9) },
        { text: 'SALDO FINAL', x: 20, y: lineY(11) },
        { text: '900,00', x: 620, y: lineY(11) },
      ]),
  },
  {
    code: 'foreign-issuer',
    name: 'Estado de cuenta que no es de un banco',
    description:
      'Un documento con todas las señales de un estado de cuenta —título, número de cuenta, saldo y una tabla de consumos fechados— emitido por una telefónica. El clasificador por sí solo lo acepta: es la compuerta de emisor la que lo rechaza, y este escenario existe para que esa diferencia se vea.',
    preview: 'Emisor no financiero · rechazo por compuerta de emisor',
    expectsFailure: true,
    fileName: 'estado-de-cuenta-telefonia.pdf',
    build: () =>
      buildSyntheticPdf([
        { text: 'ENTEL S.A.', x: 20, y: lineY(0) },
        { text: 'ESTADO DE CUENTA', x: 20, y: lineY(1) },
        { text: 'CUENTA: 70011223', x: 20, y: lineY(2) },
        { text: 'PERIODO: 01/03/2026 AL 31/03/2026', x: 20, y: lineY(3) },
        { text: 'SALDO ANTERIOR: 120,00', x: 20, y: lineY(4) },
        ...columns(6),
        ...movement(7, {
          date: '05/03/2026',
          description: 'CONSUMO PLAN POSPAGO',
          debit: '150,00',
          balance: '270,00',
        }),
        ...movement(8, {
          date: '20/03/2026',
          description: 'PAGO RECIBIDO',
          credit: '120,00',
          balance: '150,00',
        }),
      ]),
  },
  {
    code: 'invalid-example',
    name: 'No es un estado de cuenta',
    description:
      'Un PDF válido cuyo contenido no es un extracto. Debe rechazarse ANTES de intentar extraer movimientos, con un error controlado y sin reintentos.',
    preview: 'Documento de texto corriente · sin tabla de movimientos',
    expectsFailure: true,
    fileName: 'no-es-extracto.pdf',
    build: () =>
      buildSyntheticPdf([
        { text: 'ACTA DE REUNION ORDINARIA', x: 20, y: lineY(0) },
        {
          text: 'Se reunieron los asistentes para revisar el plan trimestral.',
          x: 20,
          y: lineY(2),
        },
        { text: 'Se aprobo por unanimidad el calendario propuesto.', x: 20, y: lineY(3) },
        { text: 'No hubo observaciones adicionales.', x: 20, y: lineY(4) },
      ]),
  },
];

/** Busca un escenario por su código. `undefined` si no existe. */
export function findBankStatementFixture(code: string): BankStatementFixture | undefined {
  return BANK_STATEMENT_FIXTURES.find((fixture) => fixture.code === code);
}

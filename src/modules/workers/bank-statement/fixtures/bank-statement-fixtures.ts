/**
 * Escenarios de prueba del worker de extractos.
 *
 * Son sintéticos y deterministas: ningún extracto bancario real entra en este
 * repositorio. Cada escenario declara qué demuestra, de modo que la interfaz
 * pueda explicarlo antes de ejecutarlo en vez de ofrecer cuatro nombres opacos.
 *
 * Se generan en memoria en lugar de guardarse como binarios en base64 porque un
 * PDF versionado es un blob que nadie puede revisar en un diff: si mañana cambia
 * una columna del escenario, la revisión sólo ve que cambió un bloque ilegible.
 * Aquí se ve la línea exacta que cambió.
 *
 * ## Por qué todos duran TRES MESES
 *
 * Porque el motor ya no acepta menos. La capacidad de pago exige tres meses
 * naturales completos —con uno o dos no hay forma estadística de separar un
 * ingreso de un cobro extraordinario— y esa exigencia es una condición de
 * admisión del documento, no un informe posterior. Un escenario de un mes ya no
 * demuestra el camino feliz: demuestra el rechazo por periodo, y para eso existe
 * su propio escenario.
 *
 * Los escenarios cubren las tres compuertas de admisión —contenedor, contenido y
 * emisor— más la política de meses, más los dos caminos felices y el caso límite.
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
function header(institution: string, account: string, period: string): PdfCell[] {
  return [
    { text: institution, x: 20, y: lineY(0) },
    { text: 'EXTRACTO DE CUENTA CORRIENTE', x: 20, y: lineY(1) },
    { text: 'CLIENTE: CLIENTE DE PRUEBA', x: 20, y: lineY(2) },
    { text: `CUENTA: ${account}`, x: 20, y: lineY(3) },
    { text: `PERIODO: ${period}`, x: 20, y: lineY(4) },
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
  readonly debit?: number;
  readonly credit?: number;
}

function bolivianos(value: number): string {
  return value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Pinta la tabla y lleva el saldo corriente.
 *
 * El saldo se calcula aquí en vez de escribirse a mano en cada renglón porque el
 * motor CONCILIA la continuidad del saldo, y un escenario con un saldo mal
 * tecleado no probaría lo que dice probar: terminaría en revisión por datos
 * ambiguos y el fallo se leería como un fallo del motor.
 */
function table(
  startRow: number,
  openingBalance: number,
  movements: readonly Movement[],
): { cells: PdfCell[]; closing: number; totalDebit: number; totalCredit: number } {
  const cells: PdfCell[] = [
    { text: 'SALDO INICIAL', x: 20, y: lineY(startRow) },
    { text: bolivianos(openingBalance), x: 620, y: lineY(startRow) },
    ...columns(startRow + 2),
  ];

  let balance = openingBalance;
  let totalDebit = 0;
  let totalCredit = 0;
  movements.forEach((movement, index) => {
    const row = startRow + 3 + index;
    balance += (movement.credit ?? 0) - (movement.debit ?? 0);
    totalDebit += movement.debit ?? 0;
    totalCredit += movement.credit ?? 0;
    cells.push(
      { text: movement.date, x: 20, y: lineY(row) },
      { text: movement.description, x: 120, y: lineY(row) },
      { text: bolivianos(Number(balance.toFixed(2))), x: 620, y: lineY(row) },
    );
    if (movement.debit) cells.push({ text: bolivianos(movement.debit), x: 420, y: lineY(row) });
    if (movement.credit) cells.push({ text: bolivianos(movement.credit), x: 520, y: lineY(row) });
  });

  const closingRow = startRow + 4 + movements.length;
  cells.push(
    { text: 'SALDO FINAL', x: 20, y: lineY(closingRow) },
    { text: bolivianos(Number(balance.toFixed(2))), x: 620, y: lineY(closingRow) },
  );

  return {
    cells,
    closing: Number(balance.toFixed(2)),
    totalDebit: Number(totalDebit.toFixed(2)),
    totalCredit: Number(totalCredit.toFixed(2)),
  };
}

/** Los tres meses del periodo evaluado, en el orden en que se imprimen. */
const MESES = ['01', '02', '03'] as const;

/**
 * Un mes de vida financiera corriente: sueldo, cuota, servicios y consumo.
 *
 * Las glosas son las que imprimen los bancos bolivianos, y cada una cae en una
 * categoría distinta del léxico de capacidad de pago a propósito: el escenario
 * no demuestra nada si todos los cargos acaban en «discrecional».
 *
 * `variacion` desplaza los importes variables para que la serie tenga dispersión
 * real. Sin ella, tres meses idénticos producen un coeficiente de variación cero
 * —una estabilidad perfecta que ningún extracto real tiene— y el escenario dejaría
 * de ejercitar el castigo por volatilidad.
 */
function mesCorriente(mes: string, variacion: number): Movement[] {
  return [
    {
      date: `03/${mes}/2026`,
      description: 'PAGO CUOTA PRESTAMO PERSONAL 4412',
      debit: 950,
    },
    {
      date: `05/${mes}/2026`,
      description: 'PAGO SERVICIO ELECTRICO CRE',
      debit: Number((280 + variacion * 12).toFixed(2)),
    },
    {
      date: `08/${mes}/2026`,
      description: 'COMPRA SUPERMERCADO HIPERMAXI',
      debit: Number((640 + variacion * 35).toFixed(2)),
    },
    {
      date: `12/${mes}/2026`,
      description: 'PAGO SEGURO DE VIDA DESGRAVAMEN',
      debit: 145,
    },
    {
      date: `15/${mes}/2026`,
      description: 'RETIRO CAJERO AUTOMATICO',
      debit: 500,
    },
    {
      date: `18/${mes}/2026`,
      description: 'CONSUMO RESTAURANTE',
      debit: Number((210 + variacion * 25).toFixed(2)),
    },
    {
      date: `22/${mes}/2026`,
      description: 'DEBITO ITF DEL PERIODO',
      debit: 18.5,
    },
    {
      date: `28/${mes}/2026`,
      description: 'ABONO DE HABERES PLANILLA MENSUAL',
      credit: Number((7800 + variacion * 120).toFixed(2)),
    },
  ];
}

export const BANK_STATEMENT_FIXTURES: readonly BankStatementFixture[] = [
  {
    code: 'valid-basic',
    name: 'Extracto de tres meses',
    description:
      'Tres meses completos con sueldo, una cuota de préstamo, servicios y consumo. Es el camino feliz: debe terminar en éxito, con capacidad de pago calculada y banda sólida.',
    preview: 'Banco Ganadero · cuenta ****7890 · 24 movimientos · enero a marzo 2026',
    expectsFailure: false,
    fileName: 'extracto-tres-meses.pdf',
    build: () => {
      const movements = MESES.flatMap((mes, index) => mesCorriente(mes, index));
      const { cells } = table(5, 10_000, movements);
      return buildSyntheticPdf(
        [...header('BANCO GANADERO S.A.', '1234567890', '01/01/2026 AL 31/03/2026'), ...cells],
        { producer: 'JasperReports Library 6.20.0', creationDate: "20260401090000-04'00'" },
      );
    },
  },
  {
    code: 'valid-complete',
    name: 'Extracto completo con dos ingresos',
    description:
      'Tres meses con sueldo, cobros por QR de actividad propia, dos compromisos con terceros y un traspaso entre cuentas propias. Demuestra que el traspaso NO cuenta como ingreso y que la cadencia reconoce el cobro por QR aunque su glosa no lo diga.',
    preview: 'Banco Nacional de Bolivia · cuenta ****4321 · 33 movimientos · enero a marzo 2026',
    expectsFailure: false,
    fileName: 'extracto-completo.pdf',
    build: () => {
      const movements = MESES.flatMap((mes, index) => [
        ...mesCorriente(mes, index),
        {
          date: `10/${mes}/2026`,
          description: 'ABONO COBRO QR COMERCIO',
          credit: Number((1450 + index * 90).toFixed(2)),
        },
        {
          date: `20/${mes}/2026`,
          description: 'TRASPASO ENTRE CUENTAS PROPIAS',
          credit: 3000,
        },
        {
          date: `21/${mes}/2026`,
          description: 'TRASPASO A MIS CUENTAS AHORRO',
          debit: 3000,
        },
      ]);
      const { cells } = table(5, 25_000, movements);
      return buildSyntheticPdf(
        [
          ...header('BANCO NACIONAL DE BOLIVIA S.A.', '9999884321', '01/01/2026 AL 31/03/2026'),
          ...cells,
        ],
        { producer: 'iText 7.2.5', creationDate: "20260401084500-04'00'" },
      );
    },
  },
  {
    code: 'strained-capacity',
    name: 'Capacidad de pago comprometida',
    description:
      'Tres meses legibles con rechazos por fondos insuficientes, cuotas crecientes y un desembolso de crédito recibido mientras se pagan otras cuotas. El documento se acepta —es un extracto de verdad— y la evaluación sale ajustada con sus motivos: es el escenario que demuestra que aceptar no es aprobar.',
    preview: 'Banco Económico · cuenta ****5566 · rechazos por fondos y deuda creciente',
    expectsFailure: false,
    fileName: 'extracto-capacidad-ajustada.pdf',
    build: () => {
      const movements = MESES.flatMap((mes, index) => [
        {
          date: `02/${mes}/2026`,
          description: 'PAGO CUOTA PRESTAMO CONSUMO 8890',
          debit: Number((1400 + index * 350).toFixed(2)),
        },
        {
          date: `04/${mes}/2026`,
          description: 'PAGO MINIMO TARJETA DE CREDITO',
          debit: Number((820 + index * 140).toFixed(2)),
        },
        {
          /*
           * El rechazo se imprime con su COMISIÓN y no con importe cero, que es
           * como lo imprime un banco: el cargo no se hizo, pero la penalización
           * sí. Un renglón sin importe no tiene columna que rellenar y el motor
           * no lo lee como movimiento, así que el escenario dejaría de demostrar
           * lo que dice demostrar.
           */
          date: `06/${mes}/2026`,
          description: 'COMISION POR CHEQUE DEVUELTO FONDOS INSUFICIENTES',
          debit: 35,
        },
        {
          date: `07/${mes}/2026`,
          description: 'PAGO SERVICIO AGUA SAGUAPAC',
          debit: Number((190 + index * 8).toFixed(2)),
        },
        {
          date: `11/${mes}/2026`,
          description: 'COMPRA SUPERMERCADO FIDALGA',
          debit: Number((520 + index * 20).toFixed(2)),
        },
        {
          date: `16/${mes}/2026`,
          description: 'DESEMBOLSO PRESTAMO PERSONAL',
          credit: index === 1 ? 4000 : 0,
        },
        {
          date: `19/${mes}/2026`,
          description: 'PAGO SEGURO DESGRAVAMEN',
          debit: 210,
        },
        {
          date: `28/${mes}/2026`,
          description: 'ABONO DE HABERES PLANILLA MENSUAL',
          credit: Number((6200 - index * 260).toFixed(2)),
        },
      ]).filter((movement) => (movement.credit ?? 0) > 0 || (movement.debit ?? 0) > 0);
      const { cells } = table(5, 3_200, movements);
      return buildSyntheticPdf(
        [...header('BANCO ECONOMICO S.A.', '7777005566', '01/01/2026 AL 31/03/2026'), ...cells],
        { producer: 'Crystal Reports 2020', creationDate: "20260401101500-04'00'" },
      );
    },
  },
  {
    code: 'boundary-case',
    name: 'Caso límite',
    description:
      'Entidad del padrón sin analizador propio y un renglón que no se puede atribuir a ninguna columna. Se procesa igual, pero termina con advertencias y confianza menor: es el escenario que demuestra que «con advertencias» no es lo mismo que «bien».',
    preview: 'Cooperativa sin analizador · tres meses · 1 renglón ambiguo',
    expectsFailure: false,
    fileName: 'extracto-limite.pdf',
    build: () => {
      /*
       * Una cooperativa REAL del padrón de ASFI, y no un nombre inventado. Desde
       * que la compuerta de emisor exige atribución, «entidad que nadie catalogó»
       * dejó de ser un caso límite y pasó a ser un caso de revisión humana —tiene
       * su propio escenario—. Lo que este escenario demuestra sigue intacto y es
       * lo que siempre demostró de verdad: el RENGLÓN que no encaja en ninguna
       * columna.
       */
      const movements = MESES.flatMap((mes, index) => mesCorriente(mes, index));
      const { cells } = table(5, 4_000, movements);
      return buildSyntheticPdf(
        [
          ...header(
            'COOPERATIVA DE AHORRO Y CREDITO ABIERTA QUILLACOLLO R.L.',
            '5555000111',
            '01/01/2026 AL 31/03/2026',
          ),
          ...cells,
          // Renglón deliberadamente ambiguo: tiene forma de dato pero no encaja
          // en la tabla. El motor debe avisar en vez de inventarse un movimiento.
          {
            text: 'OBSERVACION: SALDO SUJETO A CONFIRMACION 999,99',
            x: 120,
            y: lineY(6 + movements.length + 5),
          },
        ],
        { producer: 'Apache FOP 2.8' },
      );
    },
  },
  {
    code: 'short-period',
    name: 'Extracto de un solo mes',
    description:
      'Un extracto perfectamente legítimo de un mes. Se ADMITE con una advertencia de cobertura, y ése es el punto: con un mes, un aguinaldo o una compra grande bastan para desviar la mediana, así que la capacidad de pago se calcula y se marca como menos fiable en vez de tirar el documento. Dejó de rechazarse cuando se midió que la cuenta de meses NATURALES COMPLETOS convertía en «insuficiente» al extracto que la banca por internet entrega como «últimos 3 meses». Con BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS=true vuelve a rechazarse, y es el escenario con el que se comprueba esa palanca.',
    preview: 'Banco Nacional de Bolivia · 1 mes · se admite con advertencia de cobertura',
    expectsFailure: false,
    fileName: 'extracto-un-mes.pdf',
    build: () => {
      const { cells } = table(5, 10_000, mesCorriente('03', 0));
      return buildSyntheticPdf(
        [
          ...header('BANCO NACIONAL DE BOLIVIA S.A.', '9999884321', '01/03/2026 AL 31/03/2026'),
          ...cells,
        ],
        { producer: 'iText 7.2.5' },
      );
    },
  },
  {
    code: 'tampered-document',
    name: 'Extracto compuesto en un editor',
    description:
      'El MISMO contenido que el camino feliz —misma entidad, mismas glosas, mismos importes— en un archivo que declara haberse producido con un programa de diseño y que se modificó dos días después de crearse. El clasificador lo acepta, la compuerta de emisor lo acepta, y la de autenticidad lo rechaza: es el escenario que demuestra por qué hacen falta las tres.',
    preview: 'Contenido válido · contenedor manipulado · rechazo por autenticidad',
    expectsFailure: true,
    fileName: 'extracto-manipulado.pdf',
    build: () => {
      const movements = MESES.flatMap((mes, index) => mesCorriente(mes, index));
      const { cells } = table(5, 10_000, movements);
      return buildSyntheticPdf(
        [...header('BANCO GANADERO S.A.', '1234567890', '01/01/2026 AL 31/03/2026'), ...cells],
        {
          producer: 'Adobe Photoshop 25.0 (Macintosh)',
          creator: 'Adobe Illustrator 28.0',
          creationDate: "20260401090000-04'00'",
          modificationDate: "20260403141200-04'00'",
        },
      );
    },
  },
  {
    code: 'foreign-issuer',
    name: 'Estado de cuenta que no es de un banco',
    description:
      'Un documento con todas las señales de un estado de cuenta —título, número de cuenta, saldo y una tabla de consumos fechados— emitido por una telefónica. El clasificador por sí solo lo acepta: es la compuerta de emisor la que lo rechaza, y este escenario existe para que esa diferencia se vea.',
    preview: 'Emisor no financiero · rechazo por compuerta de emisor',
    expectsFailure: true,
    fileName: 'estado-de-cuenta-telefonia.pdf',
    build: () => {
      const { cells } = table(5, 120, [
        { date: '05/03/2026', description: 'CONSUMO PLAN POSPAGO', debit: 150 },
        { date: '20/03/2026', description: 'PAGO RECIBIDO', credit: 120 },
        { date: '05/02/2026', description: 'CONSUMO PLAN POSPAGO', debit: 150 },
        { date: '20/02/2026', description: 'PAGO RECIBIDO', credit: 120 },
      ]);
      return buildSyntheticPdf([
        { text: 'ENTEL S.A.', x: 20, y: lineY(0) },
        { text: 'ESTADO DE CUENTA', x: 20, y: lineY(1) },
        { text: 'CUENTA: 70011223', x: 20, y: lineY(2) },
        { text: 'PERIODO: 01/02/2026 AL 31/03/2026', x: 20, y: lineY(4) },
        ...cells,
      ]);
    },
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

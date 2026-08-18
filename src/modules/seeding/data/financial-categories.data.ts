import type { SemanticCategorySeed } from './expense-category-tree.data';

/**
 * Lo FINANCIERO que faltaba, y el ingreso que lo espeja.
 *
 * El árbol curado cubre bien la cuenta corriente de una persona —comisión,
 * cuota, seguro, cambio— y se queda corto en todo lo que un extracto trae
 * cuando hay una empresa detrás o cuando el banco actúa por orden de un tercero:
 * el ITF que se debita solo, la boleta de garantía, el leasing, el factoraje, la
 * retención judicial. Ninguno de esos hechos se parece a una cuota de préstamo,
 * y agruparlos allí volvía ilegible la única hoja que sí describe deuda.
 *
 * ## Cada hoja de gasto tiene su espejo cuando el dinero puede volver
 *
 * El anticrético se entrega y se devuelve; la garantía se constituye y se
 * libera; el dólar se compra y se vende; el embargo retiene y después suelta. En
 * el extracto son dos líneas distintas y en el informe son dos hechos distintos,
 * así que cada par vive como dos hojas —una en Gastos, otra en Ingresos— que se
 * nombran mutuamente como contraejemplo. Sin ese cruce, la devolución de un
 * anticrético se clasificaba como su entrega y el saldo del informe salía al
 * revés.
 *
 * ## Por qué el umbral aquí es más alto
 *
 * Confundir dos gastos domésticos desordena un informe; confundir una
 * amortización, una retención judicial o una regalía distorsiona un cálculo de
 * capacidad de pago o una declaración. Estas hojas usan el umbral SENSIBLE del
 * árbol —el mismo que ya llevaban préstamos e impuestos— salvo las que sólo
 * describen un movimiento de dinero propio.
 */

const CORRIENTE = 0.62;
const SENSIBLE = 0.68;

function hoja(
  code: string,
  name: string,
  description: string,
  parentCode: string,
  positiveExamples: readonly string[],
  counterExamples: readonly string[],
  relatedCategoryCodes: readonly string[] = [],
  acceptanceThreshold = CORRIENTE,
): SemanticCategorySeed {
  return {
    code,
    name,
    description,
    parentCode,
    positiveExamples,
    counterExamples,
    restrictions: [],
    relatedCategoryCodes,
    acceptanceThreshold,
  };
}

export const financialCategories: readonly SemanticCategorySeed[] = [
  // ==========================================================================
  // Gastos financieros
  // ==========================================================================
  hoja(
    'GASTOS.FINANCIEROS.ITF',
    'Impuesto a las transacciones financieras',
    'ITF que la entidad debita automáticamente sobre movimientos de la cuenta.',
    'GASTOS.FINANCIEROS',
    [
      'DEBITO ITF',
      'COBRO ITF',
      'IMPUESTO A LAS TRANSACCIONES FINANCIERAS',
      'DEBITO IMPUESTO ITF',
      'RETENCION ITF CUENTA',
      'ITF DEL PERIODO',
    ],
    [
      // No es un tributo que el titular declare: lo retiene el banco por operar.
      'PAGO IMPUESTOS',
      'RETENCION IVA',
      'COMISION MANTENIMIENTO DE CUENTA',
    ],
    ['GASTOS.IMPUESTOS', 'GASTOS.FINANCIEROS.COMISIONES'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.MORA',
    'Mora, penalidades y sobregiro',
    'Cargos por atraso, penalidad contractual y uso de sobregiro.',
    'GASTOS.FINANCIEROS',
    [
      'CARGO POR MORA',
      'PENALIDAD POR PAGO ATRASADO',
      'COBRO GASTOS DE COBRANZA',
      'COMISION POR SOBREGIRO',
      'INTERES POR SOBREGIRO EN CUENTA',
      'CARGO POR CHEQUE DEVUELTO',
      'MULTA POR INCUMPLIMIENTO CONTRATO',
    ],
    [
      'COBRO DE INTERESES POR MORA PRESTAMO',
      'COMISION MANTENIMIENTO DE CUENTA',
      'PAGO MULTA DE TRANSITO',
    ],
    ['GASTOS.FINANCIEROS.PRESTAMOS', 'GASTOS.FINANCIEROS.COMISIONES'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.LEASING',
    'Leasing y arrendamiento financiero',
    'Canon de arrendamiento financiero de un bien que la entidad mantiene en propiedad.',
    'GASTOS.FINANCIEROS',
    [
      'PAGO CUOTA LEASING',
      'PAGO ARRENDAMIENTO FINANCIERO',
      'DEBITO CANON DE LEASING',
      'PAGO LEASING VEHICULO',
      'PAGO LEASING MAQUINARIA',
      'CUOTA CONTRATO DE LEASING',
    ],
    ['PAGO CUOTA PRESTAMO', 'ALQUILER EQUIPO MAQUINARIA', 'ALQUILER LOCAL COMERCIAL'],
    ['GASTOS.FINANCIEROS.PRESTAMOS', 'GASTOS.EMPRESARIALES.EQUIPO'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.GARANTIAS',
    'Boletas de garantía y avales',
    'Emisión, renovación y comisión de una boleta de garantía, aval o carta fianza.',
    'GASTOS.FINANCIEROS',
    [
      'EMISION BOLETA DE GARANTIA',
      'COMISION BOLETA DE GARANTIA',
      'RENOVACION BOLETA DE GARANTIA',
      'PAGO CARTA FIANZA',
      'COMISION POR AVAL BANCARIO',
      'DEBITO POR GARANTIA BANCARIA',
    ],
    ['DEPOSITO EN GARANTIA', 'FONDOS A CUSTODIA ESCROW', 'COMISION MANTENIMIENTO DE CUENTA'],
    ['GASTOS.CUSTODIA', 'INGRESOS.GARANTIA'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.FACTORAJE',
    'Factoraje y descuento de documentos',
    'Costo de anticipar facturas o descontar documentos ante la entidad.',
    'GASTOS.FINANCIEROS',
    [
      'COMISION FACTORING',
      'PAGO OPERACION DE FACTORAJE',
      'DESCUENTO DE DOCUMENTOS COMISION',
      'CARGO POR ANTICIPO DE FACTURAS',
      'COMISION DESCUENTO LETRAS',
    ],
    ['COMISION PROCESAMIENTO TARJETAS', 'PAGO CUOTA PRESTAMO', 'PAGO FACTURA PROVEEDOR'],
    ['GASTOS.FINANCIEROS.PRESTAMOS'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.CRIPTO',
    'Criptoactivos',
    'Compra de criptomonedas o envío de fondos a una plataforma de intercambio.',
    'GASTOS.FINANCIEROS',
    [
      'COMPRA DE CRIPTOMONEDAS',
      'COMPRA USDT EXCHANGE',
      'TRANSFERENCIA A PLATAFORMA DE INTERCAMBIO',
      'COMPRA INTERNET EXT BINANCE',
      'COMPRA DE ACTIVOS VIRTUALES',
      'DEBITO POR COMPRA DE CRIPTOACTIVOS',
    ],
    ['COMPRA DE DOLARES', 'APORTE FONDO DE INVERSION', 'TRANSFERENCIA SALIENTE'],
    ['GASTOS.FINANCIEROS.CAMBIO', 'GASTOS.AHORRO'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.FINANCIEROS.JUDICIAL',
    'Retenciones y embargos judiciales',
    'Fondos retenidos o debitados por orden judicial o administrativa.',
    'GASTOS.FINANCIEROS',
    [
      'RETENCION JUDICIAL DE FONDOS',
      'DEBITO POR ORDEN JUDICIAL',
      'EMBARGO DE CUENTA',
      'RETENCION POR MANDAMIENTO JUDICIAL',
      'DEBITO POR RETENCION DE FONDOS AUTORIDAD',
      'PAGO ASISTENCIA FAMILIAR JUDICIAL',
    ],
    ['RETENCION IVA', 'FONDOS A CUSTODIA ESCROW', 'AYUDA FAMILIAR MENSUAL'],
    ['GASTOS.CUSTODIA', 'INGRESOS.JUDICIAL'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.REMESA',
    'Remesa enviada al exterior',
    'Giro de dinero a otro país por casa de cambio o transferencia internacional saliente.',
    'GASTOS',
    [
      'ENVIO DE REMESA AL EXTERIOR',
      'PAGO GIRO INTERNACIONAL ENVIADO',
      'ENVIO WESTERN UNION',
      'REMESA FAMILIAR ENVIADA',
      'DEBITO POR GIRO AL EXTERIOR',
      'ENVIO DE DINERO AL EXTERIOR',
    ],
    [
      // La entrada del exterior es la hoja espejo, y la confusión invierte el signo.
      'ABONO REMESA DEL EXTERIOR',
      'TRANSFERENCIA SALIENTE',
      'COMPRA DE DOLARES',
    ],
    ['INGRESOS.REMESA', 'GASTOS.TRANSFERENCIAS'],
  ),
  hoja(
    'GASTOS.MULTAS',
    'Multas y sanciones',
    'Multa de tránsito, sanción administrativa y mora tributaria impuestas por una autoridad.',
    'GASTOS',
    [
      'PAGO MULTA DE TRANSITO',
      'PAGO MULTA MUNICIPAL',
      'PAGO SANCION ADMINISTRATIVA',
      'PAGO MULTA POLICIA BOLIVIANA',
      'PAGO MULTA ELECTORAL',
      'PAGO MULTA TRIBUTARIA',
      'PAGO INFRACCION DE TRANSITO RUAT',
    ],
    ['PAGO IMPUESTO VEHICULOS', 'CARGO POR MORA', 'PAGO PATENTE MUNICIPAL'],
    ['GASTOS.IMPUESTOS', 'GASTOS.FINANCIEROS.MORA'],
    SENSIBLE,
  ),

  // ==========================================================================
  // Ingresos
  // ==========================================================================
  hoja(
    'INGRESOS.FINIQUITO',
    'Beneficios sociales cobrados',
    'Finiquito, indemnización o desahucio que el titular recibe al terminar su relación laboral.',
    'INGRESOS',
    [
      'ABONO FINIQUITO',
      'ABONO BENEFICIOS SOCIALES',
      'DEPOSITO INDEMNIZACION LABORAL',
      'ABONO DESAHUCIO',
      'ACREDITACION LIQUIDACION FINAL',
      'ABONO PAGO DE BENEFICIOS SOCIALES',
    ],
    ['ABONO NOMINA', 'PAGO FINIQUITO', 'INDEMNIZACION SEGURO SINIESTRO'],
    ['INGRESOS.SUELDO', 'GASTOS.LABORALES.FINIQUITO'],
    SENSIBLE,
  ),
  hoja(
    'INGRESOS.VIATICOS',
    'Reembolso de gastos',
    'Devolución de dinero que el titular adelantó: viáticos, rendición o reembolso de una empresa.',
    'INGRESOS',
    [
      'ABONO REEMBOLSO DE GASTOS',
      'ABONO REEMBOLSO DE VIATICOS',
      'DEPOSITO REEMBOLSO RENDICION',
      'ABONO DEVOLUCION DE GASTOS ADELANTADOS',
      'ACREDITACION REEMBOLSO EMPRESA',
    ],
    ['ABONO NOMINA', 'DEVOLUCION COMPRA', 'ABONO TRANSFERENCIA RECIBIDA'],
    ['GASTOS.EMPRESARIALES.VIATICOS', 'INGRESOS.REVERSO'],
  ),
  hoja(
    'INGRESOS.COMISIONES',
    'Comisiones cobradas',
    'Comisión que el titular cobra por vender o intermediar por cuenta de otro.',
    'INGRESOS',
    [
      'ABONO COMISIONES DE VENTA',
      'PAGO DE COMISION VENDEDOR',
      'ABONO LIQUIDACION DE COMISIONES',
      'DEPOSITO COMISION POR INTERMEDIACION',
      'ABONO COMISION AGENTE',
    ],
    ['ABONO NOMINA', 'COBRO FACTURA SERVICIOS', 'COMISION MANTENIMIENTO DE CUENTA'],
    ['INGRESOS.INDEPENDIENTE', 'GASTOS.EMPRESARIALES.COMISIONES'],
  ),
  hoja(
    'INGRESOS.QR',
    'Cobro por QR',
    'Dinero recibido de un cliente o de una persona que leyó el código QR del titular.',
    'INGRESOS',
    [
      'ABONO QR RECIBIDO',
      'CREDITO TRANSFERENCIA QR',
      'ABONO COBRO CON QR',
      'TRANSF. QR ACH RECIBIDA',
      'ABONO POR PAGO QR CLIENTE',
      'N/C POR COBRO QR',
    ],
    ['PAGO QR COMERCIO', 'DEBITO ACH QR', 'ABONO TRANSFERENCIA RECIBIDA'],
    ['GASTOS.COMPRAS.QR', 'INGRESOS.TRANSFERENCIA'],
  ),
  hoja(
    'INGRESOS.BILLETERA',
    'Abono desde billetera móvil',
    'Dinero que entra desde una billetera móvil o monedero electrónico.',
    'INGRESOS',
    [
      'ABONO DESDE BILLETERA MOVIL',
      'ABONO TIGO MONEY RECIBIDO',
      'CREDITO DESDE MONEDERO ELECTRONICO',
      'ABONO RETIRO DE BILLETERA DIGITAL',
      'ABONO TRANSFERENCIA BILLETERA MOVIL',
    ],
    ['RECARGA BILLETERA DIGITAL', 'ABONO TIGO MONEY', 'ABONO TRANSFERENCIA RECIBIDA'],
    ['INGRESOS.TRANSFERENCIA', 'GASTOS.VIVIENDA.TELECOMUNICACIONES'],
  ),
  hoja(
    'INGRESOS.RESCATE',
    'Rescate de inversión',
    'Vencimiento o retiro de un depósito a plazo, fondo de inversión o ahorro programado: el capital vuelve.',
    'INGRESOS',
    [
      'ABONO VENCIMIENTO DPF',
      'ABONO RESCATE FONDO DE INVERSION',
      'CREDITO POR CANCELACION DE DPF',
      'ABONO RETIRO AHORRO PROGRAMADO',
      'ACREDITACION CAPITAL DEPOSITO A PLAZO',
      'ABONO REDENCION DE CUOTAS FONDO',
    ],
    [
      // El rendimiento es la ganancia; el rescate es el capital que vuelve.
      'ABONO INTERESES',
      'ACREDITACION RENDIMIENTO FONDO DE INVERSION',
      'TRASPASO A DEPOSITO A PLAZO FIJO',
    ],
    ['INGRESOS.FINANCIERO', 'GASTOS.AHORRO'],
  ),
  hoja(
    'INGRESOS.CAMBIO',
    'Venta de divisa',
    'Abono en cuenta por vender dólares u otra moneda extranjera.',
    'INGRESOS',
    [
      'ABONO POR VENTA DE DOLARES',
      'ABONO OPERACION DE CAMBIO',
      'CREDITO POR CAMBIO DE DIVISAS',
      'ABONO VENTA USD COMPRA BOLIVIANOS',
      'ABONO CONVERSION DE MONEDA',
    ],
    ['COMPRA DE DOLARES', 'ABONO REMESA DEL EXTERIOR', 'CONVERSION MONEDA FX'],
    ['GASTOS.FINANCIEROS.CAMBIO'],
  ),
  hoja(
    'INGRESOS.ANTICRETICO',
    'Devolución de anticrético',
    'El capital entregado en anticrético vuelve al terminar el contrato.',
    'INGRESOS',
    [
      'DEVOLUCION DE ANTICRETICO',
      'ABONO DEVOLUCION ANTICRETICO',
      'CREDITO POR DEVOLUCION DE CAPITAL ANTICRETICO',
      'ABONO FIN DE CONTRATO ANTICRETICO',
    ],
    ['PAGO ANTICRETICO', 'ABONO ALQUILER COBRADO', 'DEVOLUCION DEPOSITO EN GARANTIA'],
    ['GASTOS.VIVIENDA.ANTICRETICO', 'INGRESOS.ALQUILER'],
  ),
  hoja(
    'INGRESOS.GARANTIA',
    'Devolución de garantía',
    'Liberación de una boleta de garantía, fianza o depósito en garantía a favor del titular.',
    'INGRESOS',
    [
      'ABONO DEVOLUCION DE GARANTIA',
      'LIBERACION BOLETA DE GARANTIA',
      'ABONO EJECUCION DE BOLETA A FAVOR',
      'CREDITO POR DEVOLUCION DE FIANZA',
      'ABONO RETENCION DE GARANTIA LIBERADA',
    ],
    ['EMISION BOLETA DE GARANTIA', 'LIBERACION FONDOS EN CUSTODIA', 'DEVOLUCION DE ANTICRETICO'],
    ['GASTOS.FINANCIEROS.GARANTIAS', 'INGRESOS.CUSTODIA'],
  ),
  hoja(
    'INGRESOS.JUDICIAL',
    'Abono por resolución judicial',
    'Dinero acreditado por sentencia, liberación de embargo o pago ordenado por una autoridad.',
    'INGRESOS',
    [
      'ABONO POR ORDEN JUDICIAL',
      'LIBERACION DE FONDOS EMBARGADOS',
      'ABONO POR SENTENCIA JUDICIAL',
      'CREDITO POR RESOLUCION ADMINISTRATIVA',
      'ABONO ASISTENCIA FAMILIAR RECIBIDA',
    ],
    ['RETENCION JUDICIAL DE FONDOS', 'EMBARGO DE CUENTA', 'ABONO TRANSFERENCIA RECIBIDA'],
    ['GASTOS.FINANCIEROS.JUDICIAL'],
    SENSIBLE,
  ),
  hoja(
    'INGRESOS.REGALIAS',
    'Regalías y derechos cobrados',
    'Cobro por el uso de una marca, obra o licencia de la que el titular es dueño.',
    'INGRESOS',
    [
      'ABONO REGALIAS',
      'ABONO POR DERECHOS DE AUTOR',
      'COBRO DE REGALIA POR MARCA',
      'ABONO LICENCIAMIENTO DE MARCA',
      'ABONO ROYALTY CONTRATO',
    ],
    ['PAGO REGALIA POR MARCA', 'COBRO FACTURA SERVICIOS', 'ABONO ALQUILER COBRADO'],
    ['GASTOS.EMPRESARIALES.FRANQUICIA', 'INGRESOS.INDEPENDIENTE'],
  ),
  hoja(
    'INGRESOS.EXPORTACION',
    'Cobro de exportación',
    'Pago de un cliente del exterior por mercadería exportada.',
    'INGRESOS',
    [
      'ABONO COBRO DE EXPORTACION',
      'ABONO POR EXPORTACION DE MERCADERIA',
      'CREDITO ORDEN DE PAGO DEL EXTERIOR',
      'ABONO CARTA DE CREDITO EXPORTACION',
      'ABONO GIRO DEL EXTERIOR POR VENTA',
      'ABONO DIVISAS POR EXPORTACION',
    ],
    [
      'ABONO REMESA DEL EXTERIOR',
      'ABONO TRANSFERENCIA DEL EXTERIOR EN DOLARES',
      'COBRO DE FACTURA',
    ],
    ['INGRESOS.REMESA', 'INGRESOS.VENTA'],
  ),
  hoja(
    'INGRESOS.CAPITAL',
    'Aporte de socios',
    'Dinero que los socios ponen en la empresa: aporte de capital, aumento de capital o préstamo de socio.',
    'INGRESOS',
    [
      'ABONO APORTE DE CAPITAL',
      'DEPOSITO APORTE DE SOCIOS',
      'ABONO AUMENTO DE CAPITAL',
      'ABONO APORTE SOCIO CUENTA PARTICULAR',
      'DEPOSITO CAPITAL DE TRABAJO SOCIOS',
    ],
    ['DESEMBOLSO DE CREDITO', 'ABONO TRANSFERENCIA RECIBIDA', 'DEPOSITO EN EFECTIVO'],
    ['INGRESOS.PRESTAMO'],
  ),
  hoja(
    'INGRESOS.MINERAL',
    'Venta de mineral',
    'Liquidación de la comercializadora o del ingenio por mineral entregado.',
    'INGRESOS',
    [
      'ABONO LIQUIDACION DE MINERAL',
      'ABONO VENTA DE MINERAL',
      'ABONO COMERCIALIZADORA DE MINERALES',
      'LIQUIDACION CONCENTRADO DE ZINC',
      'ABONO POR ENTREGA DE MINERAL INGENIO',
    ],
    ['PAGO REGALIAS MINERAS', 'ABONO VENTAS POS COMERCIO', 'COBRO DE FACTURA'],
    ['GASTOS.MINERIA.REGALIAS', 'INGRESOS.VENTA'],
  ),
];

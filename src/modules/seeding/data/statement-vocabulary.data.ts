import type { SemanticCategorySeed } from './expense-category-tree.data';

/**
 * El vocabulario de un extracto EMPRESARIAL, y el dialecto con el que las
 * plantillas bolivianas escriben rubros que el catálogo de consumo no tenía.
 *
 * ## Por qué existe
 *
 * `expense-category-tree` describe el gasto de una persona: alquiler, farmacia,
 * supermercado. Un extracto de un comercio, una PYME, una ONG o un productor
 * agropecuario mueve otras cosas —liquidaciones del procesador de tarjetas,
 * contracargos, aportes patronales, insumos agrícolas, fondos en custodia— y
 * ninguna de ellas tenía dónde caer. Medido sobre 1.464 movimientos reales, el
 * 41 % quedaba «sin determinar», y las familias de arriba eran la mayor parte.
 *
 * ## Dos aportes distintos, y conviene no confundirlos
 *
 * - `statementCategories` añade HOJAS que no existían. Es política: alguien
 *   decidió que un contracargo al comercio es un gasto financiero y no una
 *   devolución.
 * - `statementVocabularyExamples` añade EJEMPLOS a hojas que ya existían. Es
 *   observación: `POS PARQUEO`, `CUOTA HIPOTECA` o `INTERES A FAVOR CUENTA` ya
 *   tenían su categoría, pero ninguna plantilla escribía como los ejemplos
 *   sembrados. Igual que `bank-dialect.data.ts`, pero para las plantillas que
 *   rotulan el rubro en la propia glosa.
 *
 * Los ejemplos van como el banco los imprime: en mayúsculas, abreviados y sin
 * los identificadores, que es exactamente el texto que `forClassification`
 * entrega al clasificador.
 */

/** Umbral de las hojas nuevas: el mismo que usa el grueso del árbol curado. */
const UMBRAL = 0.62;

function hoja(
  code: string,
  name: string,
  description: string,
  parentCode: string,
  positiveExamples: readonly string[],
  counterExamples: readonly string[],
  acceptanceThreshold = UMBRAL,
): SemanticCategorySeed {
  return {
    code,
    name,
    description,
    parentCode,
    positiveExamples,
    counterExamples,
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold,
  };
}

function rama(code: string, name: string, description: string): SemanticCategorySeed {
  return {
    code,
    name,
    description,
    parentCode: 'GASTOS',
    positiveExamples: [],
    counterExamples: [],
    restrictions: [],
    relatedCategoryCodes: [],
    // Una rama no puede ganar nunca: la clasificación recae en sus hojas.
    acceptanceThreshold: 1,
  };
}

/** Hojas que el catálogo de consumo no contemplaba. */
export const statementCategories: readonly SemanticCategorySeed[] = [
  // ── Comercio que cobra con tarjeta ────────────────────────────────────────
  hoja(
    'INGRESOS.ADQUIRENCIA',
    'Liquidación de ventas con tarjeta',
    'Lo que el procesador abona al comercio por las ventas cobradas con tarjeta o por marketplace, y la reserva que libera.',
    'INGRESOS',
    [
      'LIQUIDACION VENTAS TARJETA',
      'LIQUIDACION VENTAS TARJETA NETO COMISIONES',
      'ABONO LIQUIDACION ADQUIRENCIA',
      'LIBERACION RESERVA PROCESADOR',
      'LIBERACION RESERVA PROCESADOR LOTE',
      'PAYOUT MARKETPLACE',
      'ABONO PAYOUT MARKETPLACE',
      'ABONO VENTAS POS COMERCIO',
      'DEPOSITO LIQUIDACION TARJETAS',
    ],
    ['COMISION PROCESAMIENTO TARJETAS', 'RETENCION RESERVA PROCESADOR', 'PAGO CON TARJETA EN POS'],
  ),
  hoja(
    'GASTOS.ADQUIRENCIA',
    'Comisiones del procesador de tarjetas',
    'Lo que el procesador cobra o retiene al comercio: comisión por procesar, reserva retenida y ajustes negativos de la liquidación.',
    'GASTOS',
    [
      'COMISION PROCESAMIENTO TARJETAS',
      'COMISION PROCESAMIENTO TARJETAS LOTE',
      'RETENCION RESERVA PROCESADOR',
      'AJUSTE NEGATIVO LIQUIDACION COMERCIO',
      'COMISION MARKETPLACE',
      'COMISION MARKETPLACE PEDIDO',
      'DESCUENTO COMISION ADQUIRENCIA',
    ],
    [
      'LIQUIDACION VENTAS TARJETA',
      'LIBERACION RESERVA PROCESADOR',
      'COMISION MANTENIMIENTO CUENTA',
    ],
  ),
  hoja(
    'GASTOS.FINANCIEROS.CONTRACARGO',
    'Contracargo al comercio',
    'El banco revierte al comercio una venta que el tarjetahabiente desconoció.',
    'GASTOS.FINANCIEROS',
    [
      'DEBITO POR CONTRACARGO COMERCIO',
      'CONTRACARGO COMERCIO CASO',
      'DEBITO CONTRACARGO TARJETA',
      'CHARGEBACK COMERCIO',
    ],
    ['CREDITO PROVISIONAL DISPUTA TARJETA', 'DEVOLUCION COMPRA REFUND'],
  ),
  hoja(
    'INGRESOS.DISPUTA',
    'Crédito por disputa de tarjeta',
    'Abono provisional o definitivo mientras el banco resuelve un cobro desconocido.',
    'INGRESOS',
    [
      'CREDITO PROVISIONAL DISPUTA TARJETA',
      'CREDITO DEFINITIVO DISPUTA RESUELTA',
      'ABONO DISPUTA TARJETA CASO',
      'CREDITO POR RECLAMO DE TARJETA',
    ],
    ['DEBITO POR CONTRACARGO COMERCIO', 'DEVOLUCION COMPRA REFUND'],
  ),

  // ── Nómina vista desde quien la paga ──────────────────────────────────────
  hoja(
    'GASTOS.NOMINA',
    'Pago de nómina y aportes',
    'Sueldos pagados a la planilla y los aportes y retenciones que los acompañan. Es el reverso de INGRESOS.SUELDO: aquí la empresa paga.',
    'GASTOS',
    [
      'PAGO NOMINA LOTE',
      'PAGO NOMINA EMPLEADOS',
      'PAGO PLANILLA SUELDOS',
      'APORTES RETENCIONES NOMINA',
      'APORTES PATRONALES',
      'PAGO AGUINALDO PLANILLA',
      'PAGO SUELDOS PERSONAL',
    ],
    ['ABONO NOMINA', 'ABONO SUELDO', 'PAGO A PROVEEDOR'],
  ),

  // ── Empresa: comprar, mover y equipar ─────────────────────────────────────
  rama(
    'GASTOS.EMPRESARIALES',
    'Operación del negocio',
    'Compras y servicios propios de operar un negocio.',
  ),
  hoja(
    'GASTOS.EMPRESARIALES.INVENTARIO',
    'Compra de inventario',
    'Mercadería y materia prima que el negocio compra para vender o transformar.',
    'GASTOS.EMPRESARIALES',
    [
      'COMPRA INVENTARIO',
      'COMPRA INVENTARIO ORDEN DE COMPRA',
      'COMPRA MERCADERIA PROVEEDOR',
      'COMPRA MATERIA PRIMA',
      'REPOSICION DE STOCK',
    ],
    ['COMPRA EN SUPERMERCADO', 'PAGO A PROVEEDOR DE SERVICIOS'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.LOGISTICA',
    'Logística y mensajería',
    'Flete, transporte de carga, courier y mensajería del negocio.',
    'GASTOS.EMPRESARIALES',
    [
      'LOGISTICA FLETE',
      'POS LOGISTICA FLETE',
      'MENSAJERIA COURIER',
      'POS MENSAJERIA COURIER',
      'FLETE PRODUCCION COSECHA',
      'SERVICIO DE ENCOMIENDA',
      'TRANSPORTE DE CARGA',
    ],
    ['POS TRANSPORTE PUBLICO', 'PASAJE DE BUS', 'TAXI'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.EQUIPO',
    'Alquiler de equipo y maquinaria',
    'Renta de maquinaria, equipo o vehículos para operar; no es el alquiler del local ni de la vivienda.',
    'GASTOS.EMPRESARIALES',
    [
      'ALQUILER EQUIPO MAQUINARIA',
      'ALQUILER DE MAQUINARIA',
      'RENTA DE EQUIPO',
      'ARRIENDO MAQUINARIA PESADA',
      'ALQUILER LOCAL COMERCIAL',
    ],
    ['ALQUILER VIVIENDA', 'CUOTA HIPOTECA'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.SUMINISTROS',
    'Suministros de oficina',
    'Consumibles y material de oficina del negocio.',
    'GASTOS.EMPRESARIALES',
    [
      'SUMINISTROS OFICINA',
      'POS SUMINISTROS OFICINA',
      'COMPRA MATERIAL DE ESCRITORIO',
      'INSUMOS DE OFICINA',
    ],
    ['LIBRERIA Y PAPELERIA PERSONAL', 'COMPRA INVENTARIO'],
  ),

  // ── Campo ─────────────────────────────────────────────────────────────────
  rama('GASTOS.AGRO', 'Actividad agropecuaria', 'Gasto propio de producir en el campo.'),
  hoja(
    'GASTOS.AGRO.INSUMOS',
    'Semillas e insumos agrícolas',
    'Semilla, fertilizante y agroquímico de la campaña.',
    'GASTOS.AGRO',
    [
      'SEMILLAS INSUMO AGRICOLA',
      'COMPRA INSUMOS AGRICOLAS',
      'FERTILIZANTES Y AGROQUIMICOS',
      'PAGO INSUMOS AGRICOLAS SINT',
    ],
    ['COMPRA INVENTARIO', 'ALIMENTO SUPLEMENTO PECUARIO'],
  ),
  hoja(
    'GASTOS.AGRO.MAQUINARIA',
    'Maquinaria agrícola y riego',
    'Mantenimiento de maquinaria del campo y servicio de riego.',
    'GASTOS.AGRO',
    [
      'MANTENIMIENTO MAQUINARIA AGRICOLA',
      'SERVICIO RIEGO AGUA CAMPO',
      'REPARACION TRACTOR',
      'MANTENIMIENTO EQUIPO AGRICOLA',
    ],
    ['ALQUILER EQUIPO MAQUINARIA', 'MANTENIMIENTO DEL HOGAR'],
  ),
  hoja(
    'GASTOS.AGRO.PECUARIO',
    'Ganadería y veterinaria',
    'Alimento del ganado y atención veterinaria rural.',
    'GASTOS.AGRO',
    [
      'ALIMENTO SUPLEMENTO PECUARIO',
      'SERVICIO VETERINARIO RURAL',
      'COMPRA DE FORRAJE',
      'VACUNACION DE GANADO',
    ],
    ['VETERINARIA MASCOTA', 'COMPRA DE ALIMENTOS EN SUPERMERCADO'],
  ),

  // ── Dinero que se aparta y vuelve ─────────────────────────────────────────
  hoja(
    'GASTOS.CUSTODIA',
    'Fondos puestos en custodia',
    'Dinero inmovilizado en una cuenta de garantía mientras se cumple un contrato.',
    'GASTOS',
    [
      'FONDOS A CUSTODIA',
      'FONDOS A CUSTODIA ESCROW',
      'CONSTITUCION DE ESCROW',
      'DEPOSITO EN GARANTIA',
    ],
    ['LIBERACION FONDOS EN CUSTODIA', 'AHORRO PROGRAMADO'],
  ),
  hoja(
    'INGRESOS.CUSTODIA',
    'Liberación de fondos en custodia',
    'El dinero apartado en garantía vuelve a la cuenta.',
    'INGRESOS',
    ['LIBERACION FONDOS EN CUSTODIA', 'LIBERACION ESCROW', 'DEVOLUCION DEPOSITO EN GARANTIA'],
    ['FONDOS A CUSTODIA ESCROW', 'LIBERACION RESERVA PROCESADOR'],
  ),

  // ── Estado, seguros, cooperación ──────────────────────────────────────────
  hoja(
    'INGRESOS.TRIBUTARIO',
    'Devolución tributaria',
    'Lo que la administración devuelve: saldo a favor, RC-IVA o crédito fiscal.',
    'INGRESOS',
    [
      'DEVOLUCION TRIBUTARIA',
      'DEVOLUCION TRIBUTARIA EXPEDIENTE',
      'DEVOLUCION IMPUESTOS',
      'ABONO CREDITO FISCAL',
    ],
    ['PAGO IMPUESTO TRIBUTO', 'RETENCION IVA'],
  ),
  hoja(
    'INGRESOS.SEGURO',
    'Indemnización de seguro',
    'Lo que la aseguradora paga por un siniestro.',
    'INGRESOS',
    ['INDEMNIZACION SEGURO SINIESTRO', 'PAGO DE SINIESTRO', 'ABONO INDEMNIZACION POLIZA'],
    ['PRIMA SEGURO POLIZA', 'PAGO DE SEGURO'],
  ),
  hoja(
    'INGRESOS.SUBVENCION',
    'Subvención y donación recibida',
    'Desembolso de un convenio, subvención o donación a una organización.',
    'INGRESOS',
    [
      'DESEMBOLSO SUBVENCION CONVENIO',
      'DESEMBOLSO DE SUBVENCION',
      'DONACION APORTE RECIBIDA',
      'DONACION RECIBIDA CAMPANA',
      'ABONO DE COOPERACION',
    ],
    ['DESEMBOLSO PROYECTO SUBVENCION', 'DESEMBOLSO DE CREDITO'],
  ),
  hoja(
    'GASTOS.SUBVENCIONES',
    'Desembolso de proyecto',
    'Lo que una organización entrega a los proyectos o convenios que financia.',
    'GASTOS',
    [
      'DESEMBOLSO PROYECTO SUBVENCION',
      'DESEMBOLSO A PROYECTO CONVENIO',
      'ENTREGA DE FONDOS A PROYECTO',
    ],
    ['DESEMBOLSO SUBVENCION CONVENIO', 'DONACION APORTE RECIBIDA'],
  ),
  hoja(
    'INGRESOS.RECOMPENSA',
    'Cashback y recompensas',
    'Devolución de una parte del consumo por programa de puntos o cashback.',
    'INGRESOS',
    [
      'ABONO CASHBACK RECOMPENSA TARJETA',
      'ABONO CASHBACK',
      'CANJE DE PUNTOS',
      'BONIFICACION POR CONSUMO',
    ],
    ['DEVOLUCION COMPRA REFUND', 'REINTEGRO COMISION BANCARIA'],
  ),

  /*
   * ── Lo que el banco rotula por CANAL y no por concepto ────────────────────
   *
   * `DEBITO AGENCIA` son 52 de los 462 movimientos medidos: la glosa más
   * repetida de todo el corpus real, y la que más «sin determinar» producía.
   * El BNB no dice qué se pagó, dice DÓNDE se hizo, y no hay forma honesta de
   * deducir lo primero de lo segundo: un cargo en ventanilla puede ser un
   * retiro, el pago de una factura o el cobro de un trámite.
   *
   * Por eso la hoja nombra el canal en vez de fingir un concepto. Es
   * clasificación de verdad —dice algo cierto y comprobable contra la glosa— y
   * separa un movimiento que el banco no explicó de otro que el portal no supo
   * leer, que es lo que «sin determinar» mezclaba. Quien audita ve «Operación
   * en ventanilla» y sabe que le toca pedir el respaldo, no revisar el
   * catálogo.
   */
  hoja(
    'GASTOS.VENTANILLA',
    'Cargo en ventanilla',
    'Cargo hecho en una agencia u oficina del banco, sin concepto declarado en la glosa. El banco informa del canal, no del destino: para saber qué se pagó hace falta el respaldo de la operación.',
    'GASTOS',
    ['DEBITO AGENCIA', 'CARGO EN AGENCIA', 'DEBITO EN OFICINA', 'DEBITO POR CAJA'],
    ['RETIRO DE EFECTIVO', 'RETIRO ATM', 'DEPOSITO EFECTIVO VENTANILLA'],
  ),
  hoja(
    'INGRESOS.VENTANILLA',
    'Abono en ventanilla',
    'Abono hecho en una agencia u oficina del banco, sin concepto declarado en la glosa. Mismo caso que su gemelo de gastos: consta el canal, no el origen.',
    'INGRESOS',
    ['CREDITO AGENCIA', 'ABONO EN AGENCIA', 'CREDITO EN OFICINA', 'ABONO POR CAJA'],
    ['DEPOSITO EFECTIVO VENTANILLA', 'DEPOSITO DE EFECTIVO', 'ABONO NOMINA'],
  ),

  /*
   * ── El último escalón ─────────────────────────────────────────────────────
   *
   * Dos cajones, uno por sentido, para que ningún movimiento acabe «sin
   * determinar». No los propone el modelo —su umbral es 1, así que nunca gana
   * por parecido—: los coloca la red de seguridad de `glosa-fallback.ts` cuando
   * ni el modelo ni las reglas de instrumento supieron decir más.
   *
   * Por qué es mejor que dejarlo vacío: «otros gastos» es una categoría que
   * existe en cualquier contabilidad, se suma y se audita; «sin determinar» no
   * es nada y traslada el problema a quien recibe el informe, fila por fila. Un
   * movimiento sin concepto declarado sigue siendo dinero que salió, y eso es
   * exactamente lo que estas dos hojas afirman: el signo, y nada más.
   */
  hoja(
    'GASTOS.OTROS',
    'Otros gastos',
    'Salida de dinero cuyo concepto no consta en la glosa. Dice el signo del movimiento y nada más: no afirma en qué se gastó.',
    'GASTOS',
    [],
    [],
    // Umbral 1: inalcanzable por similitud. Sólo llega aquí quien lo coloca a
    // propósito, y así el cajón nunca le roba un movimiento a una hoja real.
    1,
  ),
  hoja(
    'INGRESOS.OTROS',
    'Otros ingresos',
    'Entrada de dinero cuyo origen no consta en la glosa. Dice el signo del movimiento y nada más.',
    'INGRESOS',
    [],
    [],
    1,
  ),
];

/**
 * Ejemplos para hojas que YA existían y que ninguna plantilla escribía como el
 * catálogo esperaba. Cada bloque sale de glosas medidas, no inventadas.
 */
export const statementVocabularyExamples: Readonly<Record<string, readonly string[]>> = {
  'GASTOS.VIVIENDA.SERVICIOS': [
    'POS AGUA SERVICIO PUBLICO',
    'POS ENERGIA ELECTRICA',
    'AGUA SERVICIO PUBLICO',
    'ENERGIA ELECTRICA MUNICIPAL',
    'DEBITO AUTOMATICO AGUA',
    'DEBITO AUTOMATICO ENERGIA',
  ],
  'GASTOS.VIVIENDA.TELECOMUNICACIONES': [
    'POS INTERNET',
    'POS TELECOMUNICACIONES',
    'INTERNET FIBRA',
    'DEBITO AUTOMATICO INTERNET',
    'PAGO SERVICIOS TELECEL',
    'RECARGA BILLETERA DIGITAL',
  ],
  'GASTOS.VIVIENDA.ALQUILER': [
    'ALQUILER VIVIENDA',
    'ALQUILER VIVIENDA MES',
    'PAGO DE ALQUILER MENSUAL',
  ],
  'GASTOS.VIVIENDA.EXPENSAS': ['ASOCIACION DE COPROPIETARIOS', 'EXPENSAS DEL CONDOMINIO'],
  'GASTOS.TRANSPORTE.ESTACIONAMIENTO': [
    'POS PARQUEO',
    'PARQUEO',
    'POS PEAJE',
    'PEAJE',
    'POS PARQUEO TERMINAL',
    'ESTACIONAMIENTO POR HORA',
  ],
  'GASTOS.TRANSPORTE.PUBLICO': [
    'POS TRANSPORTE PUBLICO',
    'POS MOVILIDAD APP',
    'MOVILIDAD APP',
    'TRANSPORTE URBANO',
    'TAXI VIXXX',
    'PASAJE TRANSPORTE URBANO',
  ],
  'GASTOS.TRANSPORTE.COMBUSTIBLE': [
    'POS COMBUSTIBLE',
    'ESTACION DE SERVICIO',
    'CARGA DE COMBUSTIBLE',
  ],
  'GASTOS.ALIMENTACION.CAFETERIA': ['POS CAFETERIA', 'CAFETERIA', 'POS PANADERIA'],
  'GASTOS.ALIMENTACION.RESTAURANTES': ['POS RESTAURANTE', 'RESTAURANTE', 'ALIMENTOS Y BEBIDAS'],
  'GASTOS.ALIMENTACION.SUPERMERCADO': ['POS SUPERMERCADO', 'SUPERMERCADO', 'ABASTO', 'MINIMARKET'],
  'GASTOS.COMPRAS.VESTIMENTA': ['POS VESTUARIO', 'VESTUARIO', 'TIENDA DE ROPA'],
  'GASTOS.COMPRAS.TECNOLOGIA': ['POS ELECTRONICA', 'ELECTRONICA', 'COMPUTADORA PORTATIL'],
  'GASTOS.COMPRAS.TARJETA': [
    'POS COMPRA ONLINE',
    'COMPRA ONLINE',
    'COMPRA INTERNACIONAL',
    'COMPRA CON CONVERSION DINAMICA',
    'VERIFICACION TARJETA',
    'DEBITO POR COMPRA EN COMERCIO ELECTRONIC',
  ],
  'GASTOS.COMPRAS.LIBRERIA': ['POS LIBROS', 'LIBRERIA', 'COMPRA DE LIBROS'],
  'GASTOS.COMPRAS.HOGAR': ['POS FERRETERIA', 'FERRETERIA', 'MUEBLES Y ELECTRODOMESTICOS'],
  'GASTOS.SALUD.ATENCION': [
    'POS SERVICIO MEDICO',
    'SERVICIO MEDICO',
    'POS SERVICIO DENTAL',
    'SERVICIO DENTAL',
    'POS LABORATORIO CLINICO',
    'LABORATORIO CLINICO',
    'SERVICIOS CLINICA',
  ],
  'GASTOS.SALUD.FARMACIA': ['POS FARMACIA', 'FARMACIA'],
  'GASTOS.EDUCACION': [
    'POS CURSO CAPACITACION',
    'CURSO CAPACITACION',
    'POS MATRICULA COLEGIATURA',
    'MATRICULA COLEGIATURA',
    'PAGO DE COLEGIATURA',
  ],
  'GASTOS.PROFESIONALES': [
    'POS SERVICIO PROFESIONAL',
    'POS SERVICIO LEGAL',
    'SERVICIO LEGAL',
    'HONORARIOS PROFESIONALES',
    'ESTUDIO CONTABLE',
  ],
  'GASTOS.OCIO.VIAJES': [
    'POS PASAJES AEREOS',
    'PASAJES AEREOS',
    'POS ALOJAMIENTO',
    'ALOJAMIENTO',
    'POS AGENCIA VIAJES',
    'AGENCIA DE VIAJES',
    'ALQUILER VEHICULO',
  ],
  'GASTOS.IMPUESTOS': [
    'PAGO IMPUESTO TRIBUTO',
    'TASA TRAMITE GUBERNAMENTAL',
    'TRAMITE GUBERNAMENTAL',
    'RETENCION IVA',
    'RETENCIONRCIVA',
    'PAGO CERTIFICADO ANTECEDENTES',
    'SERVICIO PLURINACIONAL DE REGISTRO DE COMERCIO',
  ],
  'GASTOS.FINANCIEROS.COMISIONES': [
    'COMISION MANTENIMIENTO CUENTA',
    'COMISION USO ATM TERCERO',
    'COMISION TRANSFERENCIA INTERNACIONAL',
    'BT ITFAP',
    'COBRO SPB',
  ],
  'GASTOS.FINANCIEROS.CAMBIO': [
    'COMISION CONVERSION MONEDA FX',
    'CONVERSION MONEDA FX',
    'COMPRA CON CONVERSION DINAMICA DCC',
    'TRANSACCION USDT TRANSF',
  ],
  'GASTOS.FINANCIEROS.PRESTAMOS': [
    'CUOTA CREDITO CONTRATO',
    'CUOTA HIPOTECA',
    'CUOTA CREDITO',
    'PAGO TARJETA CREDITO',
    'INTERES CREDITO PERIODO',
  ],
  'GASTOS.FINANCIEROS.SEGUROS': ['PRIMA SEGURO POLIZA', 'PRIMA SEGURO', 'PAGO ALIANZA GENERALES'],
  'GASTOS.TRANSFERENCIAS': [
    'P2P ENVIADO',
    'TRANSFERENCIA BANCA MOVIL',
    'TRANSFERENCIA QR BM QR',
    'TRASPASO CUENTAS TERCEROS',
    'TRASPASO ENTRE CAJAS DE AHORRO MOVIL',
    'TRASPASO CA CC CON QR MOVIL',
    'DEBITO ACH QR',
    'TRANSFERENCIA PROGRAMADA',
    'PAGO INMEDIATO ENVIADO',
    'TRANSFERENCIA INTERNACIONAL ENVIADA',
    // El BNB no escribe «transferencia»: nombra el canal y la dirección. Con
    // «TRANSFERENCIA BANCA MOVIL» a solas se quedaba por debajo del umbral.
    'DEBITO A BANCA MOVIL',
    'DEBITO A BANCA POR INTERNET',
    // El adquirente firma el cobro por QR y el comercio no aparece por ningún
    // lado, así que la glosa sólo permite afirmar el medio de pago. Sin esto
    // salía AMBIGUOUS: se parecía tanto a una transferencia como a una compra.
    'DEBITO ACH QR NOTA LINKSER COMPRA QR',
    'DEBITO ACH QR COMPRA QR',
  ],
  'GASTOS.PROVEEDORES': ['PAGO PROVEEDOR FACTURA', 'PAGO A PROVEEDOR', 'PAGO FACTURA PROVEEDOR'],
  'GASTOS.EFECTIVO': ['RETIRO ATM', 'RETIRO DE EFECTIVO', 'RETIRO DE FONDOS CUENTA'],
  'GASTOS.PERSONAL.DONACIONES': ['APOYO FAMILIAR TRANSFERENCIA', 'AYUDA FAMILIAR'],
  'INGRESOS.SUELDO': [
    'ABONO NOMINA',
    'ABONO PENSION RENTA PERIODICA',
    'BONO INCENTIVO LABORAL',
    'HORAS EXTRA AJUSTE NOMINA',
    'GANASUELDO',
    'SUELDO DEL MES',
  ],
  'INGRESOS.TRANSFERENCIA': [
    'PAGO INMEDIATO RECIBIDO',
    'P2P RECIBIDO',
    'TRANSFERENCIA INTERBANCARIA RECIBIDA',
    'TRANSFERENCIA RECIBIDA MISMO BANCO',
    'ABONO EN CUENTA POR TRANS INTERBANC',
    'CREDITO ACH QR',
    'REEMBOLSO GASTOS',
    'CREDITO DE BANCA MOVIL',
    'CREDITO DE BANCA POR INTERNET',
  ],
  'INGRESOS.FINANCIERO': [
    'INTERES A FAVOR CUENTA CAPITALIZACION',
    'INTERES A FAVOR CUENTA',
    'INTERESGANADO',
    'INTERES GANADO',
    // Tal cual lo imprime el banco en las cuentas de demostración. «SIMULADO»
    // pesa lo suficiente para tirar del parecido hacia abajo si no está aquí.
    'INTERES GANADO SIMULADO',
    'INTERESES GANADOS',
    'CAPITALIZACION DE INTERESES',
    'CAPITALIZACION NORMAL DE INTERESES',
    'CUPON INSTRUMENTO FINANCIERO',
    'DIVIDENDO DISTRIBUCION INVERSION',
  ],
  'INGRESOS.REVERSO': [
    'DEVOLUCION COMPRA REFUND',
    'DEVOLUCION PARCIAL',
    'DEVOLUCION DEBITO AUTOMATICO RETURN',
    'REVERSO DEBITO PREVIO',
    'REINTEGRO COMISION BANCARIA',
    'CORRECCION MANUAL BANCO',
    'NOTA CREDITO PROVEEDOR',
  ],
  'INGRESOS.VENTA': ['VENTA ACTIVO USADO', 'PAGO FACTURA CLIENTE', 'COBRO DE FACTURA'],
  'INGRESOS.PRESTAMO': ['DESEMBOLSO CREDITO CONTRATO', 'ANTICIPO FACTORING'],
  'INGRESOS.SUBSIDIO': ['BECA ESTIPENDIO', 'BECA ESTIPENDIO PROGRAMA ACADEMICO'],
  'INGRESOS.EFECTIVO': [
    'DEPOSITO EFECTIVO VENTANILLA',
    'DEPOSITO EFECTIVO ATM',
    'DEPOSITO DE EFECTIVO',
  ],
  'INGRESOS.CHEQUE': ['DEPOSITO CHEQUE EN COMPENSACION'],
  'INGRESOS.REMESA': ['REMESA INTERNACIONAL RECIBIDA', 'TRANSFERENCIA INTERNACIONAL RECIBIDA'],
};

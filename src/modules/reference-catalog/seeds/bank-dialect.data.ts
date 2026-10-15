/**
 * El dialecto con el que los bancos bolivianos IMPRIMEN sus glosas.
 *
 * Vive aparte del árbol de categorías a propósito. `expense-category-tree`
 * describe el DOMINIO —qué es un alquiler, qué es una comisión— y se lee como
 * una política; esto describe la FORMA en que siete bancos concretos escriben
 * esas mismas cosas, que es un hecho observado y cambia cuando un banco cambia
 * su plantilla. Mezclarlos habría convertido un catálogo legible en una lista de
 * cadenas sin explicación.
 *
 * ## De dónde salen
 *
 * De siete extractos reales pasados por el worker de extractos del propio motor
 * —BNB, BMSC, BEC, BG, BCP, BSO y BUN—: 473 movimientos, 213 glosas distintas.
 * No están inventadas ni traducidas: son las cabeceras que esos PDF traen, con
 * los identificadores ya retirados por `TextNormalizer.forClassification`, que
 * es exactamente el texto que el clasificador recibe.
 *
 * ## Por qué hacía falta
 *
 * Medido antes de sembrarlas: **20 de 213 glosas reales se clasificaban**. El
 * catálogo estaba escrito contra un extracto ideal —«PAGO ALQUILER
 * DEPARTAMENTO»— y ningún banco escribe así. El BNB escribe `DEBITO EN CUENTA
 * POR TRANS. INTERBANC.`, el Mercantil `DEBITO TRANSFERENCIA ACH`, el Económico
 * `TRASPASO CA/CC CON QR (MOVIL)` y el BCP, dos palabras: `Tarjeta De Debito`.
 * Son cuatro idiomas para el mismo hecho.
 *
 * ## Qué NO se siembra aquí
 *
 * Nombres de personas, números de cuenta y referencias: eso lo quita el
 * normalizador, y meterlo aquí acercaría cada categoría a cualquier glosa que
 * mencione a alguien. Tampoco se siembran las glosas que no dicen nada —`Agencia`,
 * `Automático`— aunque aparezcan en un extracto real: sembrarlas obligaría al
 * clasificador a elegir donde no hay nada que elegir, que es justo lo que la
 * abstención existe para evitar.
 */

/** Ejemplos positivos adicionales por código de categoría. */
export const bankDialectExamples: Readonly<Record<string, readonly string[]>> = {
  // ==========================================================================
  // Transferencias enviadas. La familia más numerosa de los extractos reales:
  // 53 glosas del BNB y 36 del Mercantil, cada banco con su nombre para lo mismo.
  // ==========================================================================
  'GASTOS.TRANSFERENCIAS': [
    'DEBITO EN CUENTA POR TRANS. INTERBANC. BNB NET',
    'DEBITO EN CUENTA (MOVIL) BNB NET',
    'DEBITO TRANSFERENCIA ACH',
    'DEBITO POR TRANSFERENCIA ACH',
    'TRASPASO ENTRE CAJAS DE AHORRO (MOVIL)',
    'TRASPASO CA/CC (MOVIL)',
    'TRASP.CTAS.TERCEROS',
    'N/D POR TRASPASO ENTRE BANCOS ACH',
    'Transf. cuentas SolNet',
    'Transferencia a tercero',
    'Transferencia a',
    'Transferencia Interbancaria enviada',
    'DEBITO POR TRASPASO A TERCEROS',
    // La glosa del Mercantil llega con el nombre de la contraparte pegado al
    // final —el banco sí se retira, la persona no se puede enumerar—, así que se
    // siembra también la forma con cola para que la cabecera no quede sola
    // compitiendo contra cuatro palabras de nombre.
    'DEBITO TRANSFERENCIA ACH A TERCERO',
    'DEBITO EN CUENTA POR TRANS. INTERBANC.',
  ],
  // ==========================================================================
  // Transferencias recibidas
  // ==========================================================================
  'INGRESOS.TRANSFERENCIA': [
    'ABONO EN CUENTA POR TRANS. INTERBANC. BNB NET',
    'CREDITO TRANSFERENCIA ACH',
    'CREDITO TRANSFERENCIA ACH QR PAGOS VARIOS',
    'CREDITO ACH QR',
    'N/C POR TRASPASO ENTRE BANCOS ACH',
    'Transacción ACH recibida',
    'ABONO POR TRASPASO ENTRE CAJAS DE AHORRO',
    'TRASP.CTAS.PROPIAS',
    /*
     * El mismo traspaso, en el sentido que entra. El Banco Económico rotula
     * `TRASPASO ENTRE CAJAS DE AHORRO (MOVIL)` tanto para el cargo como para el
     * abono, así que el portal antepone a la glosa el sentido que el propio
     * extracto declara en su columna «Tipo». Estas dos formas son las que
     * llegan entonces al clasificador.
     */
    'CREDITO TRASPASO ENTRE CAJAS DE AHORRO (MOVIL)',
    'CREDITO TRASPASO CA/CC CON QR (MOVIL)',
  ],
  // ==========================================================================
  // Pago con QR. El QR es el canal dominante en Bolivia y cada banco lo rotula
  // distinto; el Económico y el Ganadero lo usan hasta para pagar al almacén.
  // ==========================================================================
  'GASTOS.COMPRAS.QR': [
    'DEBITO ACH QR',
    'TRASPASO CA/CC CON QR (MOVIL)',
    'TRANSF. QR ACH',
    'TRANSF QR ACH',
    'DEBITO TRANSFERENCIA QR SERVICIOS',
    'PAGO CON QR COMERCIO SALA',
    'Compra QR',
  ],
  // ==========================================================================
  // Compra con tarjeta: POS presencial y comercio electrónico
  // ==========================================================================
  'GASTOS.COMPRAS.TARJETA': [
    'PAGO POS COMERCIO',
    'PAGO POS COMERCIO SANTA CRUZ BO',
    'POS COMERCIO Tarjeta',
    'POS ALMACEN',
    'DEBITO EN CUENTA POR COMPRA ATM/POS',
    'DEBITO POR COMPRA EN COMERCIO ELECTRONIC',
    'DEBITO POR COMPRA EN COMERCIO ELECTRONICO',
    'COMPRA INTERNET EXT',
    'CONSUMO CON TARJETA DE DEBITO',
    'Tarjeta De Debito',
  ],
  // ==========================================================================
  // Efectivo
  // ==========================================================================
  'GASTOS.EFECTIVO': [
    'RETIRO ATM',
    'RETIRO DE EFECTIVO',
    'DEBITO POR RETIRO EN CAJERO ATM',
    // El Mercantil imprime la DIRECCIÓN del cajero detrás; la calle no dice nada
    // del rubro pero pesa, así que la forma con cola también se siembra.
    'RETIRO ATM AVENIDA SANTA CRUZ',
  ],
  'INGRESOS.EFECTIVO': ['DEPOSITO DE EFECTIVO', 'ABONO POR DEPOSITO EN EFECTIVO'],
  // ==========================================================================
  // Rendimientos que la propia entidad acredita
  // ==========================================================================
  'INGRESOS.FINANCIERO': [
    'INTERESES CAPITALIZABLES',
    'CAPITALIZACION NORMAL DE INTERESES',
    'CAPITALIZACION DE INTERESES PREMIO',
    'PAGO DE INTERES AGENCIA CENTRAL',
    'Intereses Ganados',
  ],
  // ==========================================================================
  // Tributos. `RC-IVA` y su retención aparecen en tres de los siete extractos.
  // ==========================================================================
  'GASTOS.IMPUESTOS': [
    'RC IVA',
    'RCIVA',
    'RETENCION IVA AGENCIA CENTRAL',
    'Retencion de Impuestos IVA',
    'PAGO CERT. ANTECEDENTES CUDAP',
  ],
  // ==========================================================================
  // Sueldo: el Ganadero lo rotula con el nombre de su producto de nómina.
  // ==========================================================================
  'INGRESOS.SUELDO': ['GANASUELDO', 'ABONO POR PLANILLA GANASUELDO', 'PAGO DE SUELDO EMPRESA'],
  // ==========================================================================
  // Rubros que el comercio del POS identifica sin ambigüedad
  // ==========================================================================
  'GASTOS.ALIMENTACION.SUPERMERCADO': [
    'PAGO POS HIPERMAXI',
    'HIPERMAXI QR SALA',
    'PAGO POS FIDALGA',
    'DEBITO EN CUENTA POR COMPRA ATM/POS FIDALGA',
  ],
  'GASTOS.ALIMENTACION.RESTAURANTES': [
    'POS PIZZERIA',
    'POS ALIMENTOS Y BEBIDAS',
    'POS CHURRASQUERIA',
    'DEBITO EN CUENTA POR COMPRA ATM/POS POLLOS',
    'Transferencia a RESTAURANTE',
  ],
  'GASTOS.SALUD.FARMACIA': [
    'PAGO POS FARMACORP',
    'TRANSF. QR ACH FARMACIAS CHAVEZ',
    'DEBITO EN CUENTA POR COMPRA ATM/POS FARMA',
  ],
  'GASTOS.VIVIENDA.TELECOMUNICACIONES': [
    'PAGO SERVICIOS TELECEL',
    'PAGO SERVICIOS ENTEL',
    'PAGO SERVICIOS VIVA',
    'ABONO TIGO MONEY',
  ],
  'GASTOS.OCIO.SUSCRIPCIONES': [
    'COMPRA INTERNET EXT SPOTIFY',
    'COMPRA INTERNET EXT NETFLIX',
    'DEBITO POR COMPRA EN COMERCIO ELECTRONICO PRIME VIDEO',
  ],
  'GASTOS.FINANCIEROS.SEGUROS': ['DEBITO POR SEGURO DEL PERIODO', 'COBRO DE SEGURO MENSUAL'],
  'GASTOS.PERSONAL.DONACIONES': ['Transferencia a FUNDACION'],
  'GASTOS.TRANSPORTE.PUBLICO': ['DEBITO ACH QR TAXI'],
};

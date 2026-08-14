/**
 * Los COMERCIOS y las CONTRAPARTES que un extracto boliviano nombra.
 *
 * Tercer artefacto del catálogo, y el que faltaba. `expense-category-tree`
 * describe el dominio —qué es un alquiler—, `bank-dialect` describe cómo lo
 * rotula cada banco —`DEBITO TRANSFERENCIA ACH`— y esto describe **a quién se le
 * pagó**, que en un extracto real es casi siempre lo único que dice el rubro.
 *
 * Medido sobre los siete extractos: cuando el banco imprime `Lugar:POLLOS CHUY
 * FIDALGA` o `POS EL ARRIERO CHURRASQU`, la cabecera sólo dice «compra con
 * tarjeta». Que sea un restaurante lo dice el NOMBRE, y sin él aquí la línea se
 * quedaba en la hoja genérica o directamente sin categoría.
 *
 * ## Dos clases de entrada, y la diferencia importa
 *
 * - **Marcas**: `HIPERMAXI`, `FARMACORP`, `YPFB`. Son hechos verificables del
 *   mercado boliviano y no caducan con la plantilla de un banco.
 * - **Formas con COLA DE NOMBRE**: `DEBITO TRANSFERENCIA ACH JUAN PEREZ GARCIA`.
 *   Existen porque el nombre de la contraparte no se puede enumerar ni retirar
 *   —una persona no está en ningún catálogo— y llega pegado a la glosa: tres a
 *   cinco palabras que pesan más que la cabecera. Sembrar la forma CON cola hace
 *   que el clasificador reconozca lo que de verdad recibe. Sin ellas, 35 de las
 *   45 glosas que quedaban sin clasificar eran transferencias evidentes.
 *
 * ## La cabecera de transferencia vive en UNA sola familia
 *
 * `DEBITO TRANSFERENCIA ACH` sólo aparece bajo transferencias. Se probó lo
 * contrario —sembrarla también en proveedores, expensas, préstamos, eventos y
 * donaciones, con el nombre de cada contraparte detrás— y el resultado fue peor:
 * seis hojas compartiendo la misma cabecera se reparten la confianza y ninguna
 * alcanza su umbral, así que el Mercantil pasó de 49 glosas clasificadas a 32.
 * El comercio va SOLO, sin cabecera: es lo que lo distingue, y la cabecera es lo
 * que lo confunde.
 *
 * ## Lo que NO se siembra
 *
 * Nombres de personas reales de los extractos. Los de aquí son inventados y
 * genéricos a propósito: lo que se está enseñando es la FORMA «cabecera +
 * nombre», no quién cobró. Sembrar un nombre real metería un dato personal en
 * un catálogo versionado y no mejoraría nada.
 */

export const bolivianMerchantExamples: Readonly<Record<string, readonly string[]>> = {
  // ==========================================================================
  // Transferencias: la cabecera con su cola de nombre.
  //
  // Cuatro variantes por familia y no una: un solo ejemplo con cola fija haría
  // que el parecido dependiera de ESE nombre. Con varios, lo que queda en común
  // —y por tanto lo que el vector aprende— es la cabecera más «algo que parece
  // un nombre detrás», que es justo la forma que llega.
  // ==========================================================================
  'GASTOS.TRANSFERENCIAS': [
    'A: Banca Movil',
    'A: Banca Movil Bcp',
    'Transferencia a EMPRESA LTDA consumo',
    'Transferencia a FERREIRA JUSTINIANO VICTOR HUGO',
    'DEBITO TRANSFERENCIA ACH JUAN PEREZ GARCIA',
    'DEBITO TRANSFERENCIA ACH MARIA LOPEZ QUISPE',
    'DEBITO TRANSFERENCIA ACH CARLOS MAMANI CONDORI',
    'DEBITO TRANSFERENCIA ACH ANA GUTIERREZ ROJAS',
    'DEBITO TRANSFERENCIA ACH EMPRESA CONSTRUCTORA SRL',
    'DEBITO EN CUENTA POR TRANS. INTERBANC. JUAN PEREZ GARCIA',
    'DEBITO EN CUENTA POR TRANS. INTERBANC. MARIA LOPEZ QUISPE',
    'DEBITO EN CUENTA (MOVIL) CARLOS MAMANI CONDORI',
    'Transferencia a JUAN PEREZ GARCIA',
    'Transferencia a EMPRESA COMERCIAL SRL',
    'TRASPASO ENTRE CAJAS DE AHORRO (MOVIL) TRASP.CTAS.TERCEROS MARIA LOPEZ',
    'Transf. cuentas SolNet JUAN PEREZ GARCIA',
  ],
  'INGRESOS.TRANSFERENCIA': [
    'De: Banca Movil',
    'De: Banca Movil Bcp',
    'CREDITO TRANSFERENCIA ACH SIN DETALLE MULTIPRODUCTOS Y SERVICIOS SA',
    'CREDITO TRANSFERENCIA ACH SIN DETALLE EMPRESA SA',
    'CREDITO TRANSFERENCIA ACH JUAN PEREZ GARCIA',
    'CREDITO TRANSFERENCIA ACH MARIA LOPEZ QUISPE',
    'ABONO EN CUENTA POR TRANS. INTERBANC. CARLOS MAMANI CONDORI',
    'ABONO EN CUENTA POR TRANS. INTERBANC. EMPRESA COMERCIAL SRL',
    'CREDITO TRANSFERENCIA ACH QR PAGOS VARIOS ANA GUTIERREZ ROJAS',
    'Transacción ACH JUAN PEREZ GARCIA',
  ],
  'GASTOS.COMPRAS.QR': [
    'TRANSF. QR ACH VERONICA ORUNO CONDORI Sin referencia',
    'TRANSF. QR ACH RENNY RODRIGUEZ BARBERY Sin referencia',
    'TRANSF. QR ACH VARGAS ANTOGNELLI VANESSA Sin referencia',
    'TRANSF. QR ACH JUAN TORREZ TALI Pagos',
    'TRANSF. QR ACH GASCO SRL CAJA',
    'TRANSF. QR ACH JUAN PEREZ GARCIA Sin referencia',
    'TRANSF. QR ACH MARIA LOPEZ QUISPE Sin referencia',
    'TRANSF. QR ACH IMPORTACIONES Y REPRESENTACIONES SRL',
    'TRANSF. QR ACH COMERCIAL SANTA CRUZ SRL Sin definir',
    'DEBITO ACH QR JUAN PEREZ GARCIA varios',
    'DEBITO TRANSFERENCIA QR SERVICIOS VARIOS',
  ],

  // ==========================================================================
  // Alimentación. Las cadenas que un extracto cruceño o paceño repite cada mes.
  // ==========================================================================
  'GASTOS.ALIMENTACION.SUPERMERCADO': [
    'PAGO POS HIPERMAXI',
    'PAGO POS FIDALGA',
    'PAGO POS IC NORTE',
    'PAGO POS KETAL',
    'PAGO POS TIA',
    'PAGO POS SLAN',
    'COMPRA EN HIPERMAXI SUCURSAL NORTE',
    'DEBITO EN CUENTA POR COMPRA ATM/POS FIDALGA NORTE',
    'HIPERMAXI QR SALA',
    'COMPRA MERCADO ABASTO',
    'COMPRA EN MINIMARKET',
  ],
  'GASTOS.ALIMENTACION.RESTAURANTES': [
    'DEBITO EN CUENTA POR COMPRA ATM/POS DONATELLA MAKROPARQUE',
    'DEBITO EN CUENTA POR COMPRA ATM/POS TOBY MAKROPARQUE',
    'DEBITO EN CUENTA POR COMPRA ATM/POS POLLOS CHUY',
    'DEBITO EN CUENTA POR COMPRA ATM/POS THE CHICKEN GRILL',
    'DEBITO EN CUENTA POR COMPRA ATM/POS NAM FAST FOOD',
    'DEBITO EN CUENTA POR COMPRA ATM/POS DONATELLA',
    'POS EL ARRIERO CHURRASQUERIA',
    'POS VULCANICA PIZZERIA',
    'POS ALIMENTOS Y BEBIDAS',
    'PAGO POS POLLOS COPACABANA',
    'PAGO POS BURGER KING',
    'PAGO POS SUBWAY',
    'PAGO POS KFC',
    'PAGO POS TOBY',
    'PAGO POS FACTORY',
    'PAGO POS LA CASONA',
    'PAGO POS CASA DEL CAMBA',
    'RESTAURANTE COMIDA Y TORTAS',
    'PEDIDO PEDIDOSYA',
    'PEDIDO YAIGO',
    'COMPRA INTERNET EXT PEDIDOSYA',
  ],
  'GASTOS.ALIMENTACION.CAFETERIA': [
    'PAGO POS ALEXANDER COFFEE',
    'PAGO POS CAFE MARTINEZ',
    'PAGO POS STARBUCKS',
    'PAGO POS DUMBO',
    'PAGO POS PANADERIA VICTORIA',
    'POS COFI',
    'CONSUMO EN CAFETERIA',
    'COMPRA EN PANADERIA',
    'COMPRA EN HELADERIA',
  ],

  // ==========================================================================
  // Salud
  // ==========================================================================
  'GASTOS.SALUD.FARMACIA': [
    'PAGO POS FARMACORP SUCURSAL PIRAI',
    'PAGO POS FARMACORP SUC',
    'PAGO POS FARMACORP',
    'PAGO POS FARMACIAS CHAVEZ',
    'DEBITO EN CUENTA POR COMPRA ATM/POS ROSALFARMA',
    'PAGO POS HIPERFARMA',
    'PAGO POS FARMACIA BOLIVIA',
    'COMPRA EN FARMACIA SIMILARES',
  ],
  'GASTOS.SALUD.ATENCION': [
    'PAGO CLINICA FOIANINI',
    'PAGO CLINICA INCOR',
    'PAGO HOSPITAL JAPONES',
    'PAGO CAJA PETROLERA DE SALUD',
    'PAGO LABORATORIO CLINICO',
    'PAGO CENTRO MEDICO',
    'PAGO SEGURO DE SALUD PREPAGO',
  ],

  // ==========================================================================
  // Vivienda: las empresas de servicio de cada ciudad son nombres propios que
  // un extracto imprime tal cual, y ninguna se parece a la palabra «luz».
  // ==========================================================================
  'GASTOS.VIVIENDA.SERVICIOS': [
    'PAGO SERVICIOS CRE',
    'PAGO SERVICIOS ELFEC',
    'PAGO SERVICIOS DELAPAZ',
    'PAGO SERVICIOS ENDE',
    'PAGO SERVICIOS SAGUAPAC',
    'PAGO SERVICIOS EPSAS',
    'PAGO SERVICIOS SEMAPA',
    'PAGO SERVICIOS COOPLAN',
    'PAGO SERVICIOS YPFB GAS DOMICILIARIO',
    'PAGO SERVICIOS COSMOL',
  ],
  'GASTOS.VIVIENDA.TELECOMUNICACIONES': [
    'PAGO SERVICIOS ENTEL',
    'PAGO SERVICIOS TIGO',
    'PAGO SERVICIOS VIVA',
    'PAGO SERVICIOS COTAS',
    'PAGO SERVICIOS COTEL',
    'PAGO SERVICIOS AXS',
    'PAGO SERVICIOS NUEVATEL',
    'RECARGA ENTEL',
    'RECARGA TIGO',
    'COMPRA INTERNET EXT TIGO STAR',
  ],
  'GASTOS.VIVIENDA.EXPENSAS': [
    'ASOCIACION DE COPROPIETARIOS DEL CONDOMINIO',
    'PAGO ADMINISTRACION CONDOMINIO',
    'PAGO EXPENSAS TORRE',
    'PAGO CUOTA CONDOMINIO LAS PALMAS',
  ],
  'GASTOS.VIVIENDA.MANTENIMIENTO': [
    'PAGO POS FERRETERIA',
    'PAGO POS CASA DEL PERNO',
    'COMPRA EN FERRETERIA INDUSTRIAL',
    'PAGO SERVICIO DE FUMIGACION',
  ],

  // ==========================================================================
  // Transporte
  // ==========================================================================
  'GASTOS.TRANSPORTE.COMBUSTIBLE': [
    'PAGO POS YPFB',
    'PAGO POS ESTACION DE SERVICIO',
    'PAGO POS SURTIDOR',
    'COMPRA COMBUSTIBLE ESTACION',
    'PAGO POS LUBRICANTES Y SERVICIOS',
  ],
  'GASTOS.TRANSPORTE.PUBLICO': [
    'DEBITO ACH QR YANGO',
    'DEBITO ACH QR TAXI',
    'COMPRA INTERNET EXT UBER',
    'COMPRA INTERNET EXT INDRIVE',
    'PAGO POS FLOTA COPACABANA',
    'PAGO POS TRUFI',
  ],
  'GASTOS.TRANSPORTE.ESTACIONAMIENTO': [
    'PAGO POS PARQUEO MAKROPARQUE',
    'PAGO POS ESTACIONAMIENTO CENTRO',
    'PAGO PEAJE',
  ],

  // ==========================================================================
  // Compras
  // ==========================================================================
  'GASTOS.COMPRAS.TARJETA': [
    'DEBITO EN CUENTA POR COMPRA ATM/POS TIENDAS TRESBE',
    'DEBITO EN CUENTA POR COMPRA ATM/POS MAKROPARQUE',
    'POS ALMACEN SRL',
    'PAGO POS COMERCIO VARIOS',
  ],
  'GASTOS.COMPRAS.VESTIMENTA': [
    'PAGO POS TOPITOP',
    'PAGO POS LA RIVIERA',
    'PAGO POS TIENDA DE ROPA',
    'PAGO POS CALZADOS',
    'PAGO POS BOUTIQUE',
  ],
  'GASTOS.COMPRAS.TECNOLOGIA': [
    'PAGO POS TIENDA DE CELULARES',
    'PAGO POS COMPUTACION',
    'COMPRA INTERNET EXT AMAZON',
    'COMPRA INTERNET EXT ALIEXPRESS',
    'PAGO POS ELECTRONICA',
  ],
  'GASTOS.COMPRAS.HOGAR': [
    'PAGO POS MULTICENTER',
    'PAGO POS CASA IDEAS',
    'PAGO POS MUEBLERIA',
    'PAGO POS ELECTRODOMESTICOS',
  ],
  'GASTOS.COMPRAS.LIBRERIA': [
    'PAGO POS LIBRERIA',
    'PAGO POS PAPELERIA',
    'COMPRA MATERIAL DE ESCRITORIO',
    'PAGO POS IMPRENTA',
  ],

  // ==========================================================================
  // Ocio
  // ==========================================================================
  'GASTOS.OCIO.SUSCRIPCIONES': [
    'COMPRA INTERNET EXT SPOTIFY',
    'COMPRA INTERNET EXT NETFLIX',
    'COMPRA INTERNET EXT PRIME VIDEO',
    'COMPRA INTERNET EXT DISNEY PLUS',
    'COMPRA INTERNET EXT HBO MAX',
    'COMPRA INTERNET EXT YOUTUBE PREMIUM',
    'COMPRA INTERNET EXT MICROSOFT',
    'COMPRA INTERNET EXT GOOGLE',
    'COMPRA INTERNET EXT APPLE',
    'COMPRA INTERNET EXT OPENAI',
    'COMPRA INTERNET EXT CANVA',
  ],
  'GASTOS.OCIO.EVENTOS': [
    'PAGO POS CINEMARK',
    'PAGO POS MULTICINE',
    'PAGO POS CINE CENTER',
    'CINEMARK BOLIVIA SRL',
    'COMPRA ENTRADAS EVENTO',
  ],
  'GASTOS.OCIO.VIAJES': [
    'PAGO POS BOA BOLIVIANA DE AVIACION',
    'PAGO POS AMASZONAS',
    'COMPRA INTERNET EXT DESPEGAR',
    'COMPRA INTERNET EXT BOOKING',
    'PAGO POS HOTEL',
  ],

  // ==========================================================================
  // Personal
  // ==========================================================================
  'GASTOS.PERSONAL.CUIDADO': [
    'PAGO POS PELUQUERIA',
    'PAGO POS SPA',
    'PAGO POS GIMNASIO',
    'PAGO POS SMART FIT',
    'PAGO POS PERFUMERIA',
  ],
  'GASTOS.PERSONAL.MASCOTAS': [
    'PAGO POS PET SHOP',
    'PAGO POS VETERINARIA',
    'PAGO POS MUNDO ANIMAL',
  ],
  'GASTOS.PERSONAL.DONACIONES': [
    'FUNDACION NATURA BOLIVIA',
    'FUNDACION SIN FINES DE LUCRO',
    'FUNDACION SOLIDARIA',
    'APORTE IGLESIA',
  ],

  // ==========================================================================
  // Financieros y obligaciones
  // ==========================================================================
  'GASTOS.FINANCIEROS.PRESTAMOS': [
    'ATC SA A. DE TARJETAS DE CREDITO SA',
    'A. DE TARJETAS DE CREDITO',
    'ATC SA ADMINISTRADORA DE TARJETAS DE CREDITO SA',
    'PAGO A ADMINISTRADORA DE TARJETAS DE CREDITO',
    'ATC ADMINISTRADORA DE TARJETAS DE CREDITO',
    'PAGO TARJETA DE CREDITO ATC',
    'DEBITO POR CUOTA DE PRESTAMO',
    'AMORTIZACION CREDITO DE CONSUMO',
  ],
  'GASTOS.FINANCIEROS.SEGUROS': [
    'Seguro periodo tarjeta',
    'Seguro mensual',
    'Seguro del periodo',
    'COBRO SEGURO MENSUAL TARJETA',
    'DEBITO SEGURO',
    'DEBITO POR SEGURO DEL PERIODO',
    'PAGO POS ALIANZA SEGUROS',
    'PAGO POS BISA SEGUROS',
    'PAGO POS NACIONAL SEGUROS',
    'PAGO POS CREDINFORM',
    'DEBITO PRIMA SEGURO TARJETA',
  ],
  'GASTOS.IMPUESTOS': [
    'IMPUESTOS NACIONALES',
    'SERVICIO DE IMPUESTOS NACIONALES',
    'GAMSC GOBIERNO AUTONOMO MUNICIPAL',
    'PAGO A LA ALCALDIA MUNICIPAL',
    'RUAT IMPUESTO VEHICULAR',
    'PAGO PATENTE Y TASAS MUNICIPALES',
  ],
  'GASTOS.EDUCACION': [
    'UNIVERSIDAD UPSA',
    'UNIVERSIDAD UAGRM',
    'UNIVERSIDAD CATOLICA BOLIVIANA',
    'UNIVERSIDAD UNIFRANZ',
    'UNIVERSIDAD UTEPSA',
    'PAGO POS COLEGIO',
    'PAGO PENSION KINDER',
  ],
  'GASTOS.PROVEEDORES': [
    'IMPORTACIONES Y REPRESENTACIONES SRL',
    'DISTRIBUIDORA COMERCIAL SRL',
    'PAGO A PROVEEDOR MAYORISTA',
  ],
  'GASTOS.PROFESIONALES': [
    'PAGO HONORARIOS ESTUDIO JURIDICO',
    'PAGO SERVICIOS DE AUDITORIA',
    'PAGO CONSULTORIA PROFESIONAL',
  ],
};

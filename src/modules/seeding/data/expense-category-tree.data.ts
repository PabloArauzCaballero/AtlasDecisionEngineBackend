/**
 * Árbol de categorías de gasto e ingreso del worker semántico.
 *
 * Es el catálogo contra el que se clasifica la descripción de un movimiento
 * bancario —lo que el extracto trae escrito en una línea: «PAGO SERVICIOS
 * (CUOTA 3)», «TRANSF RECIBIDA NOMINA JUNIO»—. El otro worker del módulo produce
 * exactamente esas descripciones, así que los dos encajan sin traducción de por
 * medio.
 *
 * **Es un árbol, y la clasificación recae en las HOJAS.** Un nodo intermedio
 * («Vivienda») describe una rama, no un gasto concreto: aceptarlo como resultado
 * sería clasificar con menos detalle del que el catálogo ofrece. La rama sirve
 * para lo contrario —agregar el informe— y para explicar el resultado con su
 * ruta completa, «Gastos › Vivienda › Alquiler».
 *
 * Cada hoja trae contraejemplos, y pesan tanto como los ejemplos positivos: son
 * los que evitan que «pago cuota préstamo vivienda» caiga en Alquiler y que
 * «recarga de saldo» caiga en Servicios básicos. El clasificador los usa de
 * verdad —mide el parecido con ellos y descarta la categoría si gana el
 * contraejemplo—, así que un contraejemplo mal escrito no es adorno: cambia el
 * resultado.
 *
 * Los ejemplos están escritos como se ven en un extracto boliviano: en
 * mayúsculas, abreviados y con la jerga del banco. Redactarlos en prosa limpia
 * los alejaría del texto real justo en la dimensión que el modelo mide.
 */

export interface SemanticCategorySeed {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** `null` en las dos raíces del árbol. */
  readonly parentCode: string | null;
  readonly positiveExamples: readonly string[];
  readonly counterExamples: readonly string[];
  readonly restrictions: readonly string[];
  readonly relatedCategoryCodes: readonly string[];
  readonly acceptanceThreshold: number;
}

/**
 * Umbral de las ramas.
 *
 * Inalcanzable a propósito: la recuperación de candidatos ya se limita a las
 * hojas, y este valor es el segundo cierre. Si alguien reactivara una rama como
 * candidata, seguiría sin poder aceptarse en vez de convertirse en el destino de
 * todo lo que no encaja en ninguna de sus hojas.
 */
const RAMA = 1;

/** Ramas: estructura, no destino. Sin ejemplos, porque no se clasifica en ellas. */
function rama(
  code: string,
  name: string,
  description: string,
  parentCode: string | null,
): SemanticCategorySeed {
  return {
    code,
    name,
    description,
    parentCode,
    positiveExamples: [],
    counterExamples: [],
    restrictions: ['Nodo de agrupación: la clasificación recae en sus hojas.'],
    relatedCategoryCodes: [],
    acceptanceThreshold: RAMA,
  };
}

export const expenseCategoryTree: readonly SemanticCategorySeed[] = [
  rama('INGRESOS', 'Ingresos', 'Dinero que entra en la cuenta.', null),
  rama('GASTOS', 'Gastos', 'Dinero que sale de la cuenta.', null),

  // --- Ingresos -------------------------------------------------------------
  {
    code: 'INGRESOS.SUELDO',
    name: 'Sueldo',
    description: 'Remuneración periódica de una relación laboral, acreditada por el empleador.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO DE HABERES NOMINA JUNIO',
      'PAGO DE SUELDO EMPRESA CONSTRUCTORA SRL',
      'DEPOSITO PLANILLA SALARIAL QUINCENA',
      'ACREDITACION AGUINALDO DICIEMBRE',
    ],
    counterExamples: [
      // Trabajo por cuenta propia: entra por factura, no por planilla.
      'PAGO DE FACTURA POR SERVICIOS DE CONSULTORIA',
      // Sale dinero: es el pago de sueldos de otro, no el cobro del propio.
      'PAGO DE PLANILLA A EMPLEADOS',
    ],
    restrictions: ['Debe ser un abono a favor del titular, no un pago que él realiza.'],
    relatedCategoryCodes: ['INGRESOS.INDEPENDIENTE'],
    acceptanceThreshold: 0.62,
  },
  {
    code: 'INGRESOS.INDEPENDIENTE',
    name: 'Trabajo independiente',
    description: 'Cobro por servicios propios facturados: honorarios, consultorías, ventas.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'COBRO FACTURA 0012 SERVICIOS PROFESIONALES',
      'PAGO DE HONORARIOS POR CONSULTORIA',
      'DEPOSITO CLIENTE POR VENTA DE MERCADERIA',
      'TRANSFERENCIA RECIBIDA PAGO DE TRABAJO FREELANCE',
    ],
    counterExamples: [
      'ABONO DE HABERES NOMINA JUNIO',
      'TRANSFERENCIA RECIBIDA DE FAMILIAR PARA GASTOS',
    ],
    restrictions: [
      'Debe corresponder a una contraprestación facturada, no a una ayuda ni a un préstamo.',
    ],
    relatedCategoryCodes: ['INGRESOS.SUELDO'],
    acceptanceThreshold: 0.65,
  },
  {
    code: 'INGRESOS.TRANSFERENCIA',
    name: 'Transferencia recibida',
    description:
      'Dinero recibido de otra persona o de una cuenta propia sin contraprestación: envíos, devoluciones, reembolsos.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'TRANSFERENCIA RECIBIDA DE JUAN PEREZ',
      'DEVOLUCION DE COMPRA ANULADA',
      'REEMBOLSO DE GASTOS DE VIAJE',
      'DEPOSITO EN EFECTIVO EN CAJA',
    ],
    counterExamples: [
      'COBRO FACTURA 0012 SERVICIOS PROFESIONALES',
      // Sale dinero: es el envío, no la recepción.
      'TRANSFERENCIA ENVIADA A TERCEROS',
    ],
    restrictions: ['Debe ser un abono; una transferencia enviada es un gasto.'],
    relatedCategoryCodes: ['INGRESOS.INDEPENDIENTE'],
    acceptanceThreshold: 0.6,
  },
  {
    code: 'INGRESOS.FINANCIERO',
    name: 'Rendimiento financiero',
    description:
      'Intereses, dividendos y rendimientos que la propia entidad acredita sobre saldos o inversiones.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO INTERESES CAJA DE AHORRO',
      'PAGO DE INTERESES DEPOSITO A PLAZO FIJO',
      'ACREDITACION RENDIMIENTO FONDO DE INVERSION',
    ],
    counterExamples: [
      // Es el sentido contrario: intereses que se pagan por un crédito.
      'COBRO DE INTERESES POR MORA PRESTAMO',
      'COMISION POR MANTENIMIENTO DE CUENTA',
    ],
    restrictions: ['Debe ser un interés a favor del titular, no uno cobrado por la entidad.'],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.COMISIONES'],
    acceptanceThreshold: 0.66,
  },

  // --- Gastos: vivienda -----------------------------------------------------
  rama('GASTOS.VIVIENDA', 'Vivienda', 'Gastos de mantener el lugar donde se vive.', 'GASTOS'),
  {
    code: 'GASTOS.VIVIENDA.ALQUILER',
    name: 'Alquiler',
    description: 'Pago periódico por el uso de una vivienda o un local que no es propiedad propia.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO ALQUILER DEPARTAMENTO MES DE JULIO',
      'TRANSFERENCIA POR ARRIENDO DE LOCAL COMERCIAL',
      'PAGO DE RENTA MENSUAL AL PROPIETARIO',
    ],
    counterExamples: [
      // Vivienda propia financiada: es deuda, no alquiler.
      'PAGO CUOTA PRESTAMO HIPOTECARIO',
      'PAGO DE EXPENSAS Y GASTOS COMUNES DEL EDIFICIO',
    ],
    restrictions: ['Excluye la cuota de un crédito de vivienda, que es amortización de deuda.'],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    acceptanceThreshold: 0.68,
  },
  {
    code: 'GASTOS.VIVIENDA.SERVICIOS',
    name: 'Servicios básicos',
    description: 'Luz, agua y gas domiciliarios facturados por la empresa proveedora.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO FACTURA DE ENERGIA ELECTRICA',
      'PAGO SERVICIO DE AGUA POTABLE Y ALCANTARILLADO',
      'PAGO DE GAS DOMICILIARIO',
    ],
    counterExamples: [
      // También es «servicio», pero de telecomunicaciones.
      'PAGO PLAN DE INTERNET FIBRA OPTICA',
      'PAGO DE EXPENSAS Y GASTOS COMUNES DEL EDIFICIO',
    ],
    restrictions: ['Excluye telefonía e internet, que tienen categoría propia.'],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.TELECOMUNICACIONES'],
    acceptanceThreshold: 0.66,
  },
  {
    code: 'GASTOS.VIVIENDA.TELECOMUNICACIONES',
    name: 'Internet y telefonía',
    description: 'Planes de internet, telefonía fija o móvil y televisión por cable.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO PLAN DE INTERNET FIBRA OPTICA',
      'RECARGA DE SALDO CELULAR',
      'PAGO FACTURA TELEFONIA MOVIL POSTPAGO',
      'PAGO DE TELEVISION POR CABLE',
    ],
    counterExamples: [
      'PAGO FACTURA DE ENERGIA ELECTRICA',
      // Es una suscripción de contenido, no la conexión.
      'PAGO SUSCRIPCION MENSUAL PLATAFORMA DE STREAMING',
    ],
    restrictions: [
      'Excluye las suscripciones de contenido, que se consumen a través de la conexión pero no son ella.',
    ],
    relatedCategoryCodes: ['GASTOS.OCIO.SUSCRIPCIONES'],
    acceptanceThreshold: 0.66,
  },

  // --- Gastos: alimentación -------------------------------------------------
  rama('GASTOS.ALIMENTACION', 'Alimentación', 'Compra y consumo de alimentos.', 'GASTOS'),
  {
    code: 'GASTOS.ALIMENTACION.SUPERMERCADO',
    name: 'Supermercado y mercado',
    description: 'Compra de alimentos y artículos del hogar para consumir en casa.',
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [
      'COMPRA EN SUPERMERCADO HIPERMAXI',
      'COMPRA DE VIVERES EN MERCADO',
      'COMPRA ABARROTES Y ARTICULOS DE LIMPIEZA',
    ],
    counterExamples: ['CONSUMO EN RESTAURANTE ALMUERZO', 'COMPRA EN FARMACIA MEDICAMENTOS'],
    restrictions: ['Debe ser compra para consumo posterior, no consumo en el local.'],
    relatedCategoryCodes: ['GASTOS.ALIMENTACION.RESTAURANTES'],
    acceptanceThreshold: 0.64,
  },
  {
    code: 'GASTOS.ALIMENTACION.RESTAURANTES',
    name: 'Restaurantes y delivery',
    description: 'Comida preparada: consumo en local, para llevar o a domicilio.',
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [
      'CONSUMO EN RESTAURANTE ALMUERZO',
      'PEDIDO DELIVERY DE COMIDA APP',
      'CONSUMO EN CAFETERIA',
      'PAGO EN PIZZERIA CENA',
    ],
    counterExamples: ['COMPRA EN SUPERMERCADO HIPERMAXI', 'COMPRA DE VIVERES EN MERCADO'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.ALIMENTACION.SUPERMERCADO'],
    acceptanceThreshold: 0.64,
  },

  // --- Gastos: transporte ---------------------------------------------------
  rama(
    'GASTOS.TRANSPORTE',
    'Transporte',
    'Desplazamiento de personas y vehículo propio.',
    'GASTOS',
  ),
  {
    code: 'GASTOS.TRANSPORTE.COMBUSTIBLE',
    name: 'Combustible y vehículo',
    description: 'Carburante, mantenimiento, seguro y trámites del vehículo propio.',
    parentCode: 'GASTOS.TRANSPORTE',
    positiveExamples: [
      'COMPRA DE GASOLINA EN SURTIDOR',
      'PAGO MANTENIMIENTO Y CAMBIO DE ACEITE',
      'PAGO SEGURO OBLIGATORIO SOAT',
      'PAGO DE INSPECCION TECNICA VEHICULAR',
    ],
    counterExamples: ['PAGO DE VIAJE EN TAXI', 'RECARGA TARJETA DE TRANSPORTE PUBLICO'],
    restrictions: ['Requiere vehículo propio; un viaje pagado a un tercero no lo es.'],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.PUBLICO'],
    acceptanceThreshold: 0.66,
  },
  {
    code: 'GASTOS.TRANSPORTE.PUBLICO',
    name: 'Transporte de terceros',
    description: 'Taxi, aplicaciones de viaje, micro, tren y pasajes interdepartamentales.',
    parentCode: 'GASTOS.TRANSPORTE',
    positiveExamples: [
      'PAGO DE VIAJE EN TAXI',
      'PAGO APP DE TRANSPORTE VIAJE',
      'COMPRA DE PASAJE INTERDEPARTAMENTAL',
      'RECARGA TARJETA DE TRANSPORTE PUBLICO',
    ],
    counterExamples: [
      'COMPRA DE GASOLINA EN SURTIDOR',
      // Un vuelo dentro de un viaje de placer pertenece a la rama de ocio.
      'COMPRA DE PASAJES AEREOS VACACIONES',
    ],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.COMBUSTIBLE', 'GASTOS.OCIO.VIAJES'],
    acceptanceThreshold: 0.64,
  },

  // --- Gastos: salud --------------------------------------------------------
  rama('GASTOS.SALUD', 'Salud', 'Atención médica y medicamentos.', 'GASTOS'),
  {
    code: 'GASTOS.SALUD.FARMACIA',
    name: 'Farmacia',
    description: 'Compra de medicamentos e insumos en farmacia.',
    parentCode: 'GASTOS.SALUD',
    positiveExamples: ['COMPRA EN FARMACIA MEDICAMENTOS', 'COMPRA DE INSUMOS MEDICOS Y VENDAS'],
    counterExamples: [
      'PAGO CONSULTA MEDICA ESPECIALISTA',
      'COMPRA ABARROTES Y ARTICULOS DE LIMPIEZA',
    ],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.SALUD.ATENCION'],
    acceptanceThreshold: 0.66,
  },
  {
    code: 'GASTOS.SALUD.ATENCION',
    name: 'Consultas y estudios',
    description:
      'Consultas médicas, odontología, laboratorio, estudios por imágenes y seguro de salud.',
    parentCode: 'GASTOS.SALUD',
    positiveExamples: [
      'PAGO CONSULTA MEDICA ESPECIALISTA',
      'PAGO LABORATORIO ANALISIS CLINICOS',
      'PAGO TRATAMIENTO ODONTOLOGICO',
      'PAGO DE SEGURO DE SALUD MENSUAL',
    ],
    counterExamples: ['COMPRA EN FARMACIA MEDICAMENTOS', 'PAGO SEGURO OBLIGATORIO SOAT'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.SALUD.FARMACIA'],
    acceptanceThreshold: 0.66,
  },

  // --- Gastos: educación ----------------------------------------------------
  {
    code: 'GASTOS.EDUCACION',
    name: 'Educación',
    description: 'Matrículas, pensiones, cursos, material de estudio y transporte escolar.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'PAGO PENSION ESCOLAR MES DE MAYO',
      'PAGO MATRICULA UNIVERSITARIA SEMESTRE',
      'PAGO CURSO DE INGLES',
      'COMPRA DE MATERIAL ESCOLAR Y LIBROS',
    ],
    counterExamples: [
      'PAGO SUSCRIPCION MENSUAL PLATAFORMA DE STREAMING',
      'COMPRA DE LIBRO DE NOVELA EN LIBRERIA',
    ],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: 0.66,
  },

  // --- Gastos: ocio ---------------------------------------------------------
  rama('GASTOS.OCIO', 'Ocio', 'Entretenimiento, cultura y viajes de placer.', 'GASTOS'),
  {
    code: 'GASTOS.OCIO.SUSCRIPCIONES',
    name: 'Suscripciones',
    description:
      'Cargos recurrentes por servicios digitales: streaming, música, almacenamiento, software.',
    parentCode: 'GASTOS.OCIO',
    positiveExamples: [
      'PAGO SUSCRIPCION MENSUAL PLATAFORMA DE STREAMING',
      'CARGO RECURRENTE SERVICIO DE MUSICA',
      'PAGO ANUAL ALMACENAMIENTO EN LA NUBE',
    ],
    counterExamples: ['PAGO PLAN DE INTERNET FIBRA OPTICA', 'PAGO CURSO DE INGLES'],
    restrictions: ['Excluye la conexión a internet, que es el medio y no el contenido.'],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.TELECOMUNICACIONES'],
    acceptanceThreshold: 0.66,
  },
  {
    code: 'GASTOS.OCIO.VIAJES',
    name: 'Viajes y turismo',
    description: 'Pasajes aéreos, hotelería, agencias y excursiones de un viaje de placer.',
    parentCode: 'GASTOS.OCIO',
    positiveExamples: [
      'COMPRA DE PASAJES AEREOS VACACIONES',
      'PAGO RESERVA DE HOTEL',
      'PAGO AGENCIA DE VIAJES PAQUETE TURISTICO',
    ],
    counterExamples: ['COMPRA DE PASAJE INTERDEPARTAMENTAL', 'PAGO DE VIAJE EN TAXI'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.PUBLICO'],
    acceptanceThreshold: 0.66,
  },

  // --- Gastos: financieros --------------------------------------------------
  rama('GASTOS.FINANCIEROS', 'Gastos financieros', 'Lo que cuesta el propio dinero.', 'GASTOS'),
  {
    code: 'GASTOS.FINANCIEROS.COMISIONES',
    name: 'Comisiones bancarias',
    description: 'Cargos que la entidad cobra por mantener u operar la cuenta.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'COMISION POR MANTENIMIENTO DE CUENTA',
      'COMISION POR TRANSFERENCIA INTERBANCARIA',
      'COBRO DE COMISION POR USO DE CAJERO',
      'COMISION ANUAL TARJETA DE CREDITO',
    ],
    counterExamples: ['PAGO CUOTA PRESTAMO PERSONAL', 'ABONO INTERESES CAJA DE AHORRO'],
    restrictions: [
      'Excluye la amortización de deuda, que devuelve capital en lugar de retribuir un servicio.',
    ],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    acceptanceThreshold: 0.68,
  },
  {
    code: 'GASTOS.FINANCIEROS.PRESTAMOS',
    name: 'Préstamos y tarjetas',
    description: 'Cuotas de crédito, amortizaciones e intereses de deuda contraída.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'PAGO CUOTA PRESTAMO PERSONAL',
      'PAGO CUOTA PRESTAMO HIPOTECARIO',
      'PAGO ESTADO DE CUENTA TARJETA DE CREDITO',
      'COBRO DE INTERESES POR MORA PRESTAMO',
    ],
    counterExamples: [
      'COMISION POR MANTENIMIENTO DE CUENTA',
      'PAGO ALQUILER DEPARTAMENTO MES DE JULIO',
    ],
    restrictions: [
      'Debe corresponder a una deuda del titular, no a una comisión por un servicio puntual.',
    ],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.COMISIONES', 'GASTOS.VIVIENDA.ALQUILER'],
    acceptanceThreshold: 0.68,
  },

  // --- Gastos: impuestos ----------------------------------------------------
  {
    code: 'GASTOS.IMPUESTOS',
    name: 'Impuestos y tasas',
    description: 'Tributos, patentes y tasas pagados al Estado o al municipio.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'PAGO IMPUESTO A LA PROPIEDAD DE INMUEBLES',
      'PAGO IMPUESTO AL VALOR AGREGADO IVA',
      'PAGO DE PATENTE MUNICIPAL',
      'PAGO IMPUESTO A LA PROPIEDAD DE VEHICULOS',
    ],
    counterExamples: ['COMISION POR MANTENIMIENTO DE CUENTA', 'PAGO SEGURO OBLIGATORIO SOAT'],
    restrictions: ['Debe ser un tributo, no un servicio contratado a un privado.'],
    relatedCategoryCodes: [],
    // El umbral más alto junto con los financieros: una clasificación errónea
    // aquí distorsiona la declaración, no sólo un informe de gasto doméstico.
    acceptanceThreshold: 0.7,
  },
];

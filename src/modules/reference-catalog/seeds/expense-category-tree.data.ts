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
 * ## Los ejemplos tienen la forma de una glosa, no de una frase
 *
 * Un extracto no escribe «pago de la factura de energía eléctrica»: escribe
 * `PAGO SERVICIO ELECTRICO`, `PAGO LUZ ELECTROPAZ`, `DEBITO AUTOM ELECTRICIDAD`.
 * Cuando los ejemplos estaban redactados en prosa larga, el parecido con la
 * línea real se diluía en las palabras que la prosa añade y la línea no trae, y
 * movimientos evidentes —internet, luz, intereses, una transferencia recibida—
 * salían SIN DETERMINAR. Por eso cada hoja lleva ahora ejemplos cortos, en
 * mayúsculas y abreviados como el banco los imprime, junto a alguno más largo
 * para los extractos que sí describen.
 *
 * **Lo que NO se siembra es el ruido de los datos de prueba.** Las glosas
 * generadas por QA acaban en `TEST`, `DEMO`, `QA`, `PRUEBA` o `SIMULADO`; meter
 * esas palabras aquí ensuciaría el catálogo de producción para arreglar un
 * artefacto del generador. La glosa limpia casa igual con el sufijo puesto.
 *
 * ## Al tocar este archivo hay que recalibrar
 *
 * Los umbrales del adaptador de transformers (`SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR`
 * y compañía) son valores de coseno MEDIDOS sobre este árbol concreto, no
 * constantes del dominio: el `.env` del motor anota la medición que los respalda.
 * Añadir hojas mueve la frontera entre acierto y abstención, así que después de
 * cambiar el catálogo hay que volver a correr:
 *
 *     node scripts/semantic-calibration.mjs
 *
 * y ajustar el suelo a lo que salga. Sembrar un catálogo más rico con umbrales
 * calibrados para el anterior puede empeorar la precisión aunque el catálogo sea
 * mejor.
 */

import { bankDialectExamples } from './bank-dialect.data';
import { bolivianMerchantExamples } from './bolivian-merchants.data';
import { businessCategories } from './business-categories.data';
import { financialCategories } from './financial-categories.data';
import { glosaVocabularyExamples, glosaVocabularyExtraExamples } from './glosa-vocabulary.data';
import { householdCategories } from './household-categories.data';
import { statementCategories, statementVocabularyExamples } from './statement-vocabulary.data';

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

/**
 * Umbrales por familia.
 *
 * No son preferencias: describen qué cuesta equivocarse. Confundir dos gastos
 * domésticos desordena un informe; confundir un tributo o una amortización de
 * deuda distorsiona una declaración o un cálculo de capacidad de pago, así que
 * esos exigen más parecido antes de aceptar.
 */
const CORRIENTE = 0.62;
const SENSIBLE = 0.68;

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

const curatedTree: readonly SemanticCategorySeed[] = [
  rama('INGRESOS', 'Ingresos', 'Dinero que entra en la cuenta.', null),
  rama('GASTOS', 'Gastos', 'Dinero que sale de la cuenta.', null),

  // ==========================================================================
  // Ingresos
  // ==========================================================================
  {
    code: 'INGRESOS.SUELDO',
    name: 'Sueldo',
    description: 'Remuneración periódica de una relación laboral, acreditada por el empleador.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO NOMINA',
      'ABONO NOMINA EMPRESA',
      'ABONO DE HABERES',
      'DEPOSITO PLANILLA SALARIAL',
      'PAGO SUELDO MENSUAL',
      'ACREDITACION AGUINALDO',
      'ABONO DE HABERES NOMINA JUNIO',
      'DEPOSITO PLANILLA SALARIAL QUINCENA',
    ],
    counterExamples: [
      // Trabajo por cuenta propia: entra por factura, no por planilla.
      'PAGO DE FACTURA POR SERVICIOS DE CONSULTORIA',
      // Sale dinero: es el pago de sueldos de otro, no el cobro del propio.
      'PAGO DE PLANILLA A EMPLEADOS',
    ],
    restrictions: ['Debe ser un abono a favor del titular, no un pago que él realiza.'],
    relatedCategoryCodes: ['INGRESOS.INDEPENDIENTE'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.INDEPENDIENTE',
    name: 'Trabajo independiente',
    description: 'Cobro por servicios propios facturados: honorarios, consultorías, ventas.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'COBRO FACTURA SERVICIOS',
      'PAGO HONORARIOS CONSULTORIA',
      'DEPOSITO CLIENTE VENTA MERCADERIA',
      'ABONO PAGO TRABAJO FREELANCE',
      'COBRO FACTURA 0012 SERVICIOS PROFESIONALES',
    ],
    counterExamples: ['ABONO NOMINA EMPRESA', 'TRANSFERENCIA RECIBIDA DE FAMILIAR PARA GASTOS'],
    restrictions: [
      'Debe corresponder a una contraprestación facturada, no a una ayuda ni a un préstamo.',
    ],
    relatedCategoryCodes: ['INGRESOS.SUELDO'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.TRANSFERENCIA',
    name: 'Transferencia recibida',
    description: 'Dinero recibido de otra persona o de una cuenta propia, sin contraprestación.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO TRANSFERENCIA RECIBIDA',
      'TRANSFERENCIA RECIBIDA',
      'TRANSF RECIBIDA',
      'ABONO POR TRANSFERENCIA DE TERCEROS',
      'TRANSFERENCIA INTERBANCARIA RECIBIDA',
      'TRANSFERENCIA RECIBIDA DE JUAN PEREZ',
    ],
    counterExamples: [
      'COBRO FACTURA SERVICIOS',
      // Sale dinero: es el envío, no la recepción.
      'TRANSFERENCIA SALIENTE',
      // La devolución de una compra tiene hoja propia.
      'DEVOLUCION COMPRA',
    ],
    restrictions: ['Debe ser un abono; una transferencia enviada es un gasto.'],
    relatedCategoryCodes: ['INGRESOS.REVERSO', 'GASTOS.TRANSFERENCIAS'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.REMESA',
    name: 'Remesa del exterior',
    description: 'Envío de dinero desde otro país, normalmente de un familiar que reside fuera.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO REMESA DEL EXTERIOR',
      'PAGO REMESA FAMILIAR',
      'ABONO GIRO INTERNACIONAL',
      'COBRO REMESA WESTERN UNION',
      'ABONO TRANSFERENCIA DEL EXTERIOR EN DOLARES',
    ],
    counterExamples: ['ABONO TRANSFERENCIA RECIBIDA', 'COBRO FACTURA SERVICIOS'],
    restrictions: ['Debe provenir del exterior; un envío local es una transferencia recibida.'],
    relatedCategoryCodes: ['INGRESOS.TRANSFERENCIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.EFECTIVO',
    name: 'Depósito en efectivo',
    description: 'Ingreso de billetes en caja, cajero o corresponsal, sin origen bancario previo.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'DEPOSITO EN EFECTIVO',
      'DEPOSITO EFECTIVO CAJA',
      'DEPOSITO EN VENTANILLA',
      'ABONO DEPOSITO CAJERO AUTOMATICO',
      'DEPOSITO EN EFECTIVO EN CAJA',
    ],
    counterExamples: [
      'ABONO TRANSFERENCIA RECIBIDA',
      'RETIRO EN EFECTIVO CAJERO',
      // Un cheque no es efectivo: entra por compensación y tiene hoja propia.
      'DEPOSITO CHEQUE',
    ],
    restrictions: ['Debe ser una entrada de efectivo; el retiro es un gasto.'],
    relatedCategoryCodes: ['GASTOS.EFECTIVO', 'INGRESOS.CHEQUE'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.CHEQUE',
    name: 'Depósito de cheque',
    description:
      'Cheque depositado en la cuenta, propio o de un tercero, que se acredita al compensarse.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'DEPOSITO CHEQUE',
      'DEPOSITO CHEQUE REF',
      'ABONO CHEQUE COMPENSADO',
      'DEPOSITO DE CHEQUE AJENO',
      'COBRO DE CHEQUE EN VENTANILLA',
      'ABONO POR CANJE DE CHEQUE',
    ],
    counterExamples: [
      // El efectivo se acredita en el acto; el cheque, al compensarse.
      'DEPOSITO EN EFECTIVO',
      'ABONO TRANSFERENCIA RECIBIDA',
      // Sale dinero: es el cheque que el titular giró, no el que recibe.
      'PAGO CON CHEQUE PROPIO',
    ],
    restrictions: [
      'Debe ser un abono por un cheque recibido; el cheque girado por el titular es un gasto.',
    ],
    relatedCategoryCodes: ['INGRESOS.EFECTIVO', 'INGRESOS.TRANSFERENCIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.FINANCIERO',
    name: 'Rendimiento financiero',
    description:
      'Intereses, dividendos y rendimientos que la propia entidad acredita sobre saldos o inversiones.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'INTERES GANADO',
      'ABONO INTERESES',
      'ABONO INTERES CAJA DE AHORRO',
      'PAGO INTERESES DEPOSITO A PLAZO FIJO',
      'ACREDITACION RENDIMIENTO FONDO DE INVERSION',
      'ABONO DIVIDENDOS',
    ],
    counterExamples: [
      // Es el sentido contrario: intereses que se pagan por un crédito.
      'COBRO DE INTERESES POR MORA PRESTAMO',
      'COMISION MANTENIMIENTO DE CUENTA',
    ],
    restrictions: ['Debe ser un interés a favor del titular, no uno cobrado por la entidad.'],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.COMISIONES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.REVERSO',
    name: 'Reversos y devoluciones',
    description:
      'Dinero que vuelve a la cuenta por corregir un cargo: anulaciones, duplicados y devoluciones de compra.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'REVERSO DEBITO DUPLICADO',
      'REVERSO DE CARGO',
      'ANULACION DE COMPRA',
      'DEVOLUCION COMPRA',
      'DEVOLUCION DE COMPRA ANULADA',
      'AJUSTE A FAVOR DEL CLIENTE',
      'REINTEGRO POR RECLAMO',
    ],
    counterExamples: [
      'ABONO TRANSFERENCIA RECIBIDA',
      'ABONO INTERESES',
      /*
       * Un asiento interno del banco no es una devolución al cliente, y hay que
       * decirlo porque se parecen mucho una vez que el normalizador retira el
       * número de referencia: `AJUSTE CONTABLE INTERNO 99213` se queda en
       * `AJUSTE CONTABLE INTERNO`, que sin este contraejemplo casaba al 100 %
       * con `AJUSTE A FAVOR DEL CLIENTE`. La línea no dice a favor de quién es,
       * así que lo correcto es abstenerse.
       */
      'AJUSTE CONTABLE INTERNO',
      'ASIENTO CONTABLE DE REGULARIZACION',
    ],
    restrictions: [
      'Corrige un movimiento anterior de la propia cuenta; no es dinero nuevo que entra.',
    ],
    relatedCategoryCodes: ['INGRESOS.TRANSFERENCIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.PRESTAMO',
    name: 'Desembolso de crédito',
    description:
      'Dinero acreditado por la entidad al conceder un préstamo. Es deuda, no ingreso propio.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'DESEMBOLSO PRESTAMO',
      'ABONO DESEMBOLSO CREDITO',
      'ACREDITACION PRESTAMO PERSONAL',
      'DESEMBOLSO CREDITO DE CONSUMO',
    ],
    counterExamples: ['ABONO NOMINA EMPRESA', 'PAGO CUOTA PRESTAMO PERSONAL'],
    restrictions: ['No debe tratarse como capacidad de pago: entra hoy y se devuelve en cuotas.'],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    acceptanceThreshold: SENSIBLE,
  },
  {
    code: 'INGRESOS.ALQUILER',
    name: 'Alquiler cobrado',
    description: 'Renta que el titular cobra por ceder el uso de un inmueble propio.',
    parentCode: 'INGRESOS',
    /*
     * Ninguno lleva la palabra PAGO, y no es estilo: es la corrección de un
     * defecto medido.
     *
     * Había aquí un `ABONO PAGO ALQUILER DEPARTAMENTO` que contiene, letra por
     * letra, el contraejemplo de dos líneas más abajo. La hoja se contradecía a
     * sí misma: «PAGO ALQUILER DEPARTAMENTO AGOSTO» —un gasto evidente— sacaba
     * 0,9219 contra este ingreso y 0,9271 contra el alquiler pagado, cinco
     * milésimas de diferencia. Ni el margen de contradicción (0,02) llegaba a
     * descartarlo ni el reparto de confianza dejaba al ganador por encima de su
     * umbral, así que el movimiento salía SIN DETERMINAR con la categoría
     * correcta delante.
     */
    positiveExamples: [
      'ABONO ALQUILER INQUILINO',
      'COBRO DE RENTA MENSUAL',
      'DEPOSITO ARRIENDO LOCAL',
      'ABONO POR ALQUILER DE DEPARTAMENTO',
      'ABONO RENTA DEPARTAMENTO INQUILINO',
    ],
    // El mismo concepto en el otro sentido: aquí se cobra, allí se paga.
    counterExamples: [
      'PAGO ALQUILER DEPARTAMENTO',
      'PAGO DE RENTA MENSUAL AL PROPIETARIO',
      'PAGO ALQUILER DEPARTAMENTO AGOSTO',
    ],
    restrictions: ['Debe ser un abono a favor del titular como arrendador.'],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.ALQUILER'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.SUBSIDIO',
    name: 'Bonos y subsidios',
    description: 'Prestaciones del Estado y beneficios sociales acreditados en la cuenta.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO RENTA DIGNIDAD',
      'PAGO BONO JUANCITO PINTO',
      'ABONO BONO JUANA AZURDUY',
      'ACREDITACION SUBSIDIO ESTATAL',
      'PAGO DE RENTA JUBILACION',
    ],
    counterExamples: ['ABONO NOMINA EMPRESA', 'ABONO TRANSFERENCIA RECIBIDA'],
    restrictions: [],
    relatedCategoryCodes: ['INGRESOS.SUELDO'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'INGRESOS.VENTA',
    name: 'Venta de bienes',
    description: 'Producto de vender un bien propio: vehículo, inmueble, maquinaria.',
    parentCode: 'INGRESOS',
    positiveExamples: [
      'ABONO VENTA DE VEHICULO',
      'DEPOSITO POR VENTA DE INMUEBLE',
      'COBRO VENTA DE MAQUINARIA',
    ],
    counterExamples: ['DEPOSITO CLIENTE VENTA MERCADERIA', 'ABONO NOMINA EMPRESA'],
    restrictions: ['Es la venta de un activo propio, no la actividad comercial habitual.'],
    relatedCategoryCodes: ['INGRESOS.INDEPENDIENTE'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: vivienda
  // ==========================================================================
  rama('GASTOS.VIVIENDA', 'Vivienda', 'Gastos de mantener el lugar donde se vive.', 'GASTOS'),
  {
    code: 'GASTOS.VIVIENDA.ALQUILER',
    name: 'Alquiler',
    description: 'Pago periódico por el uso de una vivienda o un local que no es propiedad propia.',
    parentCode: 'GASTOS.VIVIENDA',
    /*
     * Los dos últimos llevan el mes escrito, y hacen falta por una razón que no
     * se ve leyendo el catálogo: el normalizador despliega los alias antes de
     * medir, y `BS` es uno de ellos. «PAGO ALQUILER DEPARTAMENTO MES DE JULIO
     * BS 2.800,00» llega al clasificador como «… MES DE JULIO Boliviano
     * 2.800,00», y esa palabra de más baja el parecido de 0,9137 a 0,8946 —lo
     * suficiente para quedarse en 0,651 de confianza contra el umbral 0,68 de
     * esta hoja, que es alta a propósito—. Con la línea larga sembrada, el
     * importe deja de ser ruido. Es el mismo remedio que el catálogo prescribe
     * en su cabecera: ejemplos cortos como la glosa Y alguno largo como los
     * extractos que sí describen.
     */
    positiveExamples: [
      'PAGO ALQUILER',
      'PAGO ALQUILER DEPARTAMENTO',
      'PAGO ARRIENDO LOCAL COMERCIAL',
      'PAGO DE RENTA MENSUAL AL PROPIETARIO',
      'PAGO ALQUILER DEPARTAMENTO MES DE JULIO',
      'PAGO ALQUILER MENSUAL VIVIENDA',
    ],
    counterExamples: [
      // Vivienda propia financiada: es deuda, no alquiler.
      'PAGO CUOTA PRESTAMO HIPOTECARIO',
      'PAGO EXPENSAS EDIFICIO',
      'ABONO ALQUILER INQUILINO',
    ],
    restrictions: ['Excluye la cuota de un crédito de vivienda, que es amortización de deuda.'],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.PRESTAMOS', 'INGRESOS.ALQUILER'],
    acceptanceThreshold: SENSIBLE,
  },
  {
    code: 'GASTOS.VIVIENDA.SERVICIOS',
    name: 'Servicios básicos',
    description: 'Luz, agua y gas domiciliarios facturados por la empresa proveedora.',
    parentCode: 'GASTOS.VIVIENDA',
    /*
     * `PAGO SERVICIOS`, a secas, vive aquí por una razón del dominio, no por
     * descarte: es la etiqueta con la que la banca boliviana imprime el pago
     * hecho en su ventanilla o app de «pago de servicios», que es luz, agua,
     * gas y teléfono. Sin ella, `PAGO SERVICIOS (CUOTA 3)` repartía su parecido
     * entre ocho hojas separadas por tres centésimas —expensas, profesionales,
     * proveedores, suscripciones, mantenimiento…— y ninguna alcanzaba su umbral,
     * de modo que un movimiento con rubro identificable salía SIN DETERMINAR.
     */
    positiveExamples: [
      'PAGO SERVICIOS',
      'PAGO DE SERVICIOS',
      'PAGO SERVICIO ELECTRICO',
      'PAGO LUZ',
      'PAGO ENERGIA ELECTRICA',
      'PAGO SERVICIO DE AGUA',
      'PAGO AGUA POTABLE Y ALCANTARILLADO',
      'PAGO GAS DOMICILIARIO',
      'DEBITO AUTOMATICO SERVICIO ELECTRICO',
    ],
    counterExamples: [
      // También es «servicio», pero de telecomunicaciones.
      'PAGO SERVICIO INTERNET',
      'PAGO EXPENSAS EDIFICIO',
      // «Servicios» de un profesional o de un proveedor: la palabra es la misma
      // y el rubro no, así que la frontera se escribe en las dos direcciones.
      'PAGO SERVICIO DE CONTABILIDAD',
      'PAGO PROVEEDOR SERVICIOS GENERALES',
    ],
    restrictions: [
      'Excluye telefonía e internet, que tienen categoría propia, y los servicios de un profesional o un proveedor.',
    ],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.TELECOMUNICACIONES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.VIVIENDA.TELECOMUNICACIONES',
    name: 'Internet y telefonía',
    description: 'Planes de internet, telefonía fija o móvil y televisión por cable.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO SERVICIO INTERNET',
      'PAGO INTERNET FIBRA OPTICA',
      'PAGO PLAN DE INTERNET',
      'RECARGA SALDO CELULAR',
      'PAGO TELEFONIA MOVIL POSTPAGO',
      'PAGO TELEVISION POR CABLE',
    ],
    counterExamples: [
      'PAGO SERVICIO ELECTRICO',
      // Es una suscripción de contenido, no la conexión.
      'PAGO SUSCRIPCION STREAMING',
    ],
    restrictions: [
      'Excluye las suscripciones de contenido, que se consumen a través de la conexión pero no son ella.',
    ],
    relatedCategoryCodes: ['GASTOS.OCIO.SUSCRIPCIONES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.VIVIENDA.EXPENSAS',
    name: 'Expensas y gastos comunes',
    description:
      'Cuota de administración del edificio o condominio: portería, ascensor, áreas comunes.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO EXPENSAS EDIFICIO',
      'PAGO GASTOS COMUNES CONDOMINIO',
      'PAGO CUOTA ADMINISTRACION EDIFICIO',
    ],
    counterExamples: ['PAGO ALQUILER DEPARTAMENTO', 'PAGO SERVICIO ELECTRICO'],
    restrictions: ['No es el alquiler ni un servicio individual medido por consumo.'],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.ALQUILER'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.VIVIENDA.MANTENIMIENTO',
    name: 'Mantenimiento del hogar',
    description: 'Reparaciones, obra menor, materiales y servicios de arreglo de la vivienda.',
    parentCode: 'GASTOS.VIVIENDA',
    positiveExamples: [
      'PAGO SERVICIO DE PLOMERIA',
      'COMPRA MATERIALES DE CONSTRUCCION',
      'PAGO TRABAJO DE ALBANILERIA',
      'PAGO SERVICIO ELECTRICISTA DOMICILIO',
      'COMPRA EN FERRETERIA',
    ],
    counterExamples: ['PAGO SERVICIO ELECTRICO', 'COMPRA DE MUEBLES PARA EL HOGAR'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.COMPRAS.HOGAR'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: alimentación
  // ==========================================================================
  rama('GASTOS.ALIMENTACION', 'Alimentación', 'Compra y consumo de alimentos.', 'GASTOS'),
  {
    code: 'GASTOS.ALIMENTACION.SUPERMERCADO',
    name: 'Supermercado y mercado',
    description: 'Compra de alimentos y artículos del hogar para consumir en casa.',
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [
      'COMPRA SUPERMERCADO',
      'COMPRA EN SUPERMERCADO HIPERMAXI',
      'COMPRA DE VIVERES EN MERCADO',
      'COMPRA ABARROTES',
      'COMPRA ARTICULOS DE LIMPIEZA',
    ],
    counterExamples: ['CONSUMO EN RESTAURANTE', 'COMPRA EN FARMACIA'],
    restrictions: ['Debe ser compra para consumo posterior, no consumo en el local.'],
    relatedCategoryCodes: ['GASTOS.ALIMENTACION.RESTAURANTES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.ALIMENTACION.RESTAURANTES',
    name: 'Restaurantes y delivery',
    description: 'Comida preparada: consumo en local, para llevar o a domicilio.',
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [
      'CONSUMO EN RESTAURANTE',
      'CONSUMO RESTAURANTE ALMUERZO',
      'PEDIDO DELIVERY DE COMIDA',
      'PAGO EN PIZZERIA',
      'CONSUMO EN CHURRASQUERIA',
      'PEDIDO DE COMIDA RAPIDA',
    ],
    counterExamples: [
      'COMPRA SUPERMERCADO',
      'COMPRA DE VIVERES EN MERCADO',
      // Un café o una panadería tienen hoja propia: el ticket medio y la
      // frecuencia no se parecen a los de una comida, y separarlos es lo que
      // hace útil un informe de gasto en alimentación.
      'CONSUMO EN CAFETERIA',
      'COMPRA EN PANADERIA',
    ],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.ALIMENTACION.SUPERMERCADO', 'GASTOS.ALIMENTACION.CAFETERIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.ALIMENTACION.CAFETERIA',
    name: 'Cafeterías y panaderías',
    description:
      'Café, panadería, heladería y repostería: consumo pequeño y frecuente, distinto de una comida.',
    parentCode: 'GASTOS.ALIMENTACION',
    positiveExamples: [
      'CONSUMO EN CAFETERIA',
      'COMPRA EN PANADERIA',
      'COMPRA EN HELADERIA',
      'CONSUMO CAFE',
      'COMPRA DE REPOSTERIA',
    ],
    /*
     * Separada de Restaurantes por una razón de informe, no de gusto: son
     * decenas de cargos pequeños al mes frente a unos pocos grandes, y mezclarlos
     * hace que «Restaurantes» deje de decir nada sobre cuánto se sale a comer.
     */
    counterExamples: ['CONSUMO EN RESTAURANTE', 'PEDIDO DELIVERY DE COMIDA', 'COMPRA SUPERMERCADO'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.ALIMENTACION.RESTAURANTES'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: transporte
  // ==========================================================================
  rama(
    'GASTOS.TRANSPORTE',
    'Transporte',
    'Desplazamiento de personas y vehículo propio.',
    'GASTOS',
  ),
  {
    code: 'GASTOS.TRANSPORTE.COMBUSTIBLE',
    name: 'Combustible',
    description: 'Carburante del vehículo propio: gasolina, diésel y gas natural vehicular.',
    parentCode: 'GASTOS.TRANSPORTE',
    /*
     * Esta hoja prometía «carburante, mantenimiento, seguro y trámites», y eran
     * cuatro hechos distintos con un mismo vector: el promedio de los cuatro no
     * describe bien a ninguno, y el informe no podía separar lo que se va en
     * gasolina de lo que se va en el taller. El taller, el SOAT y la inspección
     * técnica viven ahora en hojas propias —`TALLER`, `SEGURO`, `TRAMITES`— y
     * aquí quedan como contraejemplo, que es lo que impide que vuelvan.
     *
     * El SOAT se movió CON su forma desplegada, y esa duplicación no es un
     * descuido: el normalizador sustituye los alias del catálogo de entidades
     * antes de medir, así que «PAGO SEGURO OBLIGATORIO SOAT» llega al
     * clasificador como «PAGO SEGURO OBLIGATORIO Seguro Obligatorio de
     * Accidentes de Tránsito». La sigla —la única palabra que ataba la línea a
     * un vehículo— desaparece, y sin el ejemplo desplegado el seguro genérico
     * gana y el movimiento sale SIN DETERMINAR.
     */
    positiveExamples: ['COMPRA GASOLINA SURTIDOR', 'CARGA DE COMBUSTIBLE'],
    counterExamples: [
      'PAGO VIAJE EN TAXI',
      'RECARGA TARJETA TRANSPORTE PUBLICO',
      'PAGO MANTENIMIENTO VEHICULO',
      'PAGO SEGURO OBLIGATORIO SOAT',
      'PAGO INSPECCION TECNICA VEHICULAR',
    ],
    restrictions: ['Requiere vehículo propio; un viaje pagado a un tercero no lo es.'],
    relatedCategoryCodes: [
      'GASTOS.TRANSPORTE.PUBLICO',
      'GASTOS.TRANSPORTE.TALLER',
      'GASTOS.TRANSPORTE.SEGURO',
      'GASTOS.TRANSPORTE.TRAMITES',
    ],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.TRANSPORTE.PUBLICO',
    name: 'Transporte de terceros',
    description: 'Taxi, aplicaciones de viaje, micro, tren y pasajes interdepartamentales.',
    parentCode: 'GASTOS.TRANSPORTE',
    positiveExamples: [
      'PAGO VIAJE EN TAXI',
      'PAGO APP DE TRANSPORTE',
      'COMPRA PASAJE INTERDEPARTAMENTAL',
      'RECARGA TARJETA TRANSPORTE PUBLICO',
      'PAGO PASAJE BUS',
    ],
    counterExamples: [
      'COMPRA GASOLINA SURTIDOR',
      // Un vuelo dentro de un viaje de placer pertenece a la rama de ocio.
      'COMPRA PASAJES AEREOS VACACIONES',
    ],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.COMBUSTIBLE', 'GASTOS.OCIO.VIAJES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.TRANSPORTE.ESTACIONAMIENTO',
    name: 'Estacionamiento y peajes',
    description: 'Parqueo, garaje de alquiler y peajes de carretera.',
    parentCode: 'GASTOS.TRANSPORTE',
    positiveExamples: [
      'PAGO ESTACIONAMIENTO',
      'PAGO PARQUEO VEHICULO',
      'PAGO PEAJE CARRETERA',
      'PAGO GARAJE MENSUAL',
    ],
    counterExamples: ['COMPRA GASOLINA SURTIDOR', 'PAGO VIAJE EN TAXI'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.COMBUSTIBLE'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: salud
  // ==========================================================================
  rama('GASTOS.SALUD', 'Salud', 'Atención médica y medicamentos.', 'GASTOS'),
  {
    code: 'GASTOS.SALUD.FARMACIA',
    name: 'Farmacia',
    description: 'Compra de medicamentos e insumos en farmacia.',
    parentCode: 'GASTOS.SALUD',
    positiveExamples: [
      'COMPRA EN FARMACIA',
      'COMPRA MEDICAMENTOS',
      'COMPRA INSUMOS MEDICOS',
      'PAGO FARMACIA CHAVEZ',
    ],
    counterExamples: ['PAGO CONSULTA MEDICA', 'COMPRA ABARROTES'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.SALUD.ATENCION'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.SALUD.ATENCION',
    name: 'Consultas y estudios',
    description: 'Consultas médicas, odontología, laboratorio e internación.',
    parentCode: 'GASTOS.SALUD',
    // La prima de un seguro de salud se pagaba aquí y no es lo mismo: una
    // consulta se paga por atenderse y una prima por estar cubierto, esté uno
    // sano o enfermo. Vive en `GASTOS.SALUD.SEGURO` y aquí queda de contraejemplo.
    positiveExamples: [
      'PAGO CONSULTA MEDICA',
      'PAGO LABORATORIO ANALISIS CLINICOS',
      'PAGO TRATAMIENTO ODONTOLOGICO',
      'PAGO CLINICA INTERNACION',
    ],
    counterExamples: ['COMPRA EN FARMACIA', 'PAGO SEGURO OBLIGATORIO SOAT', 'PAGO SEGURO DE SALUD'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.SALUD.FARMACIA', 'GASTOS.SALUD.SEGURO'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: educación
  // ==========================================================================
  {
    code: 'GASTOS.EDUCACION',
    name: 'Educación',
    description: 'Matrículas, pensiones, cursos, material de estudio y transporte escolar.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'PAGO PENSION ESCOLAR',
      'PAGO MATRICULA UNIVERSITARIA',
      'PAGO CURSO DE INGLES',
      'COMPRA MATERIAL ESCOLAR',
      'PAGO COLEGIATURA',
    ],
    counterExamples: ['PAGO SUSCRIPCION STREAMING', 'COMPRA DE LIBRO DE NOVELA EN LIBRERIA'],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: ocio
  // ==========================================================================
  rama('GASTOS.OCIO', 'Ocio', 'Entretenimiento, cultura y viajes de placer.', 'GASTOS'),
  {
    code: 'GASTOS.OCIO.SUSCRIPCIONES',
    name: 'Suscripciones',
    description:
      'Cargos recurrentes por servicios digitales: streaming, música, almacenamiento, software.',
    parentCode: 'GASTOS.OCIO',
    positiveExamples: [
      'PAGO SUSCRIPCION',
      'PAGO SUSCRIPCION SOFTWARE',
      'PAGO SUSCRIPCION STREAMING',
      'CARGO RECURRENTE SERVICIO DE MUSICA',
      'PAGO ANUAL ALMACENAMIENTO EN LA NUBE',
      'PAGO LICENCIA SOFTWARE MENSUAL',
    ],
    counterExamples: ['PAGO SERVICIO INTERNET', 'PAGO CURSO DE INGLES'],
    restrictions: ['Excluye la conexión a internet, que es el medio y no el contenido.'],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.TELECOMUNICACIONES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.OCIO.VIAJES',
    name: 'Viajes y turismo',
    description: 'Pasajes aéreos, hotelería, agencias y excursiones de un viaje de placer.',
    parentCode: 'GASTOS.OCIO',
    positiveExamples: [
      'COMPRA PASAJES AEREOS',
      'PAGO RESERVA DE HOTEL',
      'PAGO AGENCIA DE VIAJES',
      'PAGO PAQUETE TURISTICO',
    ],
    counterExamples: ['COMPRA PASAJE INTERDEPARTAMENTAL', 'PAGO VIAJE EN TAXI'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.PUBLICO'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.OCIO.EVENTOS',
    name: 'Eventos y espectáculos',
    description: 'Cine, conciertos, teatro, entradas deportivas y salidas de entretenimiento.',
    parentCode: 'GASTOS.OCIO',
    positiveExamples: [
      'COMPRA ENTRADA CINE',
      'PAGO ENTRADAS CONCIERTO',
      'COMPRA ENTRADA PARTIDO FUTBOL',
      'PAGO EVENTO TEATRO',
    ],
    counterExamples: ['PAGO SUSCRIPCION STREAMING', 'CONSUMO EN RESTAURANTE'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.OCIO.SUSCRIPCIONES'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: compras
  //
  // La rama que faltaba. Un extracto boliviano imprime muchísimas líneas que
  // sólo dicen CÓMO se pagó —`PAGO QR COMERCIO`, `COMPRA TARJETA POS`— sin decir
  // qué se compró. Sin una hoja para ellas, todas salían SIN DETERMINAR; con
  // ella se clasifican por el canal, que es la única verdad que la línea trae.
  // ==========================================================================
  rama('GASTOS.COMPRAS', 'Compras', 'Consumo en comercios, por el canal o por el rubro.', 'GASTOS'),
  {
    code: 'GASTOS.COMPRAS.TARJETA',
    name: 'Compra con tarjeta',
    description:
      'Consumo en comercio pagado con tarjeta de débito o crédito, sin que la glosa diga el rubro.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'COMPRA TARJETA POS',
      'CONSUMO TARJETA DE DEBITO',
      'COMPRA CON TARJETA DE CREDITO COMERCIO',
      'CONSUMO POS COMERCIO',
      'COMPRA TARJETA COMERCIO',
    ],
    counterExamples: [
      // El pago del resumen es amortización de deuda, no el consumo.
      'PAGO ESTADO DE CUENTA TARJETA DE CREDITO',
      'PAGO QR COMERCIO',
      'RETIRO EN EFECTIVO CAJERO',
    ],
    restrictions: [
      'Sólo cuando la glosa no identifica el rubro: si dice el comercio o el producto, gana la hoja del rubro.',
    ],
    relatedCategoryCodes: ['GASTOS.COMPRAS.QR', 'GASTOS.FINANCIEROS.PRESTAMOS'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.COMPRAS.QR',
    name: 'Pago con QR',
    description: 'Pago a un comercio o a una persona leyendo un código QR.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'PAGO QR COMERCIO',
      'PAGO CON QR',
      'PAGO QR SIMPLE',
      'TRANSACCION QR COMERCIO',
    ],
    counterExamples: ['COMPRA TARJETA POS', 'TRANSFERENCIA SALIENTE'],
    restrictions: [
      'Sólo cuando la glosa no identifica el rubro: si dice el comercio o el producto, gana la hoja del rubro.',
    ],
    relatedCategoryCodes: ['GASTOS.COMPRAS.TARJETA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.COMPRAS.VESTIMENTA',
    name: 'Ropa y calzado',
    description: 'Prendas de vestir, calzado y accesorios personales.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'COMPRA EN TIENDA DE ROPA',
      'COMPRA DE CALZADO',
      'COMPRA PRENDAS DE VESTIR',
      'PAGO BOUTIQUE',
    ],
    counterExamples: ['COMPRA SUPERMERCADO', 'COMPRA TARJETA POS'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.COMPRAS.TARJETA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.COMPRAS.HOGAR',
    name: 'Muebles y electrodomésticos',
    description: 'Mobiliario, línea blanca y equipamiento duradero de la casa.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'COMPRA DE MUEBLES PARA EL HOGAR',
      'COMPRA ELECTRODOMESTICO',
      'COMPRA REFRIGERADOR',
      'COMPRA COLCHON Y ROPA DE CAMA',
    ],
    counterExamples: ['COMPRA MATERIALES DE CONSTRUCCION', 'COMPRA ABARROTES'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.VIVIENDA.MANTENIMIENTO'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.COMPRAS.LIBRERIA',
    name: 'Librería y papelería',
    description: 'Libros, material de escritorio, impresión y artículos de papelería.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'COMPRA EN LIBRERIA',
      'COMPRA EN PAPELERIA',
      'COMPRA MATERIAL DE ESCRITORIO',
      'PAGO IMPRENTA',
    ],
    // El material ESCOLAR es educación: lo compra la misma tienda pero responde
    // a otra pregunta —cuánto cuesta el colegio— y así lo dice el informe.
    counterExamples: ['COMPRA MATERIAL ESCOLAR', 'COMPRA COMPUTADORA'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.EDUCACION', 'GASTOS.COMPRAS.TECNOLOGIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.COMPRAS.TECNOLOGIA',
    name: 'Tecnología',
    description: 'Equipos y accesorios electrónicos: computadoras, teléfonos, periféricos.',
    parentCode: 'GASTOS.COMPRAS',
    positiveExamples: [
      'COMPRA COMPUTADORA',
      'COMPRA TELEFONO CELULAR',
      'COMPRA EQUIPO ELECTRONICO',
      'COMPRA ACCESORIOS INFORMATICOS',
    ],
    counterExamples: ['PAGO SUSCRIPCION SOFTWARE', 'COMPRA ELECTRODOMESTICO'],
    restrictions: ['Es el equipo físico; la licencia o el servicio digital es una suscripción.'],
    relatedCategoryCodes: ['GASTOS.OCIO.SUSCRIPCIONES'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: cuidado personal y familia
  // ==========================================================================
  rama(
    'GASTOS.PERSONAL',
    'Cuidado personal y familia',
    'Gastos de la persona y su hogar.',
    'GASTOS',
  ),
  {
    code: 'GASTOS.PERSONAL.CUIDADO',
    name: 'Cuidado personal',
    description: 'Peluquería, estética, gimnasio y productos de higiene personal.',
    parentCode: 'GASTOS.PERSONAL',
    positiveExamples: [
      'PAGO PELUQUERIA',
      'PAGO GIMNASIO MENSUALIDAD',
      'PAGO SALON DE BELLEZA',
      'COMPRA PRODUCTOS DE HIGIENE PERSONAL',
    ],
    counterExamples: ['COMPRA EN FARMACIA', 'PAGO CONSULTA MEDICA'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.SALUD.ATENCION'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.PERSONAL.MASCOTAS',
    name: 'Mascotas',
    description: 'Alimento, veterinario y accesorios de animales de compañía.',
    parentCode: 'GASTOS.PERSONAL',
    positiveExamples: [
      'PAGO VETERINARIA',
      'COMPRA ALIMENTO PARA MASCOTAS',
      'PAGO CONSULTA VETERINARIA',
      'COMPRA EN PET SHOP',
    ],
    counterExamples: ['PAGO CONSULTA MEDICA', 'COMPRA ABARROTES'],
    restrictions: [],
    relatedCategoryCodes: [],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.PERSONAL.DONACIONES',
    name: 'Donaciones y ayudas',
    description: 'Aportes a instituciones benéficas, iglesias o ayudas familiares sin retorno.',
    parentCode: 'GASTOS.PERSONAL',
    positiveExamples: [
      'DONACION FUNDACION',
      'APORTE IGLESIA',
      'AYUDA FAMILIAR MENSUAL',
      'DONACION CAMPANA SOLIDARIA',
    ],
    counterExamples: ['TRANSFERENCIA SALIENTE', 'PAGO IMPUESTO A LA PROPIEDAD'],
    restrictions: [],
    relatedCategoryCodes: ['GASTOS.TRANSFERENCIAS'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: movimiento de dinero propio
  // ==========================================================================
  {
    code: 'GASTOS.TRANSFERENCIAS',
    name: 'Transferencia enviada',
    description: 'Envío de dinero a otra persona o a una cuenta propia, sin contraprestación.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'TRANSFERENCIA SALIENTE',
      'TRANSFERENCIA ENVIADA',
      'TRANSF ENVIADA A TERCEROS',
      'TRANSFERENCIA INTERBANCARIA ENVIADA',
      'ENVIO DE DINERO A TERCEROS',
    ],
    counterExamples: [
      'ABONO TRANSFERENCIA RECIBIDA',
      'PAGO QR COMERCIO',
      'PAGO CUOTA PRESTAMO PERSONAL',
    ],
    restrictions: ['Debe ser un cargo; una transferencia recibida es un ingreso.'],
    relatedCategoryCodes: ['INGRESOS.TRANSFERENCIA'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.EFECTIVO',
    name: 'Retiro de efectivo',
    description: 'Extracción de billetes en cajero, ventanilla o corresponsal.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'RETIRO EN EFECTIVO CAJERO',
      'RETIRO CAJERO AUTOMATICO',
      'RETIRO EN VENTANILLA',
      'DISPOSICION DE EFECTIVO',
    ],
    counterExamples: ['DEPOSITO EN EFECTIVO', 'COMPRA TARJETA POS'],
    restrictions: [
      'El retiro no dice en qué se gastó el dinero: no debe leerse como consumo de ningún rubro.',
    ],
    relatedCategoryCodes: ['INGRESOS.EFECTIVO'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.AHORRO',
    name: 'Ahorro e inversión',
    description:
      'Traspaso de dinero propio a un instrumento de ahorro o inversión. No es consumo: sigue siendo del titular.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'TRASPASO A DEPOSITO A PLAZO FIJO',
      'APERTURA DPF',
      'APORTE FONDO DE INVERSION',
      'TRASPASO A CUENTA DE AHORRO PROGRAMADO',
      'APORTE VOLUNTARIO AFP',
    ],
    counterExamples: ['TRANSFERENCIA SALIENTE', 'PAGO CUOTA PRESTAMO PERSONAL'],
    restrictions: ['No es un gasto consumido: el dinero cambia de sitio, no desaparece.'],
    relatedCategoryCodes: ['INGRESOS.FINANCIERO'],
    acceptanceThreshold: SENSIBLE,
  },

  // ==========================================================================
  // Gastos: financieros
  // ==========================================================================
  rama('GASTOS.FINANCIEROS', 'Gastos financieros', 'Lo que cuesta el propio dinero.', 'GASTOS'),
  {
    code: 'GASTOS.FINANCIEROS.COMISIONES',
    name: 'Comisiones bancarias',
    description: 'Cargos que la entidad cobra por mantener u operar la cuenta.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'COMISION MANTENIMIENTO',
      'COMISION MANTENIMIENTO DE CUENTA',
      'COMISION POR TRANSFERENCIA INTERBANCARIA',
      'COBRO COMISION USO DE CAJERO',
      'COMISION ANUAL TARJETA DE CREDITO',
      'CARGO POR ESTADO DE CUENTA',
    ],
    counterExamples: ['PAGO CUOTA PRESTAMO PERSONAL', 'ABONO INTERESES'],
    restrictions: [
      'Excluye la amortización de deuda, que devuelve capital en lugar de retribuir un servicio.',
    ],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.PRESTAMOS'],
    acceptanceThreshold: SENSIBLE,
  },
  {
    code: 'GASTOS.FINANCIEROS.PRESTAMOS',
    name: 'Préstamos y tarjetas',
    description: 'Cuotas de crédito, amortizaciones e intereses de deuda contraída.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'PAGO CUOTA PRESTAMO',
      'PAGO CUOTA PRESTAMO PERSONAL',
      'PAGO CUOTA PRESTAMO HIPOTECARIO',
      'PAGO ESTADO DE CUENTA TARJETA DE CREDITO',
      'AMORTIZACION DE CREDITO',
      'COBRO DE INTERESES POR MORA PRESTAMO',
    ],
    counterExamples: ['COMISION MANTENIMIENTO DE CUENTA', 'PAGO ALQUILER DEPARTAMENTO'],
    restrictions: [
      'Debe corresponder a una deuda del titular, no a una comisión por un servicio puntual.',
    ],
    relatedCategoryCodes: ['GASTOS.FINANCIEROS.COMISIONES', 'GASTOS.VIVIENDA.ALQUILER'],
    acceptanceThreshold: SENSIBLE,
  },
  {
    code: 'GASTOS.FINANCIEROS.SEGUROS',
    name: 'Seguros',
    description: 'Primas de seguros de vida, hogar, desgravamen y accidentes.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'PAGO PRIMA SEGURO DE VIDA',
      'PAGO SEGURO DE DESGRAVAMEN',
      'PAGO SEGURO DEL HOGAR',
      'DEBITO PRIMA SEGURO ACCIDENTES',
    ],
    counterExamples: [
      'PAGO SEGURO OBLIGATORIO SOAT',
      // La forma que el normalizador entrega tras desplegar el alias: sin ella,
      // el contraejemplo no cubría el texto que el clasificador ve de verdad.
      'PAGO SEGURO OBLIGATORIO DE ACCIDENTES DE TRANSITO',
      'PAGO SEGURO DE SALUD',
    ],
    restrictions: ['El SOAT va con el vehículo y el seguro médico con salud.'],
    relatedCategoryCodes: ['GASTOS.TRANSPORTE.COMBUSTIBLE', 'GASTOS.SALUD.ATENCION'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.FINANCIEROS.CAMBIO',
    name: 'Compra de divisas',
    description: 'Cambio de moneda: compra de dólares u otra divisa contra la cuenta.',
    parentCode: 'GASTOS.FINANCIEROS',
    positiveExamples: [
      'COMPRA DE DOLARES',
      'CAMBIO DE MONEDA USD',
      'OPERACION DE CAMBIO DIVISAS',
      'VENTA DE BOLIVIANOS COMPRA USD',
    ],
    counterExamples: ['TRANSFERENCIA SALIENTE', 'ABONO REMESA DEL EXTERIOR'],
    restrictions: ['El dinero cambia de moneda, no de dueño: no es consumo.'],
    relatedCategoryCodes: ['GASTOS.AHORRO'],
    acceptanceThreshold: CORRIENTE,
  },

  // ==========================================================================
  // Gastos: obligaciones y servicios profesionales
  // ==========================================================================
  {
    code: 'GASTOS.IMPUESTOS',
    name: 'Impuestos y tasas',
    description: 'Tributos, patentes y tasas pagados al Estado o al municipio.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'PAGO IMPUESTOS',
      'PAGO IMPUESTO A LA PROPIEDAD',
      'PAGO IMPUESTO AL VALOR AGREGADO IVA',
      'PAGO PATENTE MUNICIPAL',
      'PAGO IMPUESTO VEHICULOS',
      'PAGO FORMULARIO IMPUESTOS NACIONALES',
    ],
    counterExamples: ['COMISION MANTENIMIENTO DE CUENTA', 'PAGO SEGURO OBLIGATORIO SOAT'],
    restrictions: ['Debe ser un tributo, no un servicio contratado a un privado.'],
    relatedCategoryCodes: [],
    // El umbral más alto junto con los financieros: una clasificación errónea
    // aquí distorsiona la declaración, no sólo un informe de gasto doméstico.
    acceptanceThreshold: 0.7,
  },
  {
    code: 'GASTOS.PROFESIONALES',
    name: 'Servicios profesionales',
    description: 'Honorarios de abogados, contadores, notarios y otros profesionales contratados.',
    parentCode: 'GASTOS',
    /*
     * Se dice «contabilidad» y no «servicios contables», y es deliberado.
     *
     * `PAGO SERVICIOS CONTABLES` contiene el bigrama `PAGO SERVICIOS`, que es la
     * etiqueta con la que la banca imprime el pago de luz, agua y gas. Con él
     * aquí, `PAGO SERVICIOS (CUOTA 3)` sacaba 0,9167 contra esta hoja y 0,9140
     * contra Servicios básicos —tres milésimas— y el reparto de confianza dejaba
     * a las dos por debajo de su umbral: un movimiento con rubro identificable
     * salía SIN DETERMINAR porque dos hojas se disputaban una frase que sólo es
     * de una. Nombrar la profesión en vez del genérico deshace el empate sin
     * quitarle a esta hoja ningún caso que le pertenezca.
     */
    positiveExamples: [
      'PAGO HONORARIOS ABOGADO',
      'PAGO HONORARIOS CONTADOR',
      'PAGO SERVICIO DE CONTABILIDAD',
      'PAGO NOTARIA TRAMITE',
      'PAGO ASESORIA PROFESIONAL',
    ],
    counterExamples: [
      'PAGO CONSULTA MEDICA',
      'COBRO FACTURA SERVICIOS',
      // Un proveedor no es un profesional colegiado: hoja aparte.
      'PAGO PROVEEDOR SERVICIOS GENERALES',
    ],
    restrictions: [
      'Es un pago que hace el titular a un profesional; cobrar honorarios propios es un ingreso.',
    ],
    relatedCategoryCodes: ['INGRESOS.INDEPENDIENTE', 'GASTOS.PROVEEDORES'],
    acceptanceThreshold: CORRIENTE,
  },
  {
    code: 'GASTOS.PROVEEDORES',
    name: 'Pago a proveedores',
    description:
      'Pago a una empresa que provee bienes o servicios a la actividad del titular: mercadería, insumos, servicios generales.',
    parentCode: 'GASTOS',
    positiveExamples: [
      'PAGO PROVEEDOR',
      'PAGO PROVEEDOR SERVICIOS GENERALES',
      'PAGO A PROVEEDOR DE MERCADERIA',
      'PAGO FACTURA PROVEEDOR',
      'PAGO A EMPRESA DE SERVICIOS GENERALES',
      'CANCELACION FACTURA A PROVEEDOR',
    ],
    counterExamples: [
      // El profesional colegiado tiene hoja propia, y la separación importa:
      // una es un honorario y la otra un insumo de la actividad.
      'PAGO HONORARIOS ABOGADO',
      // Luz, agua y gas los factura la empresa proveedora del servicio
      // domiciliario, que no es un proveedor de la actividad.
      'PAGO SERVICIO ELECTRICO',
      'COMPRA SUPERMERCADO',
    ],
    restrictions: [
      'Es un pago de la actividad del titular, no un consumo doméstico ni un servicio básico de la vivienda.',
    ],
    relatedCategoryCodes: ['GASTOS.PROFESIONALES', 'INGRESOS.INDEPENDIENTE'],
    acceptanceThreshold: CORRIENTE,
  },
];

/**
 * El árbol que se siembra: el catálogo curado más el dialecto real de los bancos.
 *
 * Un código del dialecto que no exista aquí se DENUNCIA en vez de ignorarse. Una
 * errata en `bank-dialect.data.ts` no tiene ninguna señal visible —los ejemplos
 * simplemente no llegarían a ninguna hoja y la categoría clasificaría peor sin
 * que nadie supiera por qué—, así que se rompe el arranque, que es la única
 * forma de que se corrija.
 */
export const expenseCategoryTree: readonly SemanticCategorySeed[] = (() => {
  /*
   * El árbol curado describe el gasto de una PERSONA. Los otros cuatro aportes
   * cubren lo que esa mirada dejaba fuera, y cada uno responde a una carencia
   * distinta y medida:
   *
   * - `statementCategories`: lo que mueve un extracto EMPRESARIAL —adquirencia,
   *   nómina pagada, insumos agrícolas, fondos en custodia—. Sobre 1.464
   *   movimientos reales, esas familias eran el grueso del 41 % sin clasificar.
   * - `householdCategories`: los rubros del hogar y de la persona que ninguna
   *   hoja nombraba —anticrético, taller, óptica, funeraria, membresías—.
   * - `businessCategories`: la operación de una empresa más allá del proveedor
   *   —local, publicidad, aduana, aportes laborales, obra, campo, minería—.
   * - `financialCategories`: lo financiero que no es una cuota —ITF, garantías,
   *   leasing, embargo— y el ingreso que espeja cada uno de esos hechos.
   */
  const arbol = [
    ...curatedTree,
    ...statementCategories,
    ...householdCategories,
    ...businessCategories,
    ...financialCategories,
  ];

  /*
   * Un código repetido se DENUNCIA. La siembra es idempotente por `(tenant,
   * code)`, así que dos entradas con el mismo código no fallarían: la segunda
   * pisaría a la primera en silencio y el catálogo perdería una categoría entera
   * sin que ninguna prueba lo notara. Con el árbol repartido en cinco archivos
   * eso deja de ser hipotético.
   */
  const repetidos = arbol
    .map((categoria) => categoria.code)
    .filter((codigo, indice, todos) => todos.indexOf(codigo) !== indice);
  if (repetidos.length > 0) {
    throw new Error(
      `Hay categorías declaradas dos veces en el árbol: ${[...new Set(repetidos)].join(', ')}.`,
    );
  }

  /*
   * Un código del dialecto que no exista en el árbol se DENUNCIA en vez de
   * ignorarse. Una errata en un diccionario de vocabulario no tiene ninguna
   * señal visible —los ejemplos simplemente no llegarían a ninguna hoja y la
   * categoría clasificaría peor sin que nadie supiera por qué—, así que se rompe
   * el arranque, que es la única forma de que se corrija.
   */
  const codigos = new Set(arbol.map((categoria) => categoria.code));
  const aportes = [
    bankDialectExamples,
    bolivianMerchantExamples,
    statementVocabularyExamples,
    glosaVocabularyExamples,
    glosaVocabularyExtraExamples,
  ];
  const huerfanos = aportes
    .flatMap((aporte) => Object.keys(aporte))
    .filter((codigo) => !codigos.has(codigo));
  if (huerfanos.length > 0) {
    throw new Error(
      `El dialecto bancario menciona categorías que no existen en el árbol: ${huerfanos.join(', ')}.`,
    );
  }

  /*
   * Los ejemplos se DEDUPLICAN al unirlos.
   *
   * Cuatro diccionarios escritos en momentos distintos repiten glosas sin
   * quererlo, y una repetición no es inocua: en `DEEP` cada ejemplo es una sonda
   * que se embebe y se compara, de modo que la copia cuesta lo mismo que el
   * original y no aporta nada —el parecido con un texto y con su gemelo es el
   * mismo número—. Con el catálogo ampliado eso eran decenas de sondas pagadas
   * dos veces en cada clasificación.
   */
  return arbol.map((categoria) => {
    const extra = aportes.flatMap((aporte) => aporte[categoria.code] ?? []);
    const positiveExamples = [...new Set([...categoria.positiveExamples, ...extra])];
    return positiveExamples.length === categoria.positiveExamples.length &&
      positiveExamples.every((ejemplo, indice) => ejemplo === categoria.positiveExamples[indice])
      ? categoria
      : { ...categoria, positiveExamples };
  });
})();

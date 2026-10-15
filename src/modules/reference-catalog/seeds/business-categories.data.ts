import type { SemanticCategorySeed } from './expense-category-tree.data';

/**
 * Lo que mueve un extracto de EMPRESA, más allá de la nómina y el proveedor.
 *
 * `statement-vocabulary` abrió el árbol al comercio —adquirencia, inventario,
 * flete— porque medido sobre 1.464 movimientos reales esas familias eran el
 * grueso de lo no clasificado. Lo que quedaba fuera es todo lo demás que una
 * empresa boliviana paga y que no se parece a un gasto doméstico: el alquiler
 * del local, la publicidad, el hosting, el despachante de aduana, el aporte
 * patronal a la AFP, el arriendo de la tierra, la regalía minera.
 *
 * ## Cuatro ramas nuevas, y por qué son ramas y no hojas sueltas
 *
 * Construcción, comercio exterior, obligaciones laborales y minería no son un
 * rubro cada una: son ACTIVIDADES con tres o cuatro hechos distintos dentro, y
 * el informe de un contratista o de un importador se lee por esa agrupación. Una
 * rama, además, no puede ganar nunca —umbral inalcanzable a propósito—, así que
 * agrupar no crea un imán que le robe movimientos a sus propias hojas.
 *
 * ## Lo que NO se abrió
 *
 * No hay hoja de «capacitación» —el extracto la imprime igual que un curso, y
 * Educación ya la recoge—, ni de «courier internacional» —Logística ya trae
 * `MENSAJERIA COURIER` y dos hojas con esa palabra se anulan entre sí—, ni de
 * «aguinaldo pagado», que vive en Nómina con su misma glosa. Separar el concepto
 * cuando la glosa no se separa no añade cobertura: quita confianza.
 */

const CORRIENTE = 0.62;
/** Lo laboral y lo tributario se juzgan con más exigencia: distorsionan una declaración. */
const SENSIBLE = 0.68;
const RAMA = 1;

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

function rama(code: string, name: string, description: string): SemanticCategorySeed {
  return {
    code,
    name,
    description,
    parentCode: 'GASTOS',
    positiveExamples: [],
    counterExamples: [],
    restrictions: ['Nodo de agrupación: la clasificación recae en sus hojas.'],
    relatedCategoryCodes: [],
    acceptanceThreshold: RAMA,
  };
}

export const businessCategories: readonly SemanticCategorySeed[] = [
  // ==========================================================================
  // Operación del negocio
  // ==========================================================================
  hoja(
    'GASTOS.EMPRESARIALES.LOCAL',
    'Alquiler del local',
    'Renta del local comercial, oficina, depósito o galpón donde opera el negocio.',
    'GASTOS.EMPRESARIALES',
    [
      // Estaba en `EMPRESARIALES.EQUIPO`, cuya propia descripción dice «no es el
      // alquiler del local». Un galpón y una retroexcavadora no se contratan en
      // el mismo mercado ni se leen igual en un informe.
      'ALQUILER LOCAL COMERCIAL',
      'PAGO ALQUILER OFICINA',
      'PAGO ALQUILER DE GALPON',
      'PAGO ALQUILER DEPOSITO',
      'PAGO ARRIENDO LOCAL',
      'PAGO ALQUILER PUESTO DE MERCADO',
      'PAGO ALQUILER DE TIENDA',
      'PAGO CANON DE ARRENDAMIENTO COMERCIAL',
    ],
    ['PAGO ALQUILER DEPARTAMENTO', 'ALQUILER EQUIPO MAQUINARIA', 'PAGO EXPENSAS EDIFICIO'],
    ['GASTOS.VIVIENDA.ALQUILER', 'GASTOS.EMPRESARIALES.EQUIPO'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.PUBLICIDAD',
    'Publicidad y marketing',
    'Pauta publicitaria, agencia de marketing, impresión de material promocional y patrocinios.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO PUBLICIDAD',
      'PAGO PAUTA PUBLICITARIA',
      'COMPRA INTERNET EXT FACEBOOK ADS',
      'COMPRA INTERNET EXT GOOGLE ADS',
      'PAGO AGENCIA DE MARKETING',
      'PAGO PUBLICIDAD RADIO Y TELEVISION',
      'PAGO LETRERO Y GIGANTOGRAFIA',
      'PAGO PATROCINIO EVENTO',
      'PAGO CAMPANA DIGITAL',
    ],
    ['PAGO IMPRENTA', 'PAGO SUSCRIPCION SOFTWARE', 'PAGO CONSULTORIA PROFESIONAL'],
    ['GASTOS.COMPRAS.LIBRERIA'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.SOFTWARE',
    'Sistemas, hosting y dominio',
    'Servicios informáticos que sostienen la operación: nube, hosting, dominio, licencias y soporte de sistemas.',
    'GASTOS.EMPRESARIALES',
    [
      // Ojo con la palabra «suscripción»: es la cabecera de `OCIO.SUSCRIPCIONES`
      // y compartirla haría que las dos hojas se repartieran la confianza. Aquí
      // se nombra la INFRAESTRUCTURA, que es lo que ninguna suscripción de
      // streaming dice.
      'COMPRA INTERNET EXT AWS',
      'COMPRA INTERNET EXT DIGITALOCEAN',
      'PAGO SERVICIO DE HOSTING',
      'PAGO RENOVACION DE DOMINIO',
      'PAGO SERVIDOR EN LA NUBE',
      'PAGO SOPORTE DE SISTEMAS',
      'PAGO LICENCIA SISTEMA CONTABLE',
      'PAGO MANTENIMIENTO DE SOFTWARE EMPRESARIAL',
      'PAGO SERVICIO DE FACTURACION ELECTRONICA',
    ],
    ['PAGO SUSCRIPCION STREAMING', 'COMPRA COMPUTADORA', 'PAGO SERVICIO INTERNET'],
    ['GASTOS.OCIO.SUSCRIPCIONES', 'GASTOS.COMPRAS.TECNOLOGIA'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.MANTENIMIENTO',
    'Mantenimiento de equipos e instalaciones',
    'Reparación y mantenimiento de maquinaria, equipos e instalaciones del negocio.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO MANTENIMIENTO DE EQUIPOS',
      'PAGO MANTENIMIENTO INSTALACIONES',
      'PAGO REPARACION DE MAQUINARIA',
      'PAGO SERVICIO TECNICO EQUIPOS',
      'PAGO MANTENIMIENTO AIRE ACONDICIONADO',
      'PAGO MANTENIMIENTO ASCENSOR',
      'PAGO CALIBRACION DE EQUIPOS',
    ],
    ['PAGO SERVICIO DE PLOMERIA', 'MANTENIMIENTO MAQUINARIA AGRICOLA', 'PAGO TALLER MECANICO'],
    ['GASTOS.VIVIENDA.MANTENIMIENTO', 'GASTOS.AGRO.MAQUINARIA'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.VIGILANCIA',
    'Vigilancia y seguridad del negocio',
    'Guardias, monitoreo y seguridad física contratados por la empresa.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO SERVICIO DE VIGILANCIA PLANTA INDUSTRIAL',
      'PAGO EMPRESA DE SEGURIDAD PRIVADA',
      'PAGO SERVICIO DE GUARDIAS',
      'PAGO MONITOREO DE CAMARAS EMPRESA',
      'PAGO SEGURIDAD FISICA DEPOSITO',
      'PAGO TRASLADO DE VALORES',
    ],
    ['PAGO ALARMA MONITOREADA', 'PAGO VIGILANCIA CONDOMINIO', 'PAGO PRIMA SEGURO DE VIDA'],
    ['GASTOS.VIVIENDA.SEGURIDAD'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.VIATICOS',
    'Viáticos del personal',
    'Hospedaje, pasajes y estadía que la empresa paga por un viaje de trabajo.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO VIATICOS PERSONAL',
      'REEMBOLSO DE VIATICOS',
      'PAGO VIATICOS VIAJE DE TRABAJO',
      'PAGO HOSPEDAJE PERSONAL COMISION',
      'PAGO PASAJES PERSONAL COMISION DE SERVICIO',
      'RENDICION DE VIATICOS',
    ],
    ['COMPRA PASAJES AEREOS', 'PAGO RESERVA DE HOTEL', 'PAGO PLANILLA SUELDOS'],
    ['GASTOS.OCIO.VIAJES', 'INGRESOS.VIATICOS'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.REPRESENTACION',
    'Gastos de representación',
    'Atenciones a clientes, agasajos y cortesías corporativas.',
    'GASTOS.EMPRESARIALES',
    [
      'GASTOS DE REPRESENTACION',
      'PAGO ATENCION A CLIENTES',
      'PAGO AGASAJO PERSONAL',
      'PAGO ALMUERZO DE NEGOCIOS',
      'PAGO CORTESIA CORPORATIVA',
      'PAGO OBSEQUIOS INSTITUCIONALES',
    ],
    ['CONSUMO EN RESTAURANTE', 'GASTOS DE VIATICOS PERSONAL', 'COMPRA CANASTA DE REGALO'],
    ['GASTOS.ALIMENTACION.RESTAURANTES'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.COMISIONES',
    'Comisiones a vendedores y agentes',
    'Comisión pagada a un vendedor, agente o intermediario por concretar una venta.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO COMISION VENDEDOR',
      'PAGO COMISIONES DE VENTA',
      'PAGO COMISION AGENTE COMERCIAL',
      'PAGO COMISION POR INTERMEDIACION',
      'LIQUIDACION COMISIONES FUERZA DE VENTAS',
      'PAGO COMISION CORREDOR',
    ],
    [
      // Las comisiones que cobra el banco o el procesador tienen hoja propia.
      'COMISION MANTENIMIENTO DE CUENTA',
      'COMISION PROCESAMIENTO TARJETAS',
      'PAGO PLANILLA SUELDOS',
    ],
    ['GASTOS.FINANCIEROS.COMISIONES', 'INGRESOS.COMISIONES'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.FRANQUICIA',
    'Franquicia y regalías',
    'Canon de franquicia, regalía por marca y derechos de uso pagados al titular de una licencia.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO REGALIA POR MARCA',
      'PAGO CANON DE FRANQUICIA',
      'PAGO DERECHOS DE LICENCIA',
      'PAGO ROYALTY CONTRATO',
      'PAGO REGALIAS AL EXTERIOR',
      'PAGO USO DE MARCA COMERCIAL',
    ],
    ['PAGO REGALIAS MINERAS', 'PAGO LICENCIA SISTEMA CONTABLE', 'PAGO PATENTE MUNICIPAL'],
    ['INGRESOS.REGALIAS'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.TERCERIZACION',
    'Servicios tercerizados',
    'Personal o procesos contratados a otra empresa: call center, limpieza industrial, outsourcing.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO SERVICIO TERCERIZADO',
      'PAGO OUTSOURCING DE PERSONAL',
      'PAGO SERVICIO DE CALL CENTER',
      'PAGO SERVICIO DE LIMPIEZA INDUSTRIAL PLANTA',
      'PAGO EMPRESA DE SERVICIOS TERCERIZADOS',
      'PAGO PERSONAL SUBCONTRATADO',
    ],
    ['PAGO PLANILLA SUELDOS', 'PAGO SERVICIO DE LIMPIEZA', 'PAGO HONORARIOS CONSULTORIA'],
    ['GASTOS.NOMINA', 'GASTOS.PROFESIONALES'],
  ),
  hoja(
    'GASTOS.EMPRESARIALES.ALMACENAJE',
    'Almacenaje y depósito',
    'Alquiler de almacén de terceros, custodia de mercadería y servicios de bodega.',
    'GASTOS.EMPRESARIALES',
    [
      'PAGO SERVICIO DE ALMACENAJE',
      'PAGO ALMACENAMIENTO DE MERCADERIA',
      'PAGO BODEGA DE TERCEROS',
      'PAGO CUSTODIA DE MERCADERIA',
      'PAGO ALQUILER DE ALMACEN',
    ],
    ['PAGO ALQUILER DEPOSITO', 'ALMACENAJE ADUANERO', 'PAGO SILO ACOPIO GRANO'],
    ['GASTOS.EMPRESARIALES.LOCAL', 'GASTOS.COMEX.ADUANA'],
  ),

  // ==========================================================================
  // Obligaciones laborales
  //
  // Nómina ya existe y se queda con el pago del sueldo. Lo que se abre aquí es
  // lo que NO es sueldo y sin embargo lo acompaña: el aporte a la gestora, el
  // seguro de salud del trabajador, el finiquito y el jornal eventual. Cada uno
  // tiene su propia glosa y su propio destino legal.
  // ==========================================================================
  rama(
    'GASTOS.LABORALES',
    'Obligaciones laborales',
    'Aportes, beneficios y pagos al personal distintos del sueldo corriente.',
  ),
  hoja(
    'GASTOS.LABORALES.PENSIONES',
    'Aportes a pensiones',
    'Aporte a la gestora pública o a una AFP por el personal en planilla.',
    'GASTOS.LABORALES',
    [
      'PAGO APORTES AFP',
      'PAGO APORTE GESTORA PUBLICA',
      'PAGO APORTES AFP FUTURO',
      'PAGO APORTES AFP PREVISION',
      'PAGO PLANILLA DE APORTES A PENSIONES',
      'PAGO APORTE PATRONAL PENSIONES',
      'PAGO FORMULARIO DE APORTES SIP',
    ],
    ['APORTE VOLUNTARIO AFP', 'PAGO PLANILLA SUELDOS', 'PAGO APORTES CAJA NACIONAL DE SALUD'],
    ['GASTOS.NOMINA', 'GASTOS.AHORRO'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.LABORALES.SALUD',
    'Aportes al seguro social de salud',
    'Aporte patronal a la caja de salud que cubre al personal.',
    'GASTOS.LABORALES',
    [
      'PAGO APORTES CAJA NACIONAL DE SALUD',
      'PAGO APORTE CNS',
      'PAGO APORTES CAJA PETROLERA',
      'PAGO PLANILLA SEGURO SOCIAL',
      'PAGO APORTE PATRONAL SALUD',
      'PAGO SEGURO SOCIAL OBLIGATORIO',
    ],
    ['PAGO CAJA PETROLERA DE SALUD', 'PAGO SEGURO DE SALUD PREPAGO', 'PAGO APORTES AFP'],
    ['GASTOS.LABORALES.PENSIONES', 'GASTOS.SALUD.SEGURO'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.LABORALES.FINIQUITO',
    'Finiquitos e indemnizaciones',
    'Beneficios sociales pagados al terminar una relación laboral: finiquito, desahucio, indemnización.',
    'GASTOS.LABORALES',
    [
      'PAGO FINIQUITO',
      'PAGO DE BENEFICIOS SOCIALES',
      'PAGO INDEMNIZACION LABORAL',
      'PAGO DESAHUCIO',
      'PAGO LIQUIDACION FINAL EMPLEADO',
      'PAGO FINIQUITO PERSONAL RETIRADO',
    ],
    ['PAGO PLANILLA SUELDOS', 'PAGO AGUINALDO PLANILLA', 'INDEMNIZACION SEGURO SINIESTRO'],
    ['GASTOS.NOMINA', 'INGRESOS.FINIQUITO'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.LABORALES.EVENTUAL',
    'Personal eventual y jornales',
    'Pago por jornada a personal temporal, sin planilla permanente.',
    'GASTOS.LABORALES',
    [
      'PAGO JORNALES',
      'PAGO PERSONAL EVENTUAL',
      'PAGO JORNALEROS',
      'PAGO MANO DE OBRA EVENTUAL',
      'PAGO TRABAJO POR JORNADA',
      'PAGO PERSONAL TEMPORAL',
    ],
    ['PAGO PLANILLA SUELDOS', 'PAGO HONORARIOS CONSULTORIA', 'PAGO MANO DE OBRA DE OBRA CIVIL'],
    ['GASTOS.NOMINA', 'GASTOS.CONSTRUCCION.MANO_OBRA'],
  ),

  // ==========================================================================
  // Construcción
  //
  // Distinta de `VIVIENDA.MANTENIMIENTO`, que es el arreglo puntual de una casa.
  // Aquí hay una OBRA: avances contra planilla, materiales por volumen y
  // permisos. El contraejemplo cruzado entre las dos familias es el que evita
  // que un plomero acabe en un avance de obra.
  // ==========================================================================
  rama(
    'GASTOS.CONSTRUCCION',
    'Construcción',
    'Ejecución de una obra: materiales, mano de obra y permisos.',
  ),
  hoja(
    'GASTOS.CONSTRUCCION.MATERIALES',
    'Materiales de construcción',
    'Cemento, fierro, hormigón, ladrillo y agregados comprados por volumen para una obra.',
    'GASTOS.CONSTRUCCION',
    [
      'COMPRA DE CEMENTO',
      'PAGO POS SOBOCE',
      'PAGO POS FANCESA',
      'PAGO POS ITACAMBA CEMENTO',
      'COMPRA DE FIERRO DE CONSTRUCCION',
      'COMPRA DE LADRILLO',
      'COMPRA DE AGREGADOS ARENA Y RIPIO',
      'PAGO HORMIGON PREMEZCLADO',
      'COMPRA MATERIAL DE CONSTRUCCION OBRA',
    ],
    [
      // La compra menor para arreglar la casa es mantenimiento del hogar.
      'COMPRA MATERIALES DE CONSTRUCCION',
      'COMPRA EN FERRETERIA',
      'COMPRA INVENTARIO',
    ],
    ['GASTOS.VIVIENDA.MANTENIMIENTO'],
  ),
  hoja(
    'GASTOS.CONSTRUCCION.MANO_OBRA',
    'Mano de obra de obra civil',
    'Cuadrilla, maestro albañil y personal de obra pagados por avance o por jornal.',
    'GASTOS.CONSTRUCCION',
    [
      'PAGO MANO DE OBRA DE OBRA CIVIL',
      'PAGO PLANILLA DE OBRA',
      'PAGO MAESTRO ALBANIL OBRA',
      'PAGO CUADRILLA DE CONSTRUCCION',
      'PAGO AVANCE DE MANO DE OBRA',
    ],
    ['PAGO TRABAJO DE ALBANILERIA', 'PAGO PLANILLA SUELDOS', 'PAGO JORNALES'],
    ['GASTOS.VIVIENDA.MANTENIMIENTO', 'GASTOS.LABORALES.EVENTUAL'],
  ),
  hoja(
    'GASTOS.CONSTRUCCION.CONTRATISTA',
    'Contratista y avance de obra',
    'Pago a la empresa constructora contra avance, anticipo de obra y supervisión.',
    'GASTOS.CONSTRUCCION',
    [
      'PAGO AVANCE DE OBRA',
      'PAGO EMPRESA CONSTRUCTORA',
      'PAGO CONTRATISTA DE OBRA',
      'PAGO ANTICIPO DE OBRA',
      'PAGO PLANILLA DE AVANCE CONTRATO',
      'PAGO SUPERVISION DE OBRA',
    ],
    ['PAGO PROVEEDOR', 'PAGO HONORARIOS ABOGADO', 'PAGO MANO DE OBRA DE OBRA CIVIL'],
    ['GASTOS.PROVEEDORES'],
  ),
  hoja(
    'GASTOS.CONSTRUCCION.PERMISOS',
    'Permisos y aprobación de planos',
    'Licencia de construcción, aprobación de planos y derechos municipales de obra.',
    'GASTOS.CONSTRUCCION',
    [
      'PAGO LICENCIA DE CONSTRUCCION',
      'PAGO APROBACION DE PLANOS',
      'PAGO DERECHO DE CONSTRUCCION MUNICIPAL',
      'PAGO PERMISO DE OBRA',
      'PAGO VISADO DE PLANOS',
    ],
    ['PAGO PATENTE MUNICIPAL', 'PAGO IMPUESTO A LA PROPIEDAD', 'PAGO HONORARIOS ARQUITECTO'],
    ['GASTOS.IMPUESTOS'],
  ),

  // ==========================================================================
  // Comercio exterior
  // ==========================================================================
  rama(
    'GASTOS.COMEX',
    'Comercio exterior',
    'Costos de importar o exportar: aduana, despachante y flete internacional.',
  ),
  hoja(
    'GASTOS.COMEX.ADUANA',
    'Tributos y servicios de aduana',
    'Tributo aduanero de importación, almacenaje en recinto y servicios de la aduana.',
    'GASTOS.COMEX',
    [
      'PAGO TRIBUTOS ADUANEROS',
      'PAGO ADUANA NACIONAL',
      'PAGO DUI IMPORTACION',
      'ALMACENAJE ADUANERO',
      'PAGO GRAVAMEN ARANCELARIO',
      'PAGO DERECHOS DE IMPORTACION',
      'PAGO RECINTO ADUANERO',
    ],
    [
      // El tributo interno lo cobra Impuestos Nacionales, no la Aduana.
      'PAGO IMPUESTO AL VALOR AGREGADO IVA',
      'PAGO IMPUESTOS',
      'PAGO SERVICIO DE ALMACENAJE',
    ],
    ['GASTOS.IMPUESTOS', 'GASTOS.EMPRESARIALES.ALMACENAJE'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.COMEX.DESPACHANTE',
    'Agencia despachante de aduana',
    'Honorarios de la agencia despachante y gestión del trámite de importación.',
    'GASTOS.COMEX',
    [
      'PAGO AGENCIA DESPACHANTE DE ADUANA',
      'PAGO DESPACHANTE ADUANERO',
      'PAGO HONORARIOS AGENCIA DE ADUANA',
      'PAGO GESTION DE IMPORTACION',
      'PAGO SERVICIO DE DESPACHO ADUANERO',
    ],
    ['PAGO TRIBUTOS ADUANEROS', 'PAGO HONORARIOS ABOGADO', 'PAGO PROVEEDOR'],
    ['GASTOS.COMEX.ADUANA', 'GASTOS.PROFESIONALES'],
  ),
  hoja(
    'GASTOS.COMEX.FLETE',
    'Flete internacional',
    'Transporte internacional de la mercadería: marítimo, aéreo o terrestre de importación.',
    'GASTOS.COMEX',
    [
      'PAGO FLETE INTERNACIONAL',
      'PAGO TRANSPORTE INTERNACIONAL DE CARGA',
      'PAGO FLETE MARITIMO',
      'PAGO FLETE AEREO IMPORTACION',
      'PAGO NAVIERA CONTENEDOR',
      'PAGO AGENTE DE CARGA INTERNACIONAL',
    ],
    ['LOGISTICA FLETE', 'TRANSPORTE DE CARGA', 'COMPRA PASAJES AEREOS'],
    ['GASTOS.EMPRESARIALES.LOGISTICA'],
  ),

  // ==========================================================================
  // Campo
  // ==========================================================================
  hoja(
    'GASTOS.AGRO.SERVICIOS',
    'Servicios de campaña agrícola',
    'Siembra, cosecha, fumigación y laboreo contratados a un tercero.',
    'GASTOS.AGRO',
    [
      'PAGO SERVICIO DE COSECHA',
      'PAGO SERVICIO DE SIEMBRA',
      'PAGO FUMIGACION AEREA',
      'PAGO SERVICIO DE LABOREO',
      'PAGO SERVICIO AGRICOLA POR HECTAREA',
      'PAGO TRILLA DE GRANO',
    ],
    ['COMPRA INSUMOS AGRICOLAS', 'MANTENIMIENTO MAQUINARIA AGRICOLA', 'PAGO JORNALES'],
    ['GASTOS.AGRO.INSUMOS', 'GASTOS.AGRO.MAQUINARIA'],
  ),
  hoja(
    'GASTOS.AGRO.TIERRA',
    'Arriendo de tierra',
    'Alquiler de superficie de cultivo o de pastoreo por campaña o por hectárea.',
    'GASTOS.AGRO',
    [
      'PAGO ARRIENDO DE TIERRA',
      'PAGO ALQUILER DE TERRENO AGRICOLA',
      'PAGO ARRIENDO HECTAREAS CAMPANA',
      'PAGO ALQUILER DE PROPIEDAD RURAL',
      'PAGO ARRENDAMIENTO CAMPO',
    ],
    ['PAGO ALQUILER DEPARTAMENTO', 'ALQUILER LOCAL COMERCIAL', 'PAGO IMPUESTO A LA PROPIEDAD'],
    ['GASTOS.EMPRESARIALES.LOCAL'],
  ),
  hoja(
    'GASTOS.AGRO.ACOPIO',
    'Acopio, secado y almacenaje de grano',
    'Silo, planta de acopio, secado y almacenamiento de la producción.',
    'GASTOS.AGRO',
    [
      'PAGO SILO ACOPIO GRANO',
      'PAGO SERVICIO DE SECADO DE GRANO',
      'PAGO ALMACENAJE DE PRODUCCION AGRICOLA',
      'PAGO PLANTA DE ACOPIO',
      'PAGO SERVICIO DE SILO',
    ],
    ['PAGO SERVICIO DE ALMACENAJE', 'FLETE PRODUCCION COSECHA', 'COMPRA DE FORRAJE'],
    ['GASTOS.EMPRESARIALES.ALMACENAJE', 'GASTOS.AGRO.PECUARIO'],
  ),

  // ==========================================================================
  // Minería
  //
  // Rama pequeña y muy boliviana: la regalía minera y la comercializadora no se
  // parecen a nada del resto del árbol, y sin ellas un extracto de cooperativa
  // minera queda entero en el cajón.
  // ==========================================================================
  rama('GASTOS.MINERIA', 'Minería', 'Gasto propio de la actividad minera.'),
  hoja(
    'GASTOS.MINERIA.REGALIAS',
    'Regalía minera',
    'Regalía y patente minera pagadas al Estado por la producción.',
    'GASTOS.MINERIA',
    [
      'PAGO REGALIAS MINERAS',
      'PAGO REGALIA MINERA DEPARTAMENTAL',
      'PAGO PATENTE MINERA',
      'PAGO AJAM PATENTE MINERA',
      'RETENCION REGALIA MINERA',
    ],
    ['PAGO REGALIA POR MARCA', 'PAGO PATENTE MUNICIPAL', 'PAGO IMPUESTOS'],
    ['GASTOS.IMPUESTOS', 'GASTOS.EMPRESARIALES.FRANQUICIA'],
    SENSIBLE,
  ),
  hoja(
    'GASTOS.MINERIA.INSUMOS',
    'Insumos y servicios mineros',
    'Explosivos, reactivos, perforación y servicios contratados para la operación minera.',
    'GASTOS.MINERIA',
    [
      'COMPRA INSUMOS MINEROS',
      'COMPRA DE EXPLOSIVOS',
      'COMPRA REACTIVOS DE CONCENTRACION',
      'PAGO SERVICIO DE PERFORACION',
      'PAGO SERVICIO DE INGENIO MINERO',
      'PAGO ANALISIS DE LEY DE MINERAL',
    ],
    ['COMPRA INSUMOS AGRICOLAS', 'COMPRA INVENTARIO', 'PAGO REGALIAS MINERAS'],
    ['GASTOS.EMPRESARIALES.INVENTARIO'],
  ),
];

import type { SemanticCategorySeed } from './expense-category-tree.data';

/**
 * Rubros del HOGAR y de la PERSONA que el árbol curado no nombraba.
 *
 * El catálogo original describe bien el gasto doméstico frecuente —comida,
 * transporte, servicios— pero se detiene donde el extracto sigue: el anticrético
 * boliviano, la empleada doméstica, la funeraria, la óptica, el taller mecánico,
 * la cuota del colegio profesional. Cada una de esas líneas caía antes en
 * `GASTOS.OTROS` o se quedaba SIN DETERMINAR, no porque el clasificador fallara
 * sino porque no había hoja adonde llegar.
 *
 * ## La regla que decide si un rubro merece hoja propia
 *
 * **Se separa cuando la GLOSA se separa, no cuando el concepto se separa.**
 *
 * Es la lección que el propio árbol ya documenta con `PAGO SERVICIOS`: dos hojas
 * que comparten la cabecera de una glosa se reparten la confianza y ninguna
 * alcanza su umbral, así que un movimiento perfectamente identificable sale sin
 * clasificar. Por eso aquí NO hay hoja de «comida rápida» —el banco la imprime
 * igual que un restaurante—, ni de «electrodomésticos» —vive en Compras hogar
 * con su mismo vocabulario—, ni de «gimnasio» —ya está en Cuidado personal—.
 * Hay hoja de «anticrético» porque ninguna otra línea del extracto dice esa
 * palabra, y de «funeraria» por lo mismo.
 *
 * Cuando el rubro existía pero estaba MEZCLADO en una hoja que hablaba de otra
 * cosa, la hoja nueva se lleva los ejemplos y la vieja los recibe como
 * contraejemplo. Eso pasa tres veces y está marcado en cada sitio: el SOAT y la
 * inspección técnica salen de Combustible, el taller mecánico también, y el
 * seguro de salud sale de Atención médica. Un carburante, una prima y una
 * consulta no son el mismo hecho aunque el vehículo o el cuerpo sean el mismo.
 */

const CORRIENTE = 0.62;

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

export const householdCategories: readonly SemanticCategorySeed[] = [
  // ==========================================================================
  // Vivienda
  // ==========================================================================
  hoja(
    'GASTOS.VIVIENDA.ANTICRETICO',
    'Anticrético',
    'Entrega del capital en anticrético: el dinero que el inquilino deja en depósito en lugar de pagar renta.',
    'GASTOS.VIVIENDA',
    [
      'PAGO ANTICRETICO',
      'ENTREGA DE ANTICRETICO',
      'DESEMBOLSO ANTICRETICO DEPARTAMENTO',
      'PAGO ANTICRETICO INMUEBLE',
      'TRANSFERENCIA POR ANTICRETICO',
      'ENTREGA CAPITAL ANTICRETICO',
      'PAGO ANTICRETICO CASA',
      'DEBITO POR CONTRATO DE ANTICRETICO',
    ],
    [
      // La renta mensual es la hoja de al lado: en el anticrético no hay renta.
      'PAGO ALQUILER DEPARTAMENTO',
      'PAGO EXPENSAS EDIFICIO',
      // Es el sentido contrario: el capital que vuelve al terminar el contrato.
      'DEVOLUCION DE ANTICRETICO',
    ],
    ['GASTOS.VIVIENDA.ALQUILER', 'INGRESOS.ANTICRETICO'],
  ),
  hoja(
    'GASTOS.VIVIENDA.LIMPIEZA',
    'Limpieza y trabajo doméstico',
    'Empleada del hogar, servicio de limpieza y jardinería contratados para la vivienda.',
    'GASTOS.VIVIENDA',
    [
      'PAGO EMPLEADA DOMESTICA',
      'PAGO TRABAJADORA DEL HOGAR',
      'PAGO SERVICIO DE LIMPIEZA',
      'PAGO SERVICIO DE LIMPIEZA DOMICILIO',
      'PAGO JARDINERIA',
      'PAGO SERVICIO DE JARDINERIA',
      'PAGO PERSONAL DE LIMPIEZA HOGAR',
      'PAGO LAVADO DE ALFOMBRAS',
    ],
    [
      // La planilla de una empresa es otra hoja: aquí no hay nómina.
      'PAGO PLANILLA SUELDOS',
      'PAGO SERVICIO DE PLOMERIA',
      'PAGO SERVICIO DE LIMPIEZA INDUSTRIAL PLANTA',
    ],
    ['GASTOS.VIVIENDA.MANTENIMIENTO'],
  ),
  hoja(
    'GASTOS.VIVIENDA.SEGURIDAD',
    'Seguridad del domicilio',
    'Alarma monitoreada, portería y vigilancia contratadas para la vivienda o el condominio.',
    'GASTOS.VIVIENDA',
    [
      'PAGO ALARMA MONITOREADA',
      'PAGO SERVICIO DE MONITOREO ALARMA',
      'PAGO EMPRESA DE SEGURIDAD DOMICILIO',
      'PAGO VIGILANCIA CONDOMINIO',
      'PAGO SERVICIO DE PORTERIA',
      'PAGO CUOTA SEGURIDAD BARRIAL',
      'PAGO GUARDIA DE SEGURIDAD VIVIENDA',
    ],
    [
      'PAGO EXPENSAS EDIFICIO',
      // La vigilancia de una empresa vive en el bloque empresarial.
      'PAGO SERVICIO DE VIGILANCIA PLANTA INDUSTRIAL',
      'PAGO PRIMA SEGURO DE VIDA',
    ],
    ['GASTOS.VIVIENDA.EXPENSAS'],
  ),
  hoja(
    'GASTOS.VIVIENDA.MUDANZA',
    'Mudanza',
    'Traslado de enseres a otra vivienda: camión, embalaje y personal de carga.',
    'GASTOS.VIVIENDA',
    [
      'PAGO SERVICIO DE MUDANZA',
      'PAGO MUDANZA DOMICILIO',
      'PAGO TRASLADO DE MUEBLES',
      'PAGO CAMION DE MUDANZA',
      'PAGO EMBALAJE Y MUDANZA',
    ],
    [
      // El flete de mercadería es logística del negocio, no una mudanza.
      'LOGISTICA FLETE',
      'TRANSPORTE DE CARGA',
      'COMPRA DE MUEBLES PARA EL HOGAR',
    ],
    ['GASTOS.EMPRESARIALES.LOGISTICA'],
  ),
  hoja(
    'GASTOS.VIVIENDA.ASEO',
    'Tasa de aseo y recojo de basura',
    'Tasa municipal de aseo urbano y recojo de residuos que se cobra por el domicilio.',
    'GASTOS.VIVIENDA',
    [
      'PAGO TASA DE ASEO',
      'PAGO TASA DE ASEO URBANO',
      'PAGO RECOJO DE BASURA',
      'PAGO SERVICIO DE ASEO MUNICIPAL',
      'PAGO EMSA ASEO URBANO',
      'TASA ASEO DOMICILIARIO',
    ],
    ['PAGO SERVICIO ELECTRICO', 'PAGO IMPUESTO A LA PROPIEDAD', 'PAGO SERVICIO DE LIMPIEZA'],
    ['GASTOS.VIVIENDA.SERVICIOS', 'GASTOS.IMPUESTOS'],
  ),

  // ==========================================================================
  // Alimentación
  // ==========================================================================
  hoja(
    'GASTOS.ALIMENTACION.LICORERIA',
    'Bebidas alcohólicas',
    'Compra de cerveza, vino o licores en licorería o distribuidora, para llevar.',
    'GASTOS.ALIMENTACION',
    [
      'COMPRA EN LICORERIA',
      'COMPRA DE BEBIDAS ALCOHOLICAS',
      'PAGO POS LICORERIA',
      'COMPRA CERVEZA DISTRIBUIDORA',
      'COMPRA DE VINOS Y LICORES',
      'PAGO POS VINOTECA',
      'POS LICORERIA',
    ],
    [
      // Consumir en el local es restaurante; llevarse la botella, licorería.
      'CONSUMO EN RESTAURANTE',
      'COMPRA SUPERMERCADO',
      'CONSUMO EN CAFETERIA',
    ],
    ['GASTOS.ALIMENTACION.SUPERMERCADO'],
  ),

  // ==========================================================================
  // Transporte
  //
  // Las tres hojas que siguen NO son rubros nuevos: son rubros que estaban
  // dentro de `GASTOS.TRANSPORTE.COMBUSTIBLE`, cuya descripción prometía
  // «carburante, mantenimiento, seguro y trámites». Cuatro hechos distintos en
  // una hoja hacen que su vector describa un promedio de los cuatro y que el
  // informe no pueda separar lo que se gasta en gasolina de lo que se gasta en
  // el taller. Los ejemplos se MUEVEN aquí y Combustible los recibe como
  // contraejemplo.
  // ==========================================================================
  hoja(
    'GASTOS.TRANSPORTE.TALLER',
    'Taller y mantenimiento del vehículo',
    'Mecánica, cambio de aceite, lubricentro y lavado del vehículo propio.',
    'GASTOS.TRANSPORTE',
    [
      'PAGO MANTENIMIENTO VEHICULO',
      'PAGO CAMBIO DE ACEITE',
      'PAGO TALLER MECANICO',
      'PAGO SERVICIO DE MECANICA',
      'PAGO POS LUBRICANTES Y SERVICIOS',
      'PAGO LUBRICENTRO',
      'PAGO LAVADO DE VEHICULO',
      'PAGO POS LAVADERO DE AUTOS',
      'PAGO ALINEACION Y BALANCEO',
      'PAGO REPARACION AUTOMOTRIZ',
      'POS TALLER AUTOMOTRIZ',
    ],
    [
      'COMPRA GASOLINA SURTIDOR',
      'COMPRA REPUESTOS AUTOMOTRIZ',
      'MANTENIMIENTO MAQUINARIA AGRICOLA',
    ],
    ['GASTOS.TRANSPORTE.COMBUSTIBLE', 'GASTOS.TRANSPORTE.REPUESTOS'],
  ),
  hoja(
    'GASTOS.TRANSPORTE.REPUESTOS',
    'Repuestos y accesorios del vehículo',
    'Piezas, llantas, baterías y accesorios comprados para el vehículo propio.',
    'GASTOS.TRANSPORTE',
    [
      'COMPRA REPUESTOS AUTOMOTRIZ',
      'COMPRA DE REPUESTOS',
      'COMPRA LLANTAS',
      'PAGO POS REPUESTOS',
      'COMPRA BATERIA VEHICULO',
      'PAGO POS AUTOPARTES',
      'COMPRA ACCESORIOS VEHICULO',
      'POS REPUESTOS Y ACCESORIOS',
    ],
    ['PAGO TALLER MECANICO', 'COMPRA GASOLINA SURTIDOR', 'COMPRA ACCESORIOS INFORMATICOS'],
    ['GASTOS.TRANSPORTE.TALLER'],
  ),
  hoja(
    'GASTOS.TRANSPORTE.SEGURO',
    'Seguro del vehículo',
    'SOAT y póliza de seguro automotor del vehículo propio.',
    'GASTOS.TRANSPORTE',
    [
      'PAGO SEGURO OBLIGATORIO SOAT',
      'PAGO SEGURO OBLIGATORIO DE ACCIDENTES DE TRANSITO',
      'COMPRA ROSETA SOAT',
      'PAGO SEGURO AUTOMOTOR',
      'PAGO SEGURO VEHICULAR POLIZA',
      'PAGO PRIMA SEGURO DEL VEHICULO',
      'PAGO SOAT GESTION',
    ],
    [
      // La prima genérica de vida u hogar es la hoja financiera de seguros.
      'PAGO PRIMA SEGURO DE VIDA',
      'PAGO SEGURO DE DESGRAVAMEN',
      'COMPRA GASOLINA SURTIDOR',
    ],
    ['GASTOS.FINANCIEROS.SEGUROS'],
  ),
  hoja(
    'GASTOS.TRANSPORTE.TRAMITES',
    'Trámites del vehículo',
    'Inspección técnica, matriculación, transferencia y licencia de conducir.',
    'GASTOS.TRANSPORTE',
    [
      'PAGO INSPECCION TECNICA VEHICULAR',
      'PAGO REVISION TECNICA VEHICULAR',
      'PAGO MATRICULACION VEHICULO',
      'PAGO TRANSFERENCIA DE VEHICULO',
      'PAGO LICENCIA DE CONDUCIR',
      'PAGO TRAMITE RUAT VEHICULO',
      'PAGO CERTIFICADO DE REGISTRO VEHICULAR',
    ],
    [
      // El tributo anual del vehículo es un impuesto, no un trámite.
      'PAGO IMPUESTO VEHICULOS',
      'RUAT IMPUESTO VEHICULAR',
      'PAGO SEGURO OBLIGATORIO SOAT',
    ],
    ['GASTOS.IMPUESTOS', 'GASTOS.TRANSPORTE.SEGURO'],
  ),

  // ==========================================================================
  // Salud
  // ==========================================================================
  hoja(
    'GASTOS.SALUD.SEGURO',
    'Seguro de salud',
    'Prima de un seguro médico o de una prepaga: se paga esté uno enfermo o no.',
    'GASTOS.SALUD',
    [
      'PAGO SEGURO DE SALUD',
      'PAGO SEGURO DE SALUD PREPAGO',
      'PAGO PRIMA SEGURO MEDICO',
      'PAGO SEGURO MEDICO FAMILIAR',
      'PAGO PLAN DE SALUD PREPAGADO',
      'DEBITO PRIMA SEGURO SALUD',
    ],
    [
      // Una consulta se paga por atenderse; una prima, por estar cubierto.
      'PAGO CONSULTA MEDICA',
      'PAGO CLINICA INTERNACION',
      'PAGO SEGURO OBLIGATORIO SOAT',
    ],
    ['GASTOS.SALUD.ATENCION', 'GASTOS.FINANCIEROS.SEGUROS'],
  ),
  hoja(
    'GASTOS.SALUD.OPTICA',
    'Óptica',
    'Lentes, armazones, lentes de contacto y examen de la vista.',
    'GASTOS.SALUD',
    [
      'COMPRA EN OPTICA',
      'PAGO POS OPTICA',
      'COMPRA DE LENTES',
      'COMPRA LENTES DE CONTACTO',
      'PAGO EXAMEN DE LA VISTA',
      'PAGO POS OPTICA VISION',
      'COMPRA ARMAZON Y CRISTALES',
    ],
    ['COMPRA EN FARMACIA', 'PAGO CONSULTA MEDICA', 'PAGO POS PERFUMERIA'],
    ['GASTOS.SALUD.ATENCION'],
  ),
  hoja(
    'GASTOS.SALUD.IMAGENOLOGIA',
    'Estudios por imágenes',
    'Radiografía, ecografía, tomografía y resonancia solicitadas por un médico.',
    'GASTOS.SALUD',
    [
      'PAGO RADIOGRAFIA',
      'PAGO ECOGRAFIA',
      'PAGO TOMOGRAFIA',
      'PAGO RESONANCIA MAGNETICA',
      'PAGO CENTRO DE IMAGENOLOGIA',
      'PAGO ESTUDIO POR IMAGENES',
      'POS IMAGENOLOGIA',
    ],
    ['PAGO LABORATORIO ANALISIS CLINICOS', 'PAGO CONSULTA MEDICA', 'COMPRA EN FARMACIA'],
    ['GASTOS.SALUD.ATENCION'],
  ),
  hoja(
    'GASTOS.SALUD.TERAPIA',
    'Terapias y rehabilitación',
    'Fisioterapia, kinesiología, psicología, fonoaudiología y rehabilitación.',
    'GASTOS.SALUD',
    [
      'PAGO FISIOTERAPIA',
      'PAGO SESION DE KINESIOLOGIA',
      'PAGO CONSULTA PSICOLOGICA',
      'PAGO TERAPIA PSICOLOGICA',
      'PAGO CENTRO DE REHABILITACION',
      'PAGO TERAPIA DE LENGUAJE',
      'POS FISIOTERAPIA',
    ],
    ['PAGO CONSULTA MEDICA', 'PAGO GIMNASIO MENSUALIDAD', 'PAGO POS SPA'],
    ['GASTOS.SALUD.ATENCION'],
  ),
  hoja(
    'GASTOS.SALUD.EMERGENCIA',
    'Emergencia y ambulancia',
    'Atención de urgencia y traslado en ambulancia.',
    'GASTOS.SALUD',
    [
      'PAGO SERVICIO DE AMBULANCIA',
      'PAGO ATENCION DE EMERGENCIA',
      'PAGO SALA DE EMERGENCIAS',
      'PAGO TRASLADO EN AMBULANCIA',
      'PAGO URGENCIA MEDICA',
    ],
    ['PAGO CONSULTA MEDICA', 'PAGO CLINICA INTERNACION', 'PAGO VIAJE EN TAXI'],
    ['GASTOS.SALUD.ATENCION'],
  ),

  // ==========================================================================
  // Ocio
  // ==========================================================================
  hoja(
    'GASTOS.OCIO.VIDEOJUEGOS',
    'Videojuegos',
    'Compra de juegos, recarga de créditos y tiendas de consola en línea.',
    'GASTOS.OCIO',
    [
      'COMPRA INTERNET EXT STEAM',
      'COMPRA INTERNET EXT PLAYSTATION',
      'COMPRA INTERNET EXT XBOX',
      'COMPRA INTERNET EXT NINTENDO',
      'COMPRA INTERNET EXT ROBLOX',
      'COMPRA INTERNET EXT FREE FIRE',
      'RECARGA DE CREDITOS JUEGO EN LINEA',
      'COMPRA DE VIDEOJUEGO',
    ],
    ['COMPRA INTERNET EXT NETFLIX', 'PAGO SUSCRIPCION STREAMING', 'COMPRA EQUIPO ELECTRONICO'],
    ['GASTOS.OCIO.SUSCRIPCIONES'],
  ),
  hoja(
    'GASTOS.OCIO.AZAR',
    'Juegos de azar y apuestas',
    'Casino, lotería, bingo y casas de apuestas deportivas.',
    'GASTOS.OCIO',
    [
      'PAGO POS CASINO',
      'COMPRA BILLETE DE LOTERIA',
      'PAGO CASA DE APUESTAS',
      'COMPRA INTERNET EXT APUESTAS DEPORTIVAS',
      'PAGO BINGO',
      'PAGO POS SALA DE JUEGOS',
      'RECARGA CUENTA DE APUESTAS',
    ],
    ['COMPRA ENTRADA PARTIDO FUTBOL', 'PAGO POS CINEMARK', 'APORTE FONDO DE INVERSION'],
    ['GASTOS.OCIO.EVENTOS'],
  ),
  hoja(
    'GASTOS.OCIO.CLUB',
    'Club y actividad deportiva',
    'Cuota de club social o deportivo, alquiler de cancha y escuela deportiva.',
    'GASTOS.OCIO',
    [
      'PAGO CUOTA CLUB SOCIAL',
      'PAGO CUOTA CLUB DEPORTIVO',
      'PAGO ALQUILER DE CANCHA',
      'PAGO ESCUELA DE FUTBOL',
      'PAGO ACADEMIA DEPORTIVA',
      'PAGO MEMBRESIA CLUB',
      'PAGO CLASES DE NATACION',
    ],
    [
      'PAGO GIMNASIO MENSUALIDAD',
      'COMPRA ENTRADA PARTIDO FUTBOL',
      'PAGO CUOTA CONDOMINIO LAS PALMAS',
    ],
    ['GASTOS.PERSONAL.CUIDADO'],
  ),
  hoja(
    'GASTOS.OCIO.CELEBRACIONES',
    'Celebraciones y eventos sociales',
    'Salón de eventos, catering, decoración y fotografía de una celebración propia.',
    'GASTOS.OCIO',
    [
      'PAGO SALON DE EVENTOS',
      'PAGO SERVICIO DE CATERING',
      'PAGO BANQUETE EVENTO',
      'PAGO DECORACION DE EVENTO',
      'PAGO SERVICIO DE FOTOGRAFIA',
      'PAGO ALQUILER DE TOLDOS Y SILLAS',
      'PAGO ORGANIZACION DE EVENTO SOCIAL',
    ],
    ['CONSUMO EN RESTAURANTE', 'PAGO ENTRADAS CONCIERTO', 'PAGO SERVICIO DE MUDANZA'],
    ['GASTOS.OCIO.EVENTOS', 'GASTOS.ALIMENTACION.RESTAURANTES'],
  ),

  // ==========================================================================
  // Compras
  // ==========================================================================
  hoja(
    'GASTOS.COMPRAS.JOYERIA',
    'Joyería y relojería',
    'Joyas, relojes y artículos de orfebrería.',
    'GASTOS.COMPRAS',
    [
      'COMPRA EN JOYERIA',
      'PAGO POS JOYERIA',
      'COMPRA DE RELOJ',
      'COMPRA ANILLO ORO',
      'PAGO POS RELOJERIA',
      'POS JOYERIA Y RELOJERIA',
    ],
    ['COMPRA EN TIENDA DE ROPA', 'COMPRA TARJETA POS', 'COMPRA DE LENTES'],
    ['GASTOS.COMPRAS.VESTIMENTA'],
  ),
  hoja(
    'GASTOS.COMPRAS.JUGUETERIA',
    'Juguetería y artículos infantiles',
    'Juguetes, coches, cunas y artículos para bebé.',
    'GASTOS.COMPRAS',
    [
      'COMPRA EN JUGUETERIA',
      'PAGO POS JUGUETERIA',
      'COMPRA DE JUGUETES',
      'COMPRA ARTICULOS PARA BEBE',
      'PAGO POS BABY SHOP',
      'COMPRA COCHE DE BEBE',
    ],
    ['COMPRA MATERIAL ESCOLAR', 'COMPRA EN TIENDA DE ROPA', 'COMPRA DE VIDEOJUEGO'],
    ['GASTOS.COMPRAS.LIBRERIA'],
  ),
  hoja(
    'GASTOS.COMPRAS.DEPORTES',
    'Artículos deportivos',
    'Ropa técnica, calzado deportivo, bicicletas y equipamiento para deporte.',
    'GASTOS.COMPRAS',
    [
      'COMPRA ARTICULOS DEPORTIVOS',
      'PAGO POS TIENDA DEPORTIVA',
      'COMPRA DE BICICLETA',
      'COMPRA ZAPATILLAS DEPORTIVAS',
      'PAGO POS MARATHON',
      'COMPRA EQUIPO DE CAMPING',
      'POS ARTICULOS DEPORTIVOS',
    ],
    ['COMPRA EN TIENDA DE ROPA', 'PAGO GIMNASIO MENSUALIDAD', 'PAGO CUOTA CLUB DEPORTIVO'],
    ['GASTOS.COMPRAS.VESTIMENTA', 'GASTOS.OCIO.CLUB'],
  ),
  hoja(
    'GASTOS.COMPRAS.REGALOS',
    'Regalos y floristería',
    'Obsequios, arreglos florales y artículos de regalería.',
    'GASTOS.COMPRAS',
    [
      'COMPRA EN FLORERIA',
      'PAGO POS FLORERIA',
      'COMPRA ARREGLO FLORAL',
      'COMPRA EN TIENDA DE REGALOS',
      'PAGO POS REGALERIA',
      'COMPRA DE OBSEQUIO',
      'COMPRA CANASTA DE REGALO',
    ],
    ['COMPRA EN JUGUETERIA', 'DONACION FUNDACION', 'COMPRA EN TIENDA DE ROPA'],
    ['GASTOS.PERSONAL.DONACIONES'],
  ),
  hoja(
    'GASTOS.COMPRAS.VEHICULO',
    'Compra de vehículo',
    'Adquisición de un automóvil, motocicleta o cuadratrack en concesionaria o importadora.',
    'GASTOS.COMPRAS',
    [
      'COMPRA DE VEHICULO',
      'PAGO CONCESIONARIA AUTOMOTRIZ',
      'PAGO COMPRA DE AUTOMOVIL',
      'COMPRA DE MOTOCICLETA',
      'PAGO IMPORTADORA DE VEHICULOS',
      'PAGO ANTICIPO COMPRA VEHICULO',
    ],
    [
      // La cuota mensual del crédito del auto es una amortización de deuda.
      'PAGO CUOTA PRESTAMO',
      'COMPRA REPUESTOS AUTOMOTRIZ',
      'ALQUILER VEHICULO',
    ],
    ['GASTOS.FINANCIEROS.PRESTAMOS', 'INGRESOS.VENTA'],
  ),

  // ==========================================================================
  // Persona
  // ==========================================================================
  hoja(
    'GASTOS.PERSONAL.LAVANDERIA',
    'Lavandería y sastrería',
    'Lavado, planchado, tintorería y arreglos de ropa.',
    'GASTOS.PERSONAL',
    [
      'PAGO LAVANDERIA',
      'PAGO POS LAVANDERIA',
      'PAGO TINTORERIA',
      'PAGO SERVICIO DE PLANCHADO',
      'PAGO SASTRERIA ARREGLO DE ROPA',
      'POS LAVANDERIA Y TINTORERIA',
    ],
    ['COMPRA EN TIENDA DE ROPA', 'PAGO SERVICIO DE LIMPIEZA', 'PAGO LAVADO DE VEHICULO'],
    ['GASTOS.VIVIENDA.LIMPIEZA'],
  ),
  hoja(
    'GASTOS.PERSONAL.FUNERARIA',
    'Servicios funerarios',
    'Sepelio, funeraria, cementerio y planes exequiales.',
    'GASTOS.PERSONAL',
    [
      'PAGO SERVICIO FUNERARIO',
      'PAGO FUNERARIA',
      'PAGO SERVICIO DE SEPELIO',
      'PAGO PLAN EXEQUIAL',
      'PAGO CEMENTERIO NICHO',
      'PAGO POS FUNERARIA',
    ],
    ['PAGO PRIMA SEGURO DE VIDA', 'PAGO CLINICA INTERNACION', 'DONACION FUNDACION'],
    ['GASTOS.FINANCIEROS.SEGUROS'],
  ),
  hoja(
    'GASTOS.PERSONAL.MEMBRESIAS',
    'Cuotas y membresías institucionales',
    'Aportes a colegios profesionales, sindicatos, cooperativas y asociaciones gremiales.',
    'GASTOS.PERSONAL',
    [
      'PAGO CUOTA COLEGIO DE ABOGADOS',
      'PAGO COLEGIO PROFESIONAL',
      'PAGO CUOTA SINDICAL',
      'APORTE COOPERATIVA',
      'PAGO CUOTA ASOCIACION GREMIAL',
      'PAGO MEMBRESIA CAMARA DE COMERCIO',
      'PAGO CUOTA ANUAL COLEGIATURA PROFESIONAL',
    ],
    ['PAGO CUOTA CLUB SOCIAL', 'PAGO MATRICULA UNIVERSITARIA', 'PAGO CUOTA CONDOMINIO LAS PALMAS'],
    ['GASTOS.OCIO.CLUB'],
  ),
];

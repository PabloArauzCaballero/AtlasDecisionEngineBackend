import type { Regla } from './glosa-regla';

/**
 * Rubros de la capa 1 — Transporte, alimentación, salud y educación.
 * Ver `glosa-rubros.ts` para el orden entre grupos, que importa.
 */
export const RUBROS_TRANSPORTE_ALIMENTACION_SALUD: readonly Regla[] = [
  // --- Transporte ----------------------------------------------------------
  {
    patron:
      /\b(?:GASOLINA|DIESEL|SURTIDOR|ESTACION\s+DE\s+SERVICIO|COMBUSTIBLE|PETROBRAS|SHELL|GNV)\b/u,
    salida: ['GASTOS.TRANSPORTE.COMBUSTIBLE'],
    entrada: [],
    porque: 'la glosa declara la compra de combustible',
    certeza: 'ALTA',
  },
  {
    patron: /\bSOAT\b/u,
    salida: ['GASTOS.TRANSPORTE.SEGURO', 'GASTOS.FINANCIEROS.SEGUROS'],
    entrada: [],
    porque: 'la glosa nombra el seguro obligatorio de accidentes de tránsito',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:TAXI|YANGO|UBER|INDRIVE|TRUFI|MICRO|PUMAKATARI|TELEFERICO|MI\s+TELEFERICO)\b/u,
    salida: ['GASTOS.TRANSPORTE.PUBLICO'],
    entrada: [],
    porque: 'la glosa nombra un servicio de transporte de pasajeros',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:PARQUEO|ESTACIONAMIENTO|PARKING)\b/u,
    salida: ['GASTOS.TRANSPORTE.ESTACIONAMIENTO'],
    entrada: [],
    porque: 'la glosa declara un parqueo',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:TALLER|MECANIC|LUBRICENTRO|LLANTER|VULCANIZ|ALINEACION|BALANCEO)/u,
    salida: ['GASTOS.TRANSPORTE.TALLER'],
    entrada: [],
    porque: 'la glosa nombra un taller mecánico',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:REPUESTOS?|AUTOPARTES|ACCESORIOS\s+AUTOMOTRIZ)\b/u,
    salida: ['GASTOS.TRANSPORTE.REPUESTOS'],
    entrada: [],
    porque: 'la glosa nombra la compra de repuestos',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ROSETA|INSPECCION\s+TECNICA|RUAT|PLACA|TRANSITO)\b/u,
    salida: ['GASTOS.TRANSPORTE.TRAMITES'],
    entrada: [],
    porque: 'la glosa declara un trámite vehicular',
    certeza: 'MEDIA',
  },

  // --- Alimentación --------------------------------------------------------
  {
    patron:
      /\b(?:HIPERMAXI|FIDALGA|IC\s*NORTE|KETAL|TIA\b|SUPERMERCADO|MERCADO|MINIMARKET|ABASTO)\b/u,
    salida: ['GASTOS.ALIMENTACION.SUPERMERCADO'],
    entrada: [],
    porque: 'la glosa nombra un supermercado o mercado de abasto',
    certeza: 'ALTA',
  },
  {
    patron:
      /\b(?:RESTAURANT|CHURRASQUERIA|PIZZER|BURGER|POLLOS?\s+COPACABANA|KFC|SUBWAY|PEDIDOSYA|YAIGO|DELIVERY|ALMUERZO|CITRONNELLE|ZUCCHINI|BOLIVIAN\s+FOODS)\b/u,
    salida: ['GASTOS.ALIMENTACION.RESTAURANTES'],
    entrada: [],
    porque: 'la glosa nombra un restaurante o un pedido de comida',
    certeza: 'ALTA',
  },
  /*
   * Los nombres que siguen a los genéricos salen de extractos bolivianos reales
   * (2026-09-01): son las cafeterías que aparecían archivadas como «compra con
   * tarjeta» porque el catálogo no las conocía y el modelo no llegaba al umbral.
   *
   * Van aquí, en el código, y no sólo como ejemplos del catálogo sembrado, por
   * una razón práctica: el catálogo vive en la base y una instalación limpia lo
   * pierde, mientras que una regla de rubro viaja con el repositorio y no
   * depende de que alguien haya sembrado nada. Es la misma decisión que ya
   * sostenía a HIPERMAXI, FARMACORP o STARBUCKS.
   */
  {
    patron:
      /\b(?:CAFE|CAFETERIA|STARBUCKS|ALEXANDER\s+COFFEE|VAINILLA|HELADERIA|PANADERIA|AGRICAFE|COFI|CAFFE\s+DEL\s+BARRIO|L\s+AROME|LLAO\s+LLAO|DONUTS)\b/u,
    salida: ['GASTOS.ALIMENTACION.CAFETERIA'],
    entrada: [],
    porque: 'la glosa nombra una cafetería o panadería',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:LICORERIA|CERVECERIA|BODEGA\s+DE\s+VINOS|DESTILERIA)\b/u,
    salida: ['GASTOS.ALIMENTACION.LICORERIA'],
    entrada: [],
    porque: 'la glosa nombra una licorería',
    certeza: 'ALTA',
  },

  // --- Salud ---------------------------------------------------------------
  {
    patron: /\b(?:FARMACIA|FARMACORP|CHAVEZ|BOLIVIANA\s+DE\s+FARMACIAS|BOTICA|DROGUERIA)\b/u,
    salida: ['GASTOS.SALUD.FARMACIA'],
    entrada: [],
    porque: 'la glosa nombra una farmacia',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:CLINICA|HOSPITAL|CONSULTORIO|ODONTOLOG|DENTAL|MEDICO|LABORATORIO\s+CLINICO)\b/u,
    salida: ['GASTOS.SALUD.ATENCION'],
    entrada: [],
    porque: 'la glosa nombra una atención médica',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:OPTICA|LENTES|OFTALMOLOG)/u,
    salida: ['GASTOS.SALUD.OPTICA'],
    entrada: [],
    porque: 'la glosa nombra una óptica',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:ECOGRAFIA|TOMOGRAFIA|RESONANCIA|RADIOGRAFIA|IMAGENOLOGIA|RAYOS\s*X)\b/u,
    salida: ['GASTOS.SALUD.IMAGENOLOGIA'],
    entrada: [],
    porque: 'la glosa nombra un estudio por imágenes',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:FISIOTERAPIA|KINESIOLOG|PSICOLOG|TERAPIA|REHABILITACION)/u,
    salida: ['GASTOS.SALUD.TERAPIA'],
    entrada: [],
    porque: 'la glosa nombra una terapia',
    certeza: 'ALTA',
  },
  {
    patron: /\b(?:EMERGENCIA|AMBULANCIA|URGENCIAS)\b/u,
    salida: ['GASTOS.SALUD.EMERGENCIA'],
    entrada: [],
    porque: 'la glosa declara una atención de emergencia',
    certeza: 'MEDIA',
  },

  // --- Educación -----------------------------------------------------------
  {
    patron:
      /\b(?:COLEGIO|UNIVERSIDAD|UAGRM|UPSA|UCB|UMSA|UMSS|UNIFRANZ|UTEPSA|NUR\b|INSTITUTO|MENSUALIDAD|PENSION\s+ESCOLAR|MATRICULA|GUARDERIA|PREUNIVERSITARIO|CURSO|DIPLOMADO|MAESTRIA)\b/u,
    salida: ['GASTOS.EDUCACION'],
    entrada: [],
    porque: 'la glosa nombra una institución educativa o una cuota de estudios',
    certeza: 'ALTA',
  },
];

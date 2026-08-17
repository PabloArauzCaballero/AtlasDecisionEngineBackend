/**
 * La CARTERA de demostración: las decisiones que la auditoría del portal audita.
 *
 * Todo lo que el portal llama «auditoría» —el buscador de ejecuciones, la bitácora
 * encadenada, la calidad de la decisión, la vigilancia del modelo y el gobierno del
 * riesgo— cuelga de una sola cosa: decisiones tomadas sobre personas, con desenlace
 * observado meses después. Sin esas filas las siete pantallas existen, responden 200 y
 * enseñan cabeceras sobre listas vacías, que es indistinguible de un sistema sano.
 *
 * ## Por qué los casos están escritos a mano y no generados
 *
 * Un generador produce volumen y ninguna historia: veinte solicitantes idénticos con el
 * puntaje movido al azar no enseñan lo que estas pantallas existen para enseñar —una
 * cosecha que se tuerce, un rechazo que se habría comportado bien, un grupo de edad con
 * peor tasa de aprobación que el resto—. Cada fila de aquí abajo es un caso con
 * intención; por eso son veinticuatro y no dos mil.
 *
 * ## La referencia del solicitante NO se persiste
 *
 * `referencia` es el carnet en claro, y sólo entra aquí para calcular el mismo HMAC que
 * usa el motor (`HashService.hmac`). Lo que se guarda es el hash, igual que en producción.
 * Se declara en claro por una razón concreta: la pantalla de solicitudes de titular pide
 * la referencia en claro para buscar, así que sin conocerla no se puede ejercitar. Son
 * carnets INVENTADOS —ninguno pertenece a una persona—, y por eso pueden estar escritos.
 *
 * ## Los atributos demográficos están para MEDIR SESGO, nunca para decidir
 *
 * `bandaEdad`, `genero` y `regional` se escriben en `decision_monitoring_attribute`, que
 * es la tabla que el motor jamás lee al decidir (ver su comentario en el esquema). Van en
 * bandas y no en valores exactos porque para medir impacto adverso basta el grupo.
 */

import type { ObservedOutcomeLabel } from '@prisma/client';

/**
 * Quién hace cada cosa. Son correos de personas que EXISTEN en el proveedor de identidad
 * para el tenant de siembra (`iam.internal_users`, tenant 1): un actor de auditoría que no
 * corresponde a nadie es una firma que no se puede pedir explicar, y convierte la columna
 * «Actor» de la bitácora en decoración.
 *
 * Los dos últimos NO son personas y lo dicen en el prefijo. Un trabajo periódico que firma
 * con nombre de persona es peor que uno que firma con el suyo: obliga a averiguar por qué
 * alguien estaba midiendo la deriva a las tres de la mañana.
 */
export const AUDIT_CAST = {
  /** Analista de riesgo: diseña el grafo y pide la aprobación. */
  autora: 'carla.mendoza@atlas.test',
  /** Gerente de riesgo: aprueba. Nunca es quien pidió — es la separación de funciones. */
  aprobador: 'hugo.villarroel@atlas.test',
  /** Cumplimiento: licitud del tratamiento, solicitudes de titular, reidentificación. */
  cumplimiento: 'lucia.arispe@atlas.test',
  /** Operaciones: promueve a producción y resuelve la cola de revisión manual. */
  operaciones: 'marco.tarifa@atlas.test',
  /** Calidad: corre la regresión antes de que nada se promueva. */
  calidad: 'sofia.quiroga@atlas.test',
  /** Auditoría interna: sólo lectura; aparece verificando la cadena. */
  auditoria: 'auditoria.interna@atlas.test',
  /** Riesgo operativo: carga los desenlaces que llegan del core de cartera. */
  riesgoOps: 'risk.ops@atlas.test',
  /** El trabajo periódico de vigilancia. No es una persona. */
  vigilancia: 'servicio:monitoring-evaluator',
  /** El propio motor, al ejecutar una decisión. No es una persona. */
  runtime: 'servicio:decision-runtime',
} as const;

export type RegionalBoliviana =
  'SANTA_CRUZ' | 'LA_PAZ' | 'COCHABAMBA' | 'TARIJA' | 'ORURO' | 'CHUQUISACA';

/** Un desenlace observado sobre una ventana concreta. */
export interface DesenlaceDemo {
  /** Ventana en días. La misma decisión puede observarse a 30, 90 y 180. */
  ventanaDias: number;
  etiqueta: ObservedOutcomeLabel;
  /** Importe asociado, cuando lo hay: saldo perdido, cuota impaga. En bolivianos. */
  monto?: number;
  /**
   * Cómo se supo, cuando NO se observó directamente. Nulo = observado.
   * Un desenlace inferido sobre un rechazado mezclado con los observados calibra el
   * modelo contra la población que ya se aprobó y lo hace parecer perfecto.
   */
  metodoInferencia?: string;
  /** De dónde salió: sistema de cobranza, confirmación de fraude, carga manual. */
  origen: string;
  nota?: string;
}

export interface CasoDemo {
  /** Carnet en claro. NO se persiste: sólo alimenta el HMAC. Ver cabecera del archivo. */
  referencia: string;
  /** Sufijo del identificador del crédito en el core de cartera. */
  folio: string;
  regional: RegionalBoliviana;
  bandaEdad: '18-25' | '26-35' | '36-50' | '51-65';
  genero: 'F' | 'M';
  /** Hace cuántos días se tomó la decisión. Relativo para que el demo no envejezca. */
  diasAtras: number;
  desenlace: 'APPROVED' | 'DECLINED' | 'MANUAL_REVIEW';
  /** Monto pedido, en bolivianos. */
  montoSolicitado: number;
  /** Monto concedido. Sólo en aprobadas, y puede ser menor que el pedido. */
  montoAprobado?: number;
  plazoMeses: number;
  /** Tasa anual efectiva, en tanto por uno. */
  tasaAnual: number;
  /** Puntaje de riesgo crediticio 0..1000 que produjo el grafo. */
  puntaje: number;
  /** Probabilidad de incumplimiento estimada, en tanto por uno. */
  probabilidadIncumplimiento: number;
  /** Códigos de motivo emitidos. Han de existir en el catálogo sembrado. */
  motivos: readonly string[];
  /** Qué se observó después. Vacío = todavía nadie lo miró (ésa es la cola de trabajo). */
  observaciones: readonly DesenlaceDemo[];
  /** Milisegundos que tardó el motor. */
  duracionMs: number;
}

/**
 * Veinticuatro decisiones de originación BNPL repartidas en catorce meses.
 *
 * La forma del conjunto está elegida, no es aleatoria:
 *
 * - **Catorce meses** para que la matriz de cosechas tenga más de una fila y se pueda ver
 *   que la cosecha de octubre se comportó peor que la de junio.
 * - **Cinco casos sin observar con la ventana ya vencida**, que es lo que da contenido a la
 *   cola de ventanas vencidas de `/decision-quality`. Una cola vacía haría creer que el
 *   circuito de desenlaces está al día cuando lo que pasa es que no hay circuito.
 * - **Dos rechazos con desenlace inferido** (`REJECTED_WOULD_HAVE_BEEN_GOOD` y
 *   `REJECTED_CONFIRMED_BAD`): es la mitad del análisis que casi nadie mide, y la única
 *   que pone precio al coste de oportunidad de un corte demasiado alto.
 * - **Un `INDETERMINATE` explícito**, para distinguir el caso mirado del olvidado.
 * - **Peor comportamiento en la banda 18-25 y en Oruro**, que es lo que hace que el panel
 *   de impacto adverso enseñe algo distinto de un empate perfecto.
 * - **Dos solicitantes repetidos** (`repite` en el folio): un negocio de microcrédito vive
 *   de la segunda decisión sobre la misma persona, y sin repetición `decision_subject`
 *   sería una tabla con exactamente una fila por ejecución, o sea ninguna tabla.
 */
export const CARTERA_DEMO: readonly CasoDemo[] = [
  {
    referencia: 'CI-4821553-SC',
    folio: 'BNPL-2025-0417',
    regional: 'SANTA_CRUZ',
    bandaEdad: '26-35',
    genero: 'F',
    diasAtras: 412,
    desenlace: 'APPROVED',
    montoSolicitado: 3500,
    montoAprobado: 3500,
    plazoMeses: 6,
    tasaAnual: 0.24,
    puntaje: 742,
    probabilidadIncumplimiento: 0.041,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera', nota: 'Al día.' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 180, etiqueta: 'GOOD', origen: 'core-cartera', nota: 'Crédito cancelado.' },
    ],
    duracionMs: 187,
  },
  {
    referencia: 'CI-7193044-LP',
    folio: 'BNPL-2025-0431',
    regional: 'LA_PAZ',
    bandaEdad: '36-50',
    genero: 'M',
    diasAtras: 398,
    desenlace: 'APPROVED',
    montoSolicitado: 8000,
    montoAprobado: 6000,
    plazoMeses: 12,
    tasaAnual: 0.27,
    puntaje: 668,
    probabilidadIncumplimiento: 0.083,
    motivos: ['APPROVED_POLICY', 'SCORE_BAND_BORDERLINE'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      {
        ventanaDias: 180,
        etiqueta: 'BAD',
        monto: 4200,
        origen: 'core-cobranza',
        nota: 'Mora mayor a 90 días; pasa a gestión judicial.',
      },
    ],
    duracionMs: 211,
  },
  {
    referencia: 'CI-6640281-OR',
    folio: 'BNPL-2025-0452',
    regional: 'ORURO',
    bandaEdad: '18-25',
    genero: 'M',
    diasAtras: 371,
    desenlace: 'APPROVED',
    montoSolicitado: 2500,
    montoAprobado: 2500,
    plazoMeses: 6,
    tasaAnual: 0.29,
    puntaje: 611,
    probabilidadIncumplimiento: 0.142,
    motivos: ['APPROVED_POLICY', 'SCORE_BAND_BORDERLINE'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      {
        ventanaDias: 90,
        etiqueta: 'BAD',
        monto: 2180,
        origen: 'core-cobranza',
        nota: 'Dejó de pagar en la segunda cuota.',
      },
    ],
    duracionMs: 174,
  },
  {
    referencia: 'CI-2287416-CB',
    folio: 'BNPL-2025-0468',
    regional: 'COCHABAMBA',
    bandaEdad: '36-50',
    genero: 'F',
    diasAtras: 355,
    desenlace: 'DECLINED',
    montoSolicitado: 12000,
    plazoMeses: 18,
    tasaAnual: 0,
    puntaje: 402,
    probabilidadIncumplimiento: 0.318,
    motivos: ['BUREAU_SCORE_TOO_LOW', 'RECENT_CHARGE_OFF'],
    observaciones: [
      {
        ventanaDias: 180,
        etiqueta: 'REJECTED_CONFIRMED_BAD',
        origen: 'buro-infocred',
        metodoInferencia: 'BUREAU_LOOKUP',
        nota: 'Castigo confirmado con otra entidad en el semestre siguiente.',
      },
    ],
    duracionMs: 143,
  },
  {
    referencia: 'CI-5514907-SC',
    folio: 'BNPL-2025-0490',
    regional: 'SANTA_CRUZ',
    bandaEdad: '26-35',
    genero: 'M',
    diasAtras: 338,
    desenlace: 'APPROVED',
    montoSolicitado: 5000,
    montoAprobado: 5000,
    plazoMeses: 9,
    tasaAnual: 0.25,
    puntaje: 715,
    probabilidadIncumplimiento: 0.052,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 180, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 196,
  },
  {
    referencia: 'CI-3908125-TJ',
    folio: 'BNPL-2025-0511',
    regional: 'TARIJA',
    bandaEdad: '51-65',
    genero: 'F',
    diasAtras: 316,
    desenlace: 'DECLINED',
    montoSolicitado: 4000,
    plazoMeses: 6,
    tasaAnual: 0,
    puntaje: 588,
    probabilidadIncumplimiento: 0.176,
    motivos: ['INSUFFICIENT_DISPOSABLE_INCOME', 'AFFORDABILITY_RATIO_EXCEEDED'],
    observaciones: [
      {
        ventanaDias: 180,
        etiqueta: 'REJECTED_WOULD_HAVE_BEEN_GOOD',
        origen: 'buro-infocred',
        metodoInferencia: 'BUREAU_LOOKUP',
        nota: 'Tomó el mismo importe con otra entidad y lo pagó sin atrasos.',
      },
    ],
    duracionMs: 158,
  },
  {
    referencia: 'CI-4821553-SC',
    folio: 'BNPL-2025-0534-repite',
    regional: 'SANTA_CRUZ',
    bandaEdad: '26-35',
    genero: 'F',
    diasAtras: 295,
    desenlace: 'APPROVED',
    montoSolicitado: 6000,
    montoAprobado: 6000,
    plazoMeses: 12,
    tasaAnual: 0.22,
    puntaje: 781,
    probabilidadIncumplimiento: 0.028,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 180, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 168,
  },
  {
    referencia: 'CI-8802731-LP',
    folio: 'BNPL-2025-0559',
    regional: 'LA_PAZ',
    bandaEdad: '18-25',
    genero: 'F',
    diasAtras: 272,
    desenlace: 'MANUAL_REVIEW',
    montoSolicitado: 3000,
    plazoMeses: 6,
    tasaAnual: 0,
    puntaje: 634,
    probabilidadIncumplimiento: 0.121,
    motivos: ['DOCUMENT_ILLEGIBLE'],
    observaciones: [
      {
        ventanaDias: 90,
        etiqueta: 'INDETERMINATE',
        origen: 'mesa-revision',
        nota: 'Nunca completó el documento; el expediente se cerró sin desembolso.',
      },
    ],
    duracionMs: 233,
  },
  {
    referencia: 'CI-1476390-CB',
    folio: 'BNPL-2025-0587',
    regional: 'COCHABAMBA',
    bandaEdad: '26-35',
    genero: 'M',
    diasAtras: 251,
    desenlace: 'APPROVED',
    montoSolicitado: 10000,
    montoAprobado: 7500,
    plazoMeses: 12,
    tasaAnual: 0.26,
    puntaje: 697,
    probabilidadIncumplimiento: 0.067,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 180, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 204,
  },
  {
    referencia: 'CI-9034812-OR',
    folio: 'BNPL-2025-0612',
    regional: 'ORURO',
    bandaEdad: '18-25',
    genero: 'M',
    diasAtras: 233,
    desenlace: 'APPROVED',
    montoSolicitado: 3000,
    montoAprobado: 3000,
    plazoMeses: 6,
    tasaAnual: 0.29,
    puntaje: 605,
    probabilidadIncumplimiento: 0.155,
    motivos: ['APPROVED_POLICY', 'SCORE_BAND_BORDERLINE'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      {
        ventanaDias: 90,
        etiqueta: 'BAD',
        monto: 2740,
        origen: 'core-cobranza',
        nota: 'Cuatro cuotas impagas consecutivas.',
      },
    ],
    duracionMs: 181,
  },
  {
    referencia: 'CI-6120458-SC',
    folio: 'BNPL-2025-0640',
    regional: 'SANTA_CRUZ',
    bandaEdad: '36-50',
    genero: 'F',
    diasAtras: 210,
    desenlace: 'DECLINED',
    montoSolicitado: 20000,
    plazoMeses: 24,
    tasaAnual: 0,
    puntaje: 552,
    probabilidadIncumplimiento: 0.221,
    motivos: ['PRODUCT_AMOUNT_OUT_OF_RANGE', 'TERM_OUT_OF_RANGE'],
    observaciones: [],
    duracionMs: 121,
  },
  {
    referencia: 'CI-2765099-CH',
    folio: 'BNPL-2025-0663',
    regional: 'CHUQUISACA',
    bandaEdad: '51-65',
    genero: 'M',
    diasAtras: 188,
    desenlace: 'APPROVED',
    montoSolicitado: 4500,
    montoAprobado: 4500,
    plazoMeses: 9,
    tasaAnual: 0.23,
    puntaje: 758,
    probabilidadIncumplimiento: 0.036,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 180, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 172,
  },
  {
    referencia: 'CI-4409877-LP',
    folio: 'BNPL-2026-0018',
    regional: 'LA_PAZ',
    bandaEdad: '26-35',
    genero: 'F',
    diasAtras: 164,
    desenlace: 'APPROVED',
    montoSolicitado: 7000,
    montoAprobado: 7000,
    plazoMeses: 12,
    tasaAnual: 0.24,
    puntaje: 726,
    probabilidadIncumplimiento: 0.048,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 190,
  },
  {
    referencia: 'CI-3318740-TJ',
    folio: 'BNPL-2026-0037',
    regional: 'TARIJA',
    bandaEdad: '36-50',
    genero: 'M',
    diasAtras: 149,
    desenlace: 'MANUAL_REVIEW',
    montoSolicitado: 9000,
    plazoMeses: 12,
    tasaAnual: 0,
    puntaje: 659,
    probabilidadIncumplimiento: 0.098,
    motivos: ['SCORE_BAND_BORDERLINE'],
    observaciones: [
      {
        ventanaDias: 90,
        etiqueta: 'GOOD',
        origen: 'mesa-revision',
        nota: 'La mesa aprobó con importe reducido; el crédito va al día.',
      },
    ],
    duracionMs: 246,
  },
  {
    referencia: 'CI-7845213-CB',
    folio: 'BNPL-2026-0055',
    regional: 'COCHABAMBA',
    bandaEdad: '18-25',
    genero: 'F',
    diasAtras: 131,
    desenlace: 'DECLINED',
    montoSolicitado: 3500,
    plazoMeses: 6,
    tasaAnual: 0,
    puntaje: 471,
    probabilidadIncumplimiento: 0.279,
    motivos: ['EMPLOYMENT_STATUS_NOT_ELIGIBLE'],
    observaciones: [],
    duracionMs: 134,
  },
  {
    referencia: 'CI-1476390-CB',
    folio: 'BNPL-2026-0071-repite',
    regional: 'COCHABAMBA',
    bandaEdad: '26-35',
    genero: 'M',
    diasAtras: 118,
    desenlace: 'APPROVED',
    montoSolicitado: 12000,
    montoAprobado: 12000,
    plazoMeses: 18,
    tasaAnual: 0.21,
    puntaje: 803,
    probabilidadIncumplimiento: 0.022,
    motivos: ['APPROVED_POLICY'],
    observaciones: [
      { ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' },
      { ventanaDias: 90, etiqueta: 'GOOD', origen: 'core-cartera' },
    ],
    duracionMs: 199,
  },
  {
    referencia: 'CI-5567102-SC',
    folio: 'BNPL-2026-0094',
    regional: 'SANTA_CRUZ',
    bandaEdad: '26-35',
    genero: 'M',
    diasAtras: 102,
    desenlace: 'APPROVED',
    montoSolicitado: 5500,
    montoAprobado: 5500,
    plazoMeses: 9,
    tasaAnual: 0.25,
    puntaje: 733,
    probabilidadIncumplimiento: 0.045,
    motivos: ['APPROVED_POLICY'],
    observaciones: [{ ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' }],
    duracionMs: 177,
  },
  {
    referencia: 'CI-8891354-OR',
    folio: 'BNPL-2026-0112',
    regional: 'ORURO',
    bandaEdad: '18-25',
    genero: 'F',
    diasAtras: 88,
    desenlace: 'APPROVED',
    montoSolicitado: 2800,
    montoAprobado: 2800,
    plazoMeses: 6,
    tasaAnual: 0.29,
    puntaje: 598,
    probabilidadIncumplimiento: 0.168,
    motivos: ['APPROVED_POLICY', 'SCORE_BAND_BORDERLINE'],
    observaciones: [
      {
        ventanaDias: 30,
        etiqueta: 'BAD',
        monto: 2800,
        origen: 'core-cobranza',
        nota: 'Primera cuota impaga: comportamiento de fraude de primera parte.',
      },
    ],
    duracionMs: 165,
  },
  {
    referencia: 'CI-2034668-LP',
    folio: 'BNPL-2026-0138',
    regional: 'LA_PAZ',
    bandaEdad: '36-50',
    genero: 'M',
    diasAtras: 71,
    desenlace: 'DECLINED',
    montoSolicitado: 6000,
    plazoMeses: 12,
    tasaAnual: 0,
    puntaje: 388,
    probabilidadIncumplimiento: 0.354,
    motivos: ['KNOWN_FRAUD_DEVICE', 'DEVICE_BLOCKLISTED'],
    observaciones: [],
    duracionMs: 96,
  },
  {
    referencia: 'CI-6673920-CB',
    folio: 'BNPL-2026-0155',
    regional: 'COCHABAMBA',
    bandaEdad: '51-65',
    genero: 'F',
    diasAtras: 58,
    desenlace: 'APPROVED',
    montoSolicitado: 4000,
    montoAprobado: 4000,
    plazoMeses: 9,
    tasaAnual: 0.23,
    puntaje: 769,
    probabilidadIncumplimiento: 0.033,
    motivos: ['APPROVED_POLICY'],
    observaciones: [{ ventanaDias: 30, etiqueta: 'GOOD', origen: 'core-cartera' }],
    duracionMs: 183,
  },
  {
    referencia: 'CI-9912047-SC',
    folio: 'BNPL-2026-0177',
    regional: 'SANTA_CRUZ',
    bandaEdad: '26-35',
    genero: 'F',
    diasAtras: 44,
    desenlace: 'APPROVED',
    montoSolicitado: 9000,
    montoAprobado: 9000,
    plazoMeses: 12,
    tasaAnual: 0.24,
    puntaje: 748,
    probabilidadIncumplimiento: 0.039,
    motivos: ['APPROVED_POLICY'],
    observaciones: [],
    duracionMs: 192,
  },
  {
    referencia: 'CI-3450918-TJ',
    folio: 'BNPL-2026-0198',
    regional: 'TARIJA',
    bandaEdad: '18-25',
    genero: 'M',
    diasAtras: 33,
    desenlace: 'MANUAL_REVIEW',
    montoSolicitado: 3200,
    plazoMeses: 6,
    tasaAnual: 0,
    puntaje: 621,
    probabilidadIncumplimiento: 0.134,
    motivos: ['LIVENESS_CHECK_FAILED'],
    observaciones: [],
    duracionMs: 258,
  },
  {
    referencia: 'CI-7208465-CH',
    folio: 'BNPL-2026-0213',
    regional: 'CHUQUISACA',
    bandaEdad: '36-50',
    genero: 'F',
    diasAtras: 19,
    desenlace: 'APPROVED',
    montoSolicitado: 6500,
    montoAprobado: 6500,
    plazoMeses: 12,
    tasaAnual: 0.25,
    puntaje: 711,
    probabilidadIncumplimiento: 0.055,
    motivos: ['APPROVED_POLICY'],
    observaciones: [],
    duracionMs: 186,
  },
  {
    referencia: 'CI-4128806-LP',
    folio: 'BNPL-2026-0229',
    regional: 'LA_PAZ',
    bandaEdad: '26-35',
    genero: 'M',
    diasAtras: 6,
    desenlace: 'MANUAL_REVIEW',
    montoSolicitado: 15000,
    plazoMeses: 18,
    tasaAnual: 0,
    puntaje: 683,
    probabilidadIncumplimiento: 0.079,
    motivos: ['SCORE_BAND_BORDERLINE'],
    observaciones: [],
    duracionMs: 241,
  },
];

/** Las ventanas que el motor materializa al decidir (`OUTCOME_WINDOW_DAYS` de serie). */
export const VENTANAS_DEMO = [30, 90, 180] as const;

/**
 * Qué ES cada movimiento del extracto, decidido por su glosa.
 *
 * ## Por qué un léxico y no el clasificador semántico
 *
 * El motor ya tiene un worker semántico que clasifica glosas con un árbol de
 * categorías curado y un modelo detrás. Es mejor que esto en precisión y no
 * sirve aquí: la capacidad de pago se calcula DENTRO de la conversión del
 * extracto, en el camino caliente y sin salir a ningún servicio, y un extracto
 * de tres meses trae entre cien y quinientos movimientos. Pagar una inferencia
 * por cada uno convertiría una conversión de dos segundos en una de dos minutos,
 * y ataría el cálculo de capacidad de pago a la disponibilidad de un modelo.
 *
 * El reparto es: este léxico decide DÓNDE cae cada boliviano —que es lo que
 * mueve el número— y el worker semántico, cuando alguien lo pide, explica cada
 * glosa una a una. Son dos preguntas distintas con dos costes distintos.
 *
 * ## Por qué la clasificación de un gasto importa tanto como su importe
 *
 * Porque el disponible no es «ingreso menos gasto». Un extracto donde la persona
 * gastó todo lo que entró no significa que no pueda pagar una cuota: significa
 * que su gasto se ajustó a su ingreso, y buena parte de ese gasto es
 * comprimible. Lo que NO es comprimible —la cuota del préstamo, el seguro, la
 * luz, el alquiler— es lo que hay que restar de verdad. Meter la cena del sábado
 * en el mismo saco que la cuota del banco produce el error clásico de la banca
 * por datos: rechazar a quien gasta mucho y podría pagar, y aprobar a quien
 * gasta poco porque ya no le queda nada después de sus cuotas.
 *
 * ## Sobre el vocabulario
 *
 * Es boliviano y es de extractos reales: las glosas de BNB, Mercantil Santa
 * Cruz, BCP, Unión, Ganadero, Económico y BancoSol, más las del sistema
 * interbancario (ACH, LIP) y las de las billeteras móviles. Se compara sin
 * acentos y en minúsculas porque el mismo banco alterna «devolución» y
 * «devolucion» según el canal por el que genere el PDF.
 */

/** Qué representa un ABONO. */
export type InflowKind =
  /** Sueldo, planilla, remesa periódica de un empleador. Es el ingreso de verdad. */
  | 'PAYROLL'
  /** Cobro de actividad propia: ventas, honorarios, QR de comercio. */
  | 'BUSINESS'
  /** Renta, alquiler, pensión, beneficio social, remesa del exterior. */
  | 'RECURRING_OTHER'
  /** Desembolso de un préstamo o adelanto: entra dinero y nace una deuda. */
  | 'CREDIT_DISBURSEMENT'
  /** Reverso, anulación o devolución de un cargo propio. No es ingreso. */
  | 'REVERSAL'
  /** Traspaso entre cuentas del propio titular. No es ingreso. */
  | 'INTERNAL_TRANSFER'
  /** Intereses, premios, y todo lo que entra una vez y no vuelve. */
  | 'ONE_OFF';

/** Qué representa un CARGO. */
export type OutflowKind =
  /** Cuota de préstamo, tarjeta, leasing, compra a plazos. Compromiso con un tercero. */
  | 'DEBT_SERVICE'
  /** Seguro, aporte a pensiones, cuota de afiliación. Comprometido y no negociable a corto plazo. */
  | 'INSURANCE_CONTRIBUTION'
  /** Servicios básicos, alquiler, colegio, salud. Gasto esencial no comprimible. */
  | 'ESSENTIAL'
  /** Impuestos, ITF, comisiones y mantenimiento de cuenta. */
  | 'TAX_FEE'
  /** Retiro de efectivo. Ni esencial ni discrecional: no se sabe en qué se fue. */
  | 'CASH_WITHDRAWAL'
  /** Traspaso a otra cuenta del titular. */
  | 'INTERNAL_TRANSFER'
  /** Apuestas, casinos, criptoactivos especulativos. Señal de conducta, no gasto. */
  | 'HIGH_RISK'
  /** Todo lo demás: consumo comprimible. */
  | 'DISCRETIONARY';

interface Rule {
  readonly kind: InflowKind | OutflowKind;
  readonly patterns: readonly RegExp[];
}

/**
 * El orden IMPORTA y es de más específico a más general.
 *
 * «PAGO PRESTAMO» y «PAGO SERVICIO LUZ» empiezan igual; si la regla de pagos
 * genéricos fuera antes, la cuota del préstamo caería en gasto esencial y el
 * compromiso más importante del expediente desaparecería del cálculo.
 */
const INFLOW_RULES: readonly Rule[] = [
  {
    kind: 'REVERSAL',
    patterns: [
      /revers/,
      /anulaci?on/,
      /devoluci?on/,
      /extorno/,
      /contrasiento/,
      /nota\s+de\s+credito\s+por\s+error/,
      /rechazo\s+de\s+(pago|transferencia)/,
    ],
  },
  {
    kind: 'CREDIT_DISBURSEMENT',
    patterns: [
      /desembolso/,
      /abono\s+de\s+prestamo/,
      /liquidaci?on\s+de\s+prestamo/,
      /credito\s+otorgado/,
      /adelanto\s+de\s+sueldo/,
      /prestamo\s+(personal|de\s+consumo|otorgado)/,
      /linea\s+de\s+credito\s+utilizada/,
      /avance\s+de\s+efectivo/,
    ],
  },
  {
    kind: 'PAYROLL',
    patterns: [
      /\bhaberes?\b/,
      /planilla/,
      /\bsueldo/,
      /\bsalario/,
      /remuneraci?on/,
      /pago\s+de\s+personal/,
      /abono\s+de\s+haberes/,
      /nomina/,
      /aguinaldo/,
      /bono\s+de\s+produccion/,
      /pago\s+quincena/,
    ],
  },
  {
    kind: 'INTERNAL_TRANSFER',
    patterns: [
      /traspaso\s+(entre|a)\s+(mis\s+)?cuentas/,
      /transferencia\s+propia/,
      /entre\s+cuentas\s+propias/,
      /mismo\s+titular/,
      /traspaso\s+ahorro/,
    ],
  },
  {
    kind: 'BUSINESS',
    patterns: [
      /\bqr\b/,
      /cobro\s+qr/,
      /recaudaci?on/,
      /ventas?\s+(del\s+dia|pos|tarjeta)/,
      /liquidaci?on\s+(pos|comercio|adquirencia)/,
      /honorarios/,
      /factura\s+cobrada/,
      /\bpos\b/,
      /abono\s+comercio/,
    ],
  },
  {
    kind: 'RECURRING_OTHER',
    patterns: [
      /renta\s+dignidad/,
      /bono\s+juana\s+azurduy/,
      /\bpension\b/,
      /jubilaci?on/,
      /alquiler\s+cobrado/,
      /remesa/,
      /western\s+union|money\s?gram|\bria\b/,
      /giro\s+recibido/,
      /transferencia\s+recibida/,
      /\bach\b\s+recibid/,
      /\blip\b\s+recibid/,
      /deposito\s+de\s+tercero/,
    ],
  },
];

const OUTFLOW_RULES: readonly Rule[] = [
  {
    kind: 'HIGH_RISK',
    patterns: [
      /casino/,
      /apuesta/,
      /\bbet\b|betano|betfair|1xbet|rushbet|codere/,
      /loteria/,
      /binance|coinbase|bybit|kucoin|okx|criptomoneda|\bcripto\b/,
      /forex|trading\s+online/,
    ],
  },
  {
    kind: 'DEBT_SERVICE',
    patterns: [
      /amortizaci?on/,
      /cuota\s+(de\s+)?(prestamo|credito|vehiculo|vivienda)/,
      /pago\s+(de\s+)?(prestamo|credito|cuota)/,
      /debito\s+automatico\s+(prestamo|credito|cuota)/,
      /tarjeta\s+de\s+credito/,
      /pago\s+(minimo|total)\s+tarjeta/,
      /\bleasing\b/,
      /interes\s+(de\s+)?(prestamo|mora)/,
      /mora\s+prestamo/,
      /\bbnpl\b|compra\s+en\s+cuotas|pago\s+en\s+cuotas/,
      /refinanciamiento/,
      /capital\s+e\s+intereses/,
    ],
  },
  {
    kind: 'INSURANCE_CONTRIBUTION',
    patterns: [
      /\bseguro\b/,
      /\bpoliza\b/,
      /\bafp\b|gestora\s+publica|aporte\s+jubilatorio/,
      /aporte\s+(patronal|laboral|solidario)/,
      /\bcns\b|caja\s+nacional\s+de\s+salud/,
      /\bdesgravamen\b/,
      /prevision/,
    ],
  },
  {
    kind: 'ESSENTIAL',
    patterns: [
      /\bdelapaz\b|\bcre\b|\belfec\b|\bsetar\b|\bcessa\b|\bsepsa\b/,
      /energia\s+electrica|\bluz\b/,
      /\bepsas\b|\bsaguapac\b|\bcosaalt\b|agua\s+potable/,
      /\bycsa\b|gas\s+domiciliario/,
      /\bentel\b|\btigo\b|\bviva\b|\bcotel\b|\bcomteco\b/,
      /internet|telefonia|television\s+por\s+cable/,
      /*
       * `alquiler` a secas, y no sólo «pago de alquiler». Es un cargo y el
       * cargo de un alquiler es siempre el pago: la variante que entra dinero
       * —«ALQUILER COBRADO»— ya está en la lista de abonos, así que aquí no hay
       * ambigüedad que resolver. Con la forma larga, «PAGO ALQUILER» —que es
       * como lo escribe la mitad de las transferencias— caía en gasto
       * discrecional, y el compromiso más grande de un hogar desaparecía del
       * gasto comprometido.
       */
      /\balquiler\b/,
      /\barriendo\b/,
      /anticretico/,
      /colegio|universidad|\bupb\b|\bucb\b|\bumsa\b|\bumss\b|matricula|pension\s+escolar/,
      /farmacia|clinica|hospital|laboratorio\s+clinico/,
      /supermercado|hipermaxi|fidalga|ic\s?norte|ketal|tia\b/,
      /combustible|gasolina|\bypfb\b|surtidor/,
    ],
  },
  {
    kind: 'TAX_FEE',
    patterns: [
      /\bitf\b/,
      /impuesto/,
      /comisi?on/,
      /mantenimiento\s+de\s+cuenta/,
      /\biva\b|\bit\b\s+retenido|\brc-?iva\b/,
      /\bsin\b\s+pago|impuestos\s+nacionales/,
      /gastos\s+administrativos/,
      /portes|chequera/,
    ],
  },
  {
    kind: 'CASH_WITHDRAWAL',
    patterns: [
      /retiro\s+(de\s+)?efectivo/,
      /\batm\b|cajero\s+automatico/,
      /retiro\s+(ventanilla|caja)/,
      /disposici?on\s+de\s+efectivo/,
    ],
  },
  {
    kind: 'INTERNAL_TRANSFER',
    patterns: [
      /traspaso\s+(entre|a)\s+(mis\s+)?cuentas/,
      /transferencia\s+propia/,
      /entre\s+cuentas\s+propias/,
      /mismo\s+titular/,
    ],
  },
];

/**
 * Glosas que declaran un RECHAZO por falta de fondos.
 *
 * Se cuentan aparte de cualquier categoría porque no son un gasto: son un hecho
 * sobre cómo administra la persona su cuenta, y el mejor predictor individual de
 * impago que trae un extracto. Un rechazo puede aparecer con importe cero, con
 * el importe del cargo rechazado o con la comisión que el banco cobra por él;
 * por eso se detecta por la glosa y nunca por el importe.
 */
const NSF_PATTERNS: readonly RegExp[] = [
  /fondos\s+insuficientes/,
  /saldo\s+insuficiente/,
  /sin\s+fondos/,
  /cheque\s+devuelto/,
  /devoluci?on\s+por\s+fondos/,
  /rechazo\s+por\s+fondos/,
  /debito\s+rechazado/,
  /\bnsf\b/,
  /comisi?on\s+por\s+(cheque\s+)?devoluci?on/,
  /sobregiro\s+no\s+autorizado/,
];

/** Glosas de cobranza: alguien está persiguiendo un pago que no se hizo. */
const COLLECTION_PATTERNS: readonly RegExp[] = [
  /gestion\s+de\s+cobranza/,
  /\bcobranza\s+judicial/,
  /castigo\s+de\s+cartera/,
  /cartera\s+en\s+ejecucion/,
  /embargo/,
  /retenci?on\s+judicial/,
];

/** Sin acentos y en minúsculas: es la única forma de comparar glosas de PDF. */
export function normalizeGloss(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

export function classifyInflow(description: string): InflowKind {
  const gloss = normalizeGloss(description);
  for (const rule of INFLOW_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(gloss))) return rule.kind as InflowKind;
  }
  /*
   * Sin coincidencia se devuelve `ONE_OFF` y NO `BUSINESS`.
   *
   * Es la decisión conservadora y va en la dirección que importa: `ONE_OFF` no
   * cuenta como ingreso reconocido, así que un abono que no se entiende no sube
   * la capacidad de pago de nadie. Al revés —tratar lo desconocido como ingreso
   * de actividad— haría que cualquier depósito suelto se leyera como sueldo.
   * La recurrencia lo rescata después: un abono que se repite tres meses con
   * importe parecido se reconoce por su CADENCIA aunque su glosa no diga nada.
   */
  return 'ONE_OFF';
}

export function classifyOutflow(description: string): OutflowKind {
  const gloss = normalizeGloss(description);
  for (const rule of OUTFLOW_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(gloss))) return rule.kind as OutflowKind;
  }
  return 'DISCRETIONARY';
}

export function isNsf(description: string): boolean {
  const gloss = normalizeGloss(description);
  return NSF_PATTERNS.some((pattern) => pattern.test(gloss));
}

export function isCollectionAction(description: string): boolean {
  const gloss = normalizeGloss(description);
  return COLLECTION_PATTERNS.some((pattern) => pattern.test(gloss));
}

/**
 * Gastos que NO se pueden dejar de pagar el mes que viene.
 *
 * Es la lista que define el denominador honesto del disponible. El retiro de
 * efectivo entra —y es discutible— porque no se sabe en qué se fue: tratarlo
 * como discrecional supondría que la persona puede dejar de sacar dinero, y en
 * una economía donde buena parte del gasto doméstico se paga en efectivo eso
 * sería suponer que puede dejar de comer.
 */
export const COMMITTED_OUTFLOWS: ReadonlySet<OutflowKind> = new Set<OutflowKind>([
  'DEBT_SERVICE',
  'INSURANCE_CONTRIBUTION',
  'ESSENTIAL',
  'TAX_FEE',
  'CASH_WITHDRAWAL',
]);

/** Lo que es compromiso con un TERCERO, que es lo que mide el endeudamiento. */
export const THIRD_PARTY_OBLIGATIONS: ReadonlySet<OutflowKind> = new Set<OutflowKind>([
  'DEBT_SERVICE',
  'INSURANCE_CONTRIBUTION',
]);

/** Abonos que cuentan como ingreso reconocible por su glosa. */
export const RECOGNIZED_INFLOWS: ReadonlySet<InflowKind> = new Set<InflowKind>([
  'PAYROLL',
  'BUSINESS',
  'RECURRING_OTHER',
]);

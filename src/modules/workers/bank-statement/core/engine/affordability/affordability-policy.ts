/**
 * Los números que gobiernan la evaluación, con la razón de cada uno.
 *
 * Están juntos y con nombre porque son lo primero que hay que recalibrar con
 * cartera real, y porque un umbral escondido dentro de una fórmula es un umbral
 * que nadie discute.
 *
 * ## Ninguno está calibrado, y eso ahora se publica
 *
 * La auditoría de parámetros del corpus revisó los ocho uno por uno y devolvió
 * lo mismo en los ocho: `calibrated_on_observed_arrears: false`,
 * `verified_replacement_value: null`, `measured_error_of_current_value: null`.
 * Es decir: son los valores que el encargo declaró, ninguno se ha medido contra
 * mora observada, y tampoco existe un valor verificado que deba sustituirlos.
 *
 * Varias de las justificaciones que este archivo tenía escritas **no se
 * sostienen**, y se corrigen abajo en su sitio. La más importante: ni la FCA
 * británica ni las guías de la EBA fijan un número —el corpus buscó y devolvió
 * `NO_UNIVERSAL_NUMERIC_RATIO_IDENTIFIED_IN_SOURCE`—, y el 15 % y el 35 % que
 * aquí se llamaban «práctica prudencial» no se verificaron como regla vigente en
 * Bolivia para este producto (huecos G08 y G15, contradicción C09).
 *
 * Que sigan en estos valores es correcto: el corpus entrega rejillas de
 * sensibilidad para medirlos y advierte, con esas palabras, que **una rejilla no
 * es una política**. Lo que cambia es que la evaluación ya no los presenta como
 * si alguien los hubiera medido — ver `AFFORDABILITY_PARAMETER_PROVENANCE`.
 */
export interface AffordabilityPolicy {
  /**
   * Meses naturales COMPLETOS que el extracto tiene que cubrir.
   *
   * Tres, y el argumento es estadístico y propio: con uno o dos meses no existe
   * ninguna forma de separar un ingreso de un cobro extraordinario. Un mes con
   * el aguinaldo dentro dice que la persona gana el doble de lo que gana; un mes
   * con una compra grande dice que gasta el doble. Con tres observaciones ya hay
   * mediana —que ignora el mes raro— y ya hay pendiente —que distingue «gana
   * 4.000» de «ganaba 6.000 y va cayendo»—, que son exactamente las dos
   * preguntas que decide este módulo. Y es lo que un banco boliviano entrega sin
   * trámite desde su banca por internet.
   *
   * **No se apoya en ninguna norma, y antes aquí decía que sí.** El corpus fue a
   * buscarlo: ASFI no publica un mínimo universal de tres meses, y la literatura
   * supervisora que se citaba —FCA, EBA— describe ventanas heterogéneas de hasta
   * doce meses sin prescribir ninguna. El riesgo de este parámetro está medido en
   * su dirección aunque no en su magnitud: un filtro duro de tres meses sesga la
   * selección CONTRA quien sólo tiene extractos móviles recientes. Por eso
   * `enforceMinimumMonths` está en `false` y la cobertura viaja como advertencia.
   */
  readonly minimumMonths: number;

  /**
   * Movimientos por mes por debajo de los cuales la cuenta no es la que usa.
   *
   * Un extracto con dos apuntes al mes cumple la exigencia de meses y no dice
   * nada de la vida financiera de la persona: es una cuenta secundaria, o una
   * abierta para el trámite. Sin este corte, el que sube la cuenta donde no pasa
   * nada obtiene el mejor perfil del sistema —cero gasto comprometido, cero
   * rechazos— por no usarla.
   */
  readonly minimumTransactionsPerMonth: number;

  /**
   * Cuota nueva máxima sobre el ingreso reconocido (payment-to-income).
   *
   * No sustituye al disponible —que casi siempre muerde antes—: es la red que
   * impide que un ingreso alto con gasto bajo produzca una cuota que se lleva
   * medio sueldo porque «cabe».
   *
   * **El 15 % no es «el techo habitual del consumo a plazo corto»**, que es lo
   * que este comentario afirmaba. Aparece en una norma boliviana HISTÓRICA de
   * 2013 (ASFI, consumo debidamente garantizado a dependientes), con un
   * denominador concreto —promedio de los últimos tres meses del total ganado
   * menos descuentos de ley— y el corpus no pudo verificar que ese régimen siga
   * vigente ni que aplique a este producto. La coincidencia numérica con una
   * norma derogada no valida el estimador.
   */
  readonly paymentToIncomeCap: number;

  /**
   * Servicio TOTAL de deuda sobre ingreso (debt-service-to-income), contando lo
   * que ya paga más la cuota nueva.
   *
   * Es el único límite que mira lo que la persona YA debe a otros: sin él, quien
   * paga tres cuotas en otras entidades aparecería con margen porque su gasto
   * discrecional es bajo.
   *
   * **El 35 % no está verificado como tope de ASFI**, y aquí se afirmaba que era
   * «el corte de la práctica prudencial». El corpus lo desmonta en su
   * contradicción C09: las cifras que circulan —15 %, 25 %, 35 %— vienen de
   * normas de años distintos y de recomendaciones extranjeras con denominadores
   * que no son el mismo (el 35-40 % de CONDUSEF es material educativo mexicano y
   * su ejemplo mide sobre el RESIDUAL, no sobre el ingreso).
   *
   * Y el error que más daño hace no es el número sino el denominador: la deuda
   * total tiene que ser SERVICIO MENSUAL, nunca saldo de capital, y una deuda
   * externa desconocida no se convierte en cero.
   */
  readonly debtServiceToIncomeCap: number;

  /**
   * Qué parte del disponible tensionado puede comprometerse en una cuota nueva.
   *
   * La mitad. Dejar el 100 % supondría que la persona puede vivir exactamente al
   * borde y que ningún mes se tuerce, que es la suposición que produce la mora
   * del mes cuatro. La otra mitad ES el colchón, y estar declarada como
   * parámetro —en vez de escondida en una fórmula— permite discutirla.
   */
  readonly prudenceShare: number;

  /**
   * Castigo máximo al ingreso por volatilidad.
   *
   * Se aplica el coeficiente de variación como recorte, acotado aquí. El tope
   * existe porque un ingreso muy variable no es un ingreso cero: un comerciante
   * con temporada alta y baja cobra las dos, y recortarle el 80 % sería negarle
   * el crédito por trabajar por su cuenta.
   *
   * No se encontró ningún recorte del 35 % derivado de una población comparable
   * (auditoría `maximum_income_volatility_haircut`), y el tope tiene un coste
   * declarado: limita la prudencia justo cuando el ingreso se derrumba de verdad.
   */
  readonly maximumIncomeHaircut: number;

  /**
   * Piso de gasto de subsistencia mensual, en la moneda del extracto.
   *
   * El disponible NO es «ingreso menos lo que gastó»: quien tiene poco ajusta su
   * gasto a lo que tiene, así que un extracto muy austero produce un disponible
   * enorme que no existe. El piso ancla la resta en lo que cuesta vivir aunque
   * el extracto no lo enseñe —porque se pagó en efectivo, o desde otra cuenta—.
   *
   * **Un salario mínimo no es una canasta de gasto**, y este comentario decía lo
   * contrario. El corpus verificó que el salario mínimo nacional de 2026 son
   * 3.300 BOB (RM 088/26, vigente desde el 2026-01-01) y en la misma línea marcó
   * `minimum_wage_is_subsistence: false` y `credit_subsistence_floor: false`: es
   * una remuneración mínima legal, no lo que cuesta vivir.
   *
   * Por eso 2.750 **no se sustituye automáticamente por 3.300**. Sustituirlo
   * sería repetir el error de origen con una cifra más alta. Lo que falta para
   * fijarlo de verdad está enumerado en el corpus —ciudad o área, miembros y
   * dependientes, gasto esencial compartido, alquiler, salud y educación, fecha
   * base de precios— y la línea de pobreza 2026 del INE no se pudo obtener
   * (hueco G13).
   */
  readonly subsistenceFloor: number;

  /**
   * Días de gasto comprometido que debería cubrir el saldo más bajo del periodo.
   *
   * Es una medida de liquidez, no de solvencia, y las dos fallan por caminos
   * distintos: se puede tener margen mensual y no tener nunca dinero el día 28,
   * que es justo el día en que se cobran las cuotas.
   */
  readonly cashCushionTargetDays: number;

  /**
   * Si el incumplimiento de la cobertura mínima RECHAZA el documento.
   *
   * **Por defecto NO.** Estuvo en `true` y el efecto medido fue el contrario del
   * buscado: `monthsComplete` cuenta meses naturales COMPLETOS —28 días cubiertos
   * dentro del propio mes, ver `monthly-series.ts`— así que el extracto que la
   * banca por internet entrega como «últimos 3 meses» (31/05 → 31/08) aporta dos
   * meses completos, no tres, y se rechazaba. Para pasar un mínimo de tres hacían
   * falta cuatro meses de documento, y quien lo subía recibía «consigue el
   * periodo de los últimos 3 meses» habiendo hecho exactamente eso.
   *
   * La cobertura sigue midiéndose y ahora viaja como ADVERTENCIA: la evaluación
   * dice con cuántos meses se calculó, y quien decide sabe cuánto pesa. Un
   * extracto corto produce una capacidad de pago menos fiable, no un documento
   * inadmisible.
   *
   * Se puede volver a exigir con `BANK_STATEMENT_ENFORCE_MINIMUM_MONTHS=true`,
   * que es la forma correcta de endurecerlo: una decisión de quien opera, visible
   * en la configuración del despliegue.
   */
  readonly enforceMinimumMonths: boolean;
}

export const DEFAULT_AFFORDABILITY_POLICY: AffordabilityPolicy = {
  minimumMonths: 3,
  minimumTransactionsPerMonth: 3,
  paymentToIncomeCap: 0.15,
  debtServiceToIncomeCap: 0.35,
  prudenceShare: 0.5,
  maximumIncomeHaircut: 0.35,
  subsistenceFloor: 2750,
  cashCushionTargetDays: 15,
  enforceMinimumMonths: false,
};

/**
 * Sanea una política parcial contra la de por defecto.
 *
 * `minimumMonths` no baja de 3 por configuración, y es la única constante de
 * este archivo que se defiende de quien la configura. Todo lo demás son
 * calibraciones; ésta es la exigencia que da sentido al módulo, y poder bajarla
 * desde una variable de entorno la convertiría en una que alguien apaga el día
 * que la conversión rechaza demasiado.
 */
export function normalizeAffordabilityPolicy(
  overrides: Partial<AffordabilityPolicy> = {},
): AffordabilityPolicy {
  const merged = { ...DEFAULT_AFFORDABILITY_POLICY, ...overrides };
  return {
    ...merged,
    minimumMonths: Math.max(DEFAULT_AFFORDABILITY_POLICY.minimumMonths, merged.minimumMonths),
    minimumTransactionsPerMonth: Math.max(0, merged.minimumTransactionsPerMonth),
    paymentToIncomeCap: bounded(merged.paymentToIncomeCap, 0.01, 1),
    debtServiceToIncomeCap: bounded(merged.debtServiceToIncomeCap, 0.05, 1),
    prudenceShare: bounded(merged.prudenceShare, 0.1, 1),
    maximumIncomeHaircut: bounded(merged.maximumIncomeHaircut, 0, 0.9),
    subsistenceFloor: Math.max(0, merged.subsistenceFloor),
    cashCushionTargetDays: Math.max(0, merged.cashCushionTargetDays),
  };
}

function bounded(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * Cada parámetro de la política, atado a su auditoría en el corpus.
 *
 * ## Para qué sirve una tabla de procedencia
 *
 * Para que la evaluación pueda decir la verdad sobre sí misma. Un informe que
 * publica «capacidad de pago: 1.240 Bs» sin decir que el 35 % con el que se
 * calculó no está calibrado contra ninguna cartera invita a tratar la cifra como
 * una medición. Con esto, `AffordabilityAssessment.calibration` puede llevar el
 * estado real, y quien lea el número sabe qué clase de número es.
 *
 * Es también la defensa contra la deriva silenciosa: si alguien mueve un valor
 * por defecto, la prueba `corpus-extractos-regresion.spec.ts` compara contra el
 * `valorActual` que audita el corpus y avisa de que ya no son el mismo número.
 */
export interface PolicyParameterProvenance {
  /** Campo de `AffordabilityPolicy`. */
  readonly field: keyof AffordabilityPolicy;
  /** Identificador de la auditoría en el corpus (`installment_to_income_cap`…). */
  readonly auditId: string;
  /** El valor que el corpus audita, para poder detectar que el código se desvió. */
  readonly auditedValue: number;
  readonly calibratedAgainstArrears: false;
  readonly verifiedReplacement: null;
}

export const AFFORDABILITY_PARAMETER_PROVENANCE: readonly PolicyParameterProvenance[] = [
  {
    field: 'minimumMonths',
    auditId: 'complete_calendar_months',
    auditedValue: 3,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'minimumTransactionsPerMonth',
    auditId: 'minimum_monthly_transactions',
    auditedValue: 3,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'paymentToIncomeCap',
    auditId: 'installment_to_income_cap',
    auditedValue: 0.15,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'debtServiceToIncomeCap',
    auditId: 'total_debt_service_to_income_cap',
    auditedValue: 0.35,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'prudenceShare',
    auditId: 'disposable_income_commitment',
    auditedValue: 0.5,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'maximumIncomeHaircut',
    auditId: 'maximum_income_volatility_haircut',
    auditedValue: 0.35,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'subsistenceFloor',
    auditId: 'subsistence_floor',
    auditedValue: 2750,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'cashCushionTargetDays',
    auditId: 'minimum_balance_expense_days',
    auditedValue: 15,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
];

/**
 * Lo que la evaluación publica sobre la naturaleza de sus propios umbrales.
 *
 * `MEASUREMENT_NOT_APPROVAL` es literal del corpus, y describe el papel del
 * motor entero: mide, no aprueba.
 */
export const AFFORDABILITY_CALIBRATION_STATUS = {
  status: 'NOT_CALIBRATED_AGAINST_OBSERVED_ARREARS',
  engineRole: 'MEASUREMENT_NOT_APPROVAL',
  parametersAudited: AFFORDABILITY_PARAMETER_PROVENANCE.length,
  parametersCalibrated: 0,
  /** Lo que haría falta para cambiar esto, en una frase. */
  requires:
    'Cartera con mora observada en cohortes maduras, split por cliente y tiempo, ' +
    'e intervalos por subgrupo. Una rejilla de sensibilidad no es una calibración.',
} as const;

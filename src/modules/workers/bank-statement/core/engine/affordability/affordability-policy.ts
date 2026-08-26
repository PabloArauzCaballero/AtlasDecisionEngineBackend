/**
 * Los números que gobiernan la evaluación, con la razón de cada uno.
 *
 * Están juntos y con nombre porque son lo primero que hay que recalibrar con
 * cartera real, y porque un umbral escondido dentro de una fórmula es un umbral
 * que nadie discute. Ninguno es arbitrario: cada uno lleva de dónde sale y qué
 * pasa si se mueve.
 */
export interface AffordabilityPolicy {
  /**
   * Meses naturales COMPLETOS que el extracto tiene que cubrir.
   *
   * Tres, y no menos, y no es una preferencia: con uno o dos meses no existe
   * ninguna forma estadística de separar un ingreso de un cobro extraordinario.
   * Un mes con el aguinaldo dentro dice que la persona gana el doble de lo que
   * gana; un mes con una compra grande dice que gasta el doble. Con tres
   * observaciones ya hay mediana —que ignora el mes raro— y ya hay pendiente
   * —que distingue «gana 4.000» de «ganaba 6.000 y va cayendo»—, que son
   * exactamente las dos preguntas que decide este módulo.
   *
   * Tres es además el mínimo que exige la práctica supervisora comparada para
   * verificar ingreso con datos bancarios (la evaluación de asequibilidad de la
   * FCA británica y las guías de la EBA sobre concesión y seguimiento parten de
   * ahí), y es lo que un banco boliviano entrega sin trámite desde su banca por
   * internet. Pedir más rechazaría a quien puede pagar por un problema de
   * papeleo; pedir menos es decidir sobre ruido.
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
   * 15 % es el techo habitual del crédito de consumo a plazo corto. No sustituye
   * al disponible —que casi siempre muerde antes—: es la red que impide que un
   * ingreso alto con gasto bajo produzca una cuota que se lleva medio sueldo
   * porque «cabe».
   */
  readonly paymentToIncomeCap: number;

  /**
   * Servicio TOTAL de deuda sobre ingreso (debt-service-to-income), contando lo
   * que ya paga más la cuota nueva.
   *
   * 35 % es el corte que la práctica prudencial usa para el endeudamiento de
   * hogares. Es el único límite que mira lo que la persona YA debe a otros: sin
   * él, quien paga tres cuotas en otras entidades aparecería con margen porque su
   * gasto discrecional es bajo.
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
   * Se ancla en el salario mínimo nacional boliviano, que es el suelo declarado
   * de un ingreso de subsistencia y el único número del país que se actualiza por
   * decreto todos los años. Es conservador a propósito: subestimar el gasto
   * aprueba a quien no puede pagar.
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
   * Igual que en las compuertas de emisor y autenticidad: encender una exigencia
   * nueva sobre un motor en marcha rechaza documentos que ayer pasaban, y esa
   * decisión es de quien opera. Con `false` la cobertura se mide, se publica y no
   * bloquea.
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
  enforceMinimumMonths: true,
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

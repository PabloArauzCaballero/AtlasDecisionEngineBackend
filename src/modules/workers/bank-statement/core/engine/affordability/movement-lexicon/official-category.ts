import { COLLECTION_PATTERNS, NSF_PATTERNS, normalizeGloss } from './classify';
import { InflowKind, OutflowKind } from './types';

/**
 * La categoría analítica del glosario OFICIAL traducida a lo que este módulo
 * sabe hacer con un movimiento.
 *
 * ## Por qué hace falta una traducción y no se usa la categoría tal cual
 *
 * Porque son dos vocabularios con dos propósitos. El del corpus describe QUÉ
 * operación es (`JUDICIAL_RETENTION`, `PLEDGED_FUNDS`, `SOLI_CHANNEL`); el de
 * aquí describe QUÉ HACER con el importe (¿cuenta como ingreso?, ¿es un
 * compromiso que no se puede dejar de pagar?). Las categorías de canal —`QR`,
 * `POS`, `ATM`, `I`, `M`— son el ejemplo claro: dicen por dónde entró la
 * operación y nada sobre su naturaleza económica, así que devuelven `null` y
 * dejan que el léxico heurístico mire la glosa entera.
 *
 * `null` significa «el glosario no decide esto», no «no es nada».
 *
 * ## Las dos decisiones discutibles, escritas
 *
 * - **`JUDICIAL_RETENTION` cuenta como servicio de deuda.** Una retención
 *   judicial no se puede dejar de pagar y va a un tercero, que son los dos
 *   rasgos que definen la categoría. Cuentan también en el endeudamiento, lo
 *   que BAJA la capacidad de pago: es el lado conservador del error, y con una
 *   retención judicial encima es el lado correcto.
 * - **`SALARY` no entra como nómina por sí sola.** El corpus marca las tres
 *   glosas de sueldo con `SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION`, y
 *   la condición está en el nombre: hace falta que la fila sea un ABONO. Una
 *   glosa de sueldo en la columna de cargos es la reversión de una planilla, no
 *   un ingreso, y por eso la traducción mira la dirección contable de la fila.
 */
export function officialCategoryToKind(
  category: string,
  direction: 'INFLOW' | 'OUTFLOW',
): InflowKind | OutflowKind | null {
  if (direction === 'INFLOW') {
    switch (category) {
      case 'SALARY':
      case 'SALARY_PAYMENT':
        return 'PAYROLL';
      case 'LOAN_DISBURSEMENT':
      case 'SALARY_ADVANCE_LOAN':
      case 'CREDIT_REDRAW':
        return 'CREDIT_DISBURSEMENT';
      case 'OWN_TRANSFER':
        return 'INTERNAL_TRANSFER';
      case 'FEE_REFUND':
      case 'TAX_REFUND':
      case 'CARD_REFUND':
      case 'REVERSAL':
      case 'SALARY_REVERSAL':
      case 'ADJUSTMENT':
      case 'RECOVERY_ADJUSTMENT':
      case 'INTERNATIONAL_TRANSFER_RETURN':
        return 'REVERSAL';
      case 'INTEREST':
      case 'PLEDGED_INTEREST':
      case 'PLEDGED_FUNDS':
      case 'MATURITY':
      case 'JUDICIAL_RELEASE':
      case 'GUARANTEE_RELEASE':
        return 'ONE_OFF';
      default:
        return null;
    }
  }

  switch (category) {
    case 'LOAN_PAYMENT':
    case 'RESTRUCTURED_LOAN_PAYMENT':
    case 'INSTALLMENT_PAYMENT':
    case 'DEBT_PURCHASE':
    case 'JUDICIAL_RETENTION':
      return 'DEBT_SERVICE';
    case 'INSURANCE':
      return 'INSURANCE_CONTRIBUTION';
    case 'UTILITIES':
      return 'ESSENTIAL';
    case 'FEE':
    case 'TAX':
    case 'TAX_ITF':
    case 'TAX_RCIVA':
      return 'TAX_FEE';
    case 'CASH_WITHDRAWAL':
      return 'CASH_WITHDRAWAL';
    case 'OWN_TRANSFER':
      return 'INTERNAL_TRANSFER';
    default:
      return null;
  }
}

export function isNsf(description: string): boolean {
  const gloss = normalizeGloss(description);
  return NSF_PATTERNS.some((pattern) => pattern.test(gloss));
}

export function isCollectionAction(description: string): boolean {
  const gloss = normalizeGloss(description);
  return COLLECTION_PATTERNS.some((pattern) => pattern.test(gloss));
}

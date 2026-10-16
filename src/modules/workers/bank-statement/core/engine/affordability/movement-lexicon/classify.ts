import { INFLOW_RULES } from './inflow-rules';
import { OUTFLOW_RULES } from './outflow-rules';
import { InflowKind, OutflowKind } from './types';

/**
 * Glosas que declaran un RECHAZO por falta de fondos.
 *
 * Se cuentan aparte de cualquier categoría porque no son un gasto: son un hecho
 * sobre cómo administra la persona su cuenta, y el mejor predictor individual de
 * impago que trae un extracto. Un rechazo puede aparecer con importe cero, con
 * el importe del cargo rechazado o con la comisión que el banco cobra por él;
 * por eso se detecta por la glosa y nunca por el importe.
 */
export const NSF_PATTERNS: readonly RegExp[] = [
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
export const COLLECTION_PATTERNS: readonly RegExp[] = [
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

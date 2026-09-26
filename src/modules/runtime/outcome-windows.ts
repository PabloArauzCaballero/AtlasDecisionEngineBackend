/**
 * Cuándo toca volver a mirar una decisión para saber si acertó.
 *
 * Las ventanas se materializan AL DECIDIR y no cuando llega el desenlace. Parece un detalle de
 * implementación y es la diferencia entre poder medir y no poder: sin ellas existía el
 * numerador —las observaciones que alguien cargó— y no existía el denominador, así que «este
 * mes no falló ningún crédito» y «este mes nadie cargó los desenlaces» se leían igual, cero
 * filas. Con la ventana programada por adelantado, la que vence sin observar aparece en una
 * cola de trabajo en vez de desaparecer.
 *
 * Cinco ventanas y no una: el comportamiento de un microcrédito a 30 días no dice lo mismo que
 * a 360, y la tasa de malos sin plazo declarado no significa nada.
 */

/** Dominio de riesgo cuyas decisiones originan un crédito y por tanto tienen desenlace. */
export const ORIGINATION_RISK_DOMAIN = 'CREDIT_ORIGINATION';

/** Plazos por omisión, en días. Configurables por `OUTCOME_WINDOW_DAYS`. */
export const DEFAULT_OUTCOME_WINDOWS = [30, 60, 90, 180, 360] as const;

/**
 * Ventanas que corresponden a una decisión de este dominio.
 *
 * Una decisión de cobranza o de enrutado no genera crédito y no se le programa ventana: darle
 * una la dejaría vencida para siempre en la cola, y una cola llena de trabajo que nadie puede
 * hacer se acaba ignorando entera — con los créditos de verdad dentro.
 */
export function outcomeWindowsFor(riskDomain: string, configured?: string | null): number[] {
  if (riskDomain !== ORIGINATION_RISK_DOMAIN) return [];
  return parseWindowDays(configured);
}

/**
 * Lee la configuración y descarta lo que no sea un plazo utilizable.
 *
 * Un valor mal escrito NO tumba el motor ni deja el sistema sin ventanas: se ignora esa
 * entrada y se conservan las válidas, y si no queda ninguna se usan las de serie. La
 * alternativa —fallar al arrancar— convierte una errata de configuración en una caída del
 * camino de decisión, que es un precio desproporcionado para un dato que tiene un valor por
 * omisión razonable.
 */
export function parseWindowDays(configured?: string | null): number[] {
  if (!configured?.trim()) return [...DEFAULT_OUTCOME_WINDOWS];
  const parsed = configured
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((days) => Number.isInteger(days) && days > 0 && days <= 3_650);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length ? unique : [...DEFAULT_OUTCOME_WINDOWS];
}

/** Fecha en que vence la observación de esa ventana. */
export function windowDueAt(decidedAt: Date, windowDays: number): Date {
  return new Date(decidedAt.getTime() + windowDays * 24 * 60 * 60 * 1_000);
}

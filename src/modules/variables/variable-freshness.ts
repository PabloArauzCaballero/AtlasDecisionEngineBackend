import { FreshnessPolicy } from '@prisma/client';
import { type FreshnessReason, type FreshnessVerdict } from './freshness';

/**
 * El compromiso de frescura MAS EXIGENTE entre las fuentes declaradas de una variable.
 *
 * Cero significa «sin SLA declarado» y es el valor con el que estan sembradas casi todas las
 * fuentes, asi que se ignora al buscar el minimo: quedarse con el cero haria que una variable con
 * dos fuentes -una estricta y otra sin declarar- perdiera su compromiso por tener companiia.
 */
export function strictestSla(sources: Array<{ freshnessSlaSeconds: number }>): number {
  const declared = sources.map((source) => source.freshnessSlaSeconds).filter((sla) => sla > 0);
  return declared.length ? Math.min(...declared) : 0;
}

/**
 * La politica de frescura que aplica a una variable.
 *
 * Se deriva de `fallbackPolicy` mientras el compilado no la transporte por separado: una variable
 * cuyo fallo es FATAL (`FAIL`) tampoco puede decidirse con un dato caducado, y una que admite
 * respaldo tampoco deberia caerse por antiguedad. Es una aproximacion declarada, no una
 * casualidad: la columna `freshness_policy` ya existe en el esquema y este mapeo se sustituye por
 * ella en cuanto el compilador la incluya.
 */
export function freshnessPolicyOf(fallbackPolicy: string): FreshnessPolicy {
  // `FAIL_CLOSED` es el valor que escriben las dependencias de verdad; comparar sólo con `FAIL`
  // dejaba el `REJECT` inalcanzable y toda variable crítica se degradaba en silencio.
  return fallbackPolicy === 'FAIL' || fallbackPolicy === 'FAIL_CLOSED'
    ? FreshnessPolicy.REJECT
    : FreshnessPolicy.DEGRADE;
}

/** Código estable de error por motivo, para que el llamante distinga viejo de sello dudoso. */
export const FRESHNESS_ERROR_CODES: Record<FreshnessReason, string> = {
  STALE: 'VARIABLE_STALE',
  TIMESTAMP_FUTURE: 'VARIABLE_TIMESTAMP_FUTURE',
  TIMESTAMP_INVALID: 'VARIABLE_TIMESTAMP_INVALID',
  FRESHNESS_UNKNOWN: 'VARIABLE_FRESHNESS_UNKNOWN',
  SLA_NOT_DECLARED: 'VARIABLE_FRESHNESS_SLA_MISSING',
};

export function freshnessMessage(
  code: string,
  verdict: FreshnessVerdict,
  slaSeconds: number,
): string {
  switch (verdict.reason) {
    case 'TIMESTAMP_FUTURE':
      return `El sello de ${code} es posterior al instante de la decisión: un reloj adelantado no produce un dato fresco.`;
    case 'TIMESTAMP_INVALID':
      return `El sello de ${code} no es una fecha legible.`;
    case 'FRESHNESS_UNKNOWN':
      return `${code} es crítica y llegó sin sello: su frescura no se puede comprobar.`;
    case 'SLA_NOT_DECLARED':
      return `${code} es crítica y ninguna de sus fuentes declara un SLA de frescura positivo.`;
    default:
      return (
        `El valor de ${code} tenia ${verdict.ageSeconds} s cuando su compromiso de ` +
        `frescura es de ${slaSeconds} s. Un dato viejo aqui no es menos ` +
        `preciso: es la respuesta a otra pregunta.`
      );
  }
}

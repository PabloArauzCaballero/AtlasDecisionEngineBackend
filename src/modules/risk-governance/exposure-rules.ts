/**
 * Los límites de cartera y la vigencia del consentimiento, como reglas puras.
 *
 * Las dos comprobaciones responden a la misma carencia: la decisión miraba al solicitante y no
 * miraba nada más. Ni el estado del negocio —una solicitud buena rechazada un 28 de mes no es un
 * defecto, es el presupuesto agotado, y hoy nadie podía explicarlo— ni la licitud vigente de usar
 * sus datos.
 *
 * Viven aquí, fuera de una regla del grafo, por lo que pasa la primera vez que alguien clona un
 * artefacto: la regla se copia, se edita, y el límite desaparece sin que nadie lo haya decidido.
 * Como restricción del motor, un artefacto nuevo lo hereda por existir.
 */

export interface LimitCheckInput {
  limitCode: string;
  /** Cadena vacía = toda la cartera. Centinela explícito, nunca `null`. */
  segment: string;
  maxValue: number;
  /** Si es falso se mide y se avisa, pero no se rechaza. */
  enforced: boolean;
  /** Lo consumido hoy: exposición del sujeto, del segmento, del periodo. */
  currentValue: number;
  /** Lo que esta decisión añadiría. */
  requestedValue: number;
}

export interface LimitVerdict {
  limitCode: string;
  /** Cadena vacía = toda la cartera. Centinela explícito, nunca `null`. */
  segment: string;
  maxValue: number;
  projectedValue: number;
  /** El límite se superaría con esta decisión. */
  exceeded: boolean;
  /** Además hay que rechazar: estaba en modo `enforced`. */
  blocking: boolean;
  /** Proporción consumida tras la decisión. Sirve para avisar ANTES de topar. */
  utilization: number;
}

/**
 * Proyecta el consumo con la decisión incluida y decide si topa.
 *
 * Se compara el valor PROYECTADO y no el actual. Comparar el actual deja pasar siempre la
 * operación que rompe el límite —el saldo estaba por debajo justo antes de concederla— y es el
 * error que convierte un límite de concentración en decorativo.
 */
export function checkLimit(input: LimitCheckInput): LimitVerdict {
  const projectedValue = round(input.currentValue + input.requestedValue);
  const exceeded = input.maxValue > 0 && projectedValue > input.maxValue;
  return {
    limitCode: input.limitCode,
    segment: input.segment,
    maxValue: input.maxValue,
    projectedValue,
    exceeded,
    blocking: exceeded && input.enforced,
    utilization: input.maxValue > 0 ? round(projectedValue / input.maxValue) : 0,
  };
}

export interface ConsentInput {
  purpose: string;
  grantedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface ConsentVerdict {
  purpose: string;
  valid: boolean;
  reason: 'VALID' | 'MISSING' | 'REVOKED' | 'EXPIRED' | 'NOT_YET_GRANTED';
  /** Días que le quedan. Negativo si ya venció; nulo si no caduca. */
  daysRemaining: number | null;
}

/**
 * ¿Se puede tratar este dato de esta persona, hoy?
 *
 * Los cuatro motivos de invalidez se distinguen a propósito en vez de devolver un booleano. Quien
 * atiende el caso necesita saber si falta el permiso (hay que pedirlo), si lo revocaron (no se
 * puede volver a pedir igual) o si caducó (se renueva), y un `false` los vuelve el mismo problema.
 *
 * Sin permiso registrado el veredicto es `MISSING` y no «adelante»: la ausencia de constancia no
 * es una autorización, aunque en la práctica sea lo que había antes de esta tabla.
 */
export function checkConsent(
  consent: ConsentInput | null | undefined,
  purpose: string,
  now: Date = new Date(),
): ConsentVerdict {
  if (!consent) return { purpose, valid: false, reason: 'MISSING', daysRemaining: null };
  if (consent.revokedAt && consent.revokedAt <= now) {
    return { purpose, valid: false, reason: 'REVOKED', daysRemaining: null };
  }
  if (consent.grantedAt > now) {
    return { purpose, valid: false, reason: 'NOT_YET_GRANTED', daysRemaining: null };
  }
  if (!consent.expiresAt) return { purpose, valid: true, reason: 'VALID', daysRemaining: null };

  const daysRemaining = Math.floor((consent.expiresAt.getTime() - now.getTime()) / 86_400_000);
  if (consent.expiresAt <= now) {
    return { purpose, valid: false, reason: 'EXPIRED', daysRemaining };
  }
  return { purpose, valid: true, reason: 'VALID', daysRemaining };
}

/**
 * ¿Puede esta persona aprobar esta reidentificación?
 *
 * Quien aprueba no puede ser quien pide. Es la única propiedad que convierte «dos autorizaciones»
 * en un control real; sin ella, la segunda firma es la misma persona pulsando otro botón.
 */
export function canApproveReidentification(requestedBy: string, approver: string): boolean {
  return normalize(requestedBy) !== normalize(approver);
}

function normalize(actor: string): string {
  return actor.trim().toLowerCase();
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

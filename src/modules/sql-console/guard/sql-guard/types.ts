export interface GuardViolation {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly GuardViolation[];
  /** Relaciones del catálogo que la consulta nombra. Vacío no significa que no lea nada. */
  readonly relations: readonly string[];
}

/** Tope de la sentencia. Muy por encima de cualquier consulta escrita a mano. */
export const MAX_SQL_BYTES = 64 * 1024;

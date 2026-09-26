export interface BudgetWindow {
  provider: string;
  monthKey: string;
}

export interface BudgetSnapshot {
  reservedUnits: number;
  settledUnits: number;
}

/**
 * Contabilidad de consumo. Todas las operaciones son atómicas a nivel de base:
 * la autorización reserva antes de gastar, de modo que no existe ventana TOCTOU.
 */
export interface AudioQuotaRepositoryPort {
  /** Reserva unidades si caben en el presupuesto utilizable. false = presupuesto agotado. */
  reserveBudget(window: BudgetWindow, units: number, usableUnits: number): Promise<boolean>;
  /** Convierte una reserva en consumo real al terminar la generación. */
  settleBudget(window: BudgetWindow, reservedUnits: number, actualUnits: number): Promise<void>;
  /** Devuelve unidades reservadas que nunca llegaron a gastarse. */
  releaseBudget(window: BudgetWindow, units: number): Promise<void>;
  readBudget(window: BudgetWindow): Promise<BudgetSnapshot>;

  /** Incrementa el contador diario solo si queda cuota. false = límite alcanzado. */
  claimActorGeneration(actorId: string, dayKey: string, limit: number): Promise<boolean>;
  /** Compensa un claim cuando la generación falló de forma permanente. */
  releaseActorGeneration(actorId: string, dayKey: string): Promise<void>;
  actorGenerationCount(actorId: string, dayKey: string): Promise<number>;

  /** Registro de consumo por asset. Idempotente por asset_id. */
  recordUsage(assetId: string, provider: string, units: number, monthKey: string): Promise<void>;
  purgeActorDailyBefore(dayKey: string): Promise<number>;
}

import type { AudioTtsConfig } from '../config/audio-tts.env';
import type {
  AudioQuotaRepositoryPort,
  BudgetWindow,
} from '../domain/ports/audio-quota.repository';

export type GenerationPurpose = 'runtime' | 'prewarm';

export interface Reservation {
  allowed: boolean;
  reason?: string;
  units: number;
  window: BudgetWindow;
  actorClaimed: boolean;
}

export function monthKeyOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function dayKeyOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Autoriza la generación. La comprobación de presupuesto **reserva** de forma
 * atómica antes de gastar, de modo que N peticiones concurrentes no pueden
 * superar el límite mensual.
 */
export class AudioBudgetPolicy {
  constructor(
    private readonly quota: AudioQuotaRepositoryPort,
    private readonly config: AudioTtsConfig,
  ) {}

  get usableUnits(): number {
    return Math.max(
      0,
      this.config.AUDIO_TTS_MONTHLY_BUDGET_UNITS - this.config.AUDIO_TTS_SAFETY_RESERVE_UNITS,
    );
  }

  /** Comprobaciones baratas que no tocan la base de datos. */
  checkGates(purpose: GenerationPurpose): { allowed: boolean; reason?: string } {
    if (!this.config.AUDIO_TTS_ENABLED) return { allowed: false, reason: 'TTS_DISABLED' };
    if (this.config.AUDIO_TTS_PROVIDER === 'disabled')
      return { allowed: false, reason: 'PROVIDER_DISABLED' };
    if (purpose === 'runtime' && !this.config.AUDIO_TTS_ALLOW_RUNTIME_GENERATION) {
      return { allowed: false, reason: 'RUNTIME_GENERATION_DISABLED' };
    }
    if (this.config.NODE_ENV === 'production' && !this.config.AUDIO_TTS_PROD_LICENSE_CONFIRMED) {
      return { allowed: false, reason: 'PRODUCTION_LICENSE_NOT_CONFIRMED' };
    }
    return { allowed: true };
  }

  async reserve(
    units: number,
    purpose: GenerationPurpose,
    actorId: string | undefined,
    now: Date = new Date(),
  ): Promise<Reservation> {
    const window = { provider: this.config.AUDIO_TTS_PROVIDER, monthKey: monthKeyOf(now) };
    const denied = (reason: string, actorClaimed = false): Reservation => ({
      allowed: false,
      reason,
      units,
      window,
      actorClaimed,
    });

    const gates = this.checkGates(purpose);
    if (!gates.allowed) return denied(gates.reason ?? 'GENERATION_DENIED');

    const needsActorClaim =
      purpose === 'runtime' &&
      actorId !== undefined &&
      !this.config.AUDIO_TTS_ACTOR_LIMIT_UNLIMITED;
    if (needsActorClaim && actorId !== undefined) {
      const limit = this.config.AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY;
      // 0 significa bloqueado, no ilimitado: un default inseguro nunca debe abrir la puerta.
      if (limit === 0) return denied('ACTOR_DAILY_LIMIT');
      const claimed = await this.quota.claimActorGeneration(actorId, dayKeyOf(now), limit);
      if (!claimed) return denied('ACTOR_DAILY_LIMIT');
    }

    const reserved = await this.quota.reserveBudget(window, units, this.usableUnits);
    if (!reserved) {
      if (needsActorClaim && actorId !== undefined) {
        await this.quota.releaseActorGeneration(actorId, dayKeyOf(now));
      }
      return denied('MONTHLY_BUDGET_RESERVED');
    }
    return { allowed: true, units, window, actorClaimed: needsActorClaim };
  }

  /** Devuelve una reserva que nunca llegó a consumirse. */
  async release(reservation: Reservation, actorId?: string, now: Date = new Date()): Promise<void> {
    if (!reservation.allowed) return;
    await this.quota.releaseBudget(reservation.window, reservation.units);
    if (reservation.actorClaimed && actorId !== undefined) {
      await this.quota.releaseActorGeneration(actorId, dayKeyOf(now));
    }
  }

  /** Comprobación barata que el worker ejecuta antes de gastar cuota real. */
  async stillWithinBudget(units: number, now: Date = new Date()): Promise<boolean> {
    const window = { provider: this.config.AUDIO_TTS_PROVIDER, monthKey: monthKeyOf(now) };
    const snapshot = await this.quota.readBudget(window);
    return snapshot.settledUnits + units <= this.usableUnits;
  }
}

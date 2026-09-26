import { Inject, Injectable } from '@nestjs/common';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { AudioTtsConfig } from '../config/audio-tts.env';
import {
  AUDIO_ASSET_REPOSITORY,
  AUDIO_LOGGER,
  AUDIO_METRICS,
  AUDIO_QUOTA_REPOSITORY,
  AUDIO_SEGMENT_REPOSITORY,
  AUDIO_STORAGE,
  AUDIO_TTS_CONFIG,
  AUDIO_TTS_PROVIDER,
} from '../domain/audio.tokens';
import type { AudioAssetRecord } from '../domain/audio.types';
import type { AudioSegmentRepositoryPort } from '../domain/ports/audio-segment.repository';
import { errorCodeOf, isRetryable, TtsProviderError } from '../domain/errors';
import type {
  AudioAssetRepositoryPort,
  ClaimOutcome,
} from '../domain/ports/audio-asset.repository';
import type { AudioLoggerPort } from '../domain/ports/audio-logger.port';
import { AUDIO_METRIC, type AudioMetricsPort } from '../domain/ports/audio-metrics.port';
import type { AudioQuotaRepositoryPort } from '../domain/ports/audio-quota.repository';
import type { AudioStoragePort } from '../domain/ports/audio-storage.port';
import type { TtsProviderPort } from '../domain/ports/tts-provider.port';
import { AudioBudgetPolicy, monthKeyOf } from './audio-budget.policy';
import { buildCipher } from './audio-cipher.factory';
import { AudioSegmentAssembler, type SegmentAssembly } from './audio-segment-assembler';
import type { AudioValueCipher } from './audio-value-cipher';

const WORKER_ID = `${hostname()}:${process.pid}`;

@Injectable()
export class AudioGenerationProcessor {
  private readonly cipher: AudioValueCipher;
  private readonly policy: AudioBudgetPolicy;
  private readonly assembler: AudioSegmentAssembler;

  constructor(
    @Inject(AUDIO_TTS_CONFIG) private readonly config: AudioTtsConfig,
    @Inject(AUDIO_ASSET_REPOSITORY) private readonly repo: AudioAssetRepositoryPort,
    @Inject(AUDIO_SEGMENT_REPOSITORY) segments: AudioSegmentRepositoryPort,
    @Inject(AUDIO_QUOTA_REPOSITORY) private readonly quota: AudioQuotaRepositoryPort,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStoragePort,
    @Inject(AUDIO_TTS_PROVIDER) private readonly tts: TtsProviderPort,
    @Inject(AUDIO_LOGGER) private readonly logger: AudioLoggerPort,
    @Inject(AUDIO_METRICS) private readonly metrics: AudioMetricsPort,
  ) {
    this.cipher = buildCipher(config);
    this.policy = new AudioBudgetPolicy(quota, config);
    this.assembler = new AudioSegmentAssembler(config, segments, tts, this.cipher);
  }

  async process(assetId: string, correlationId?: string): Promise<void> {
    const claim = await this.repo.claimForGeneration({
      assetId,
      claimedBy: WORKER_ID,
      leaseSeconds: this.config.AUDIO_GENERATION_LEASE_SECONDS,
      maxAttempts: this.config.AUDIO_QUEUE_RETRY_LIMIT + 1,
    });
    const log = this.logger.child({
      correlationId: correlationId ?? claimCorrelation(claim),
      assetId,
    });
    this.metrics.increment(AUDIO_METRIC.claimOutcome, { outcome: claim.outcome });

    if (claim.outcome !== 'CLAIMED') {
      this.reportSkippedClaim(claim, log);
      if (claim.outcome === 'EXHAUSTED') await this.compensate(claim.asset);
      return;
    }
    await this.generate(claim.asset, log);
  }

  private async generate(asset: AudioAssetRecord, log: AudioLoggerPort): Promise<void> {
    const startedAt = Date.now();
    try {
      // Revalidación: un job puede haber esperado horas en la cola tras agotarse el presupuesto.
      if (!(await this.policy.stillWithinBudget(asset.reservedUnits))) {
        throw new TtsProviderError(
          'Presupuesto mensual agotado antes de generar',
          'AUDIO_BUDGET_EXHAUSTED_AT_GENERATION',
          false,
        );
      }
      const assembled = await this.tryAssemble(asset, log);
      const result = assembled ?? (await this.synthesizeWhole(asset));
      const stored = await this.storage.store({
        assetId: asset.id,
        buffer: result.audio,
        mimeType: result.mimeType,
        outputFormat: asset.outputFormat,
      });
      const firstTime = await this.repo.markReady({
        assetId: asset.id,
        storageUri: stored.storageUri,
        mimeType: result.mimeType,
        checksumSha256: stored.checksumSha256,
        bytes: stored.sizeBytes,
        usageUnits: result.usageUnits,
        provider: this.tts.providerName,
        ...(assembled ? { segmentsSummary: assembled.summary } : {}),
      });
      if (firstTime) {
        await this.quota.settleBudget(
          { provider: this.tts.providerName, monthKey: monthKeyOf(new Date()) },
          asset.reservedUnits,
          result.usageUnits,
        );
      }
      const durationMs = Date.now() - startedAt;
      this.metrics.observe(AUDIO_METRIC.generationDuration, durationMs / 1000, {
        provider: this.tts.providerName,
      });
      this.metrics.increment(AUDIO_METRIC.generationTotal, { result: 'ready' });
      log.info({
        event: 'audio.generation.ready',
        provider: this.tts.providerName,
        bytes: stored.sizeBytes,
        usageUnits: result.usageUnits,
        usageIsReported: result.usageIsReported,
        ...(assembled ? { segments: assembled.summary } : {}),
        durationMs,
      });
    } catch (error) {
      await this.fail(asset, error, log, Date.now() - startedAt);
    }
  }

  /**
   * Intenta el corte por segmentos; `null` significa «genera de una pieza».
   *
   * Cualquier fallo del corte DEGRADA al camino entero en vez de tumbar la
   * generación: el corte existe para ahorrar, y un ahorro que rompe locuciones
   * sale caro. El fallo se registra porque degradar en silencio escondería que
   * la caché de segmentos dejó de funcionar y todo volvió a pagarse completo.
   */
  private async tryAssemble(
    asset: AudioAssetRecord,
    log: AudioLoggerPort,
  ): Promise<(SegmentAssembly & { usageIsReported: boolean }) | null> {
    if (!this.config.AUDIO_SEGMENT_CACHE_ENABLED) return null;
    if (!asset.variablesEncrypted) return null;
    try {
      const template = await this.repo.findTemplate(asset.templateCode);
      const assembly = await this.assembler.assemble(asset, template);
      // El consumo de un ensamblado es la SUMA de tramos: reportado por partes.
      return assembly ? { ...assembly, usageIsReported: false } : null;
    } catch (error) {
      log.error({ event: 'audio.segments.assembly_failed', error });
      return null;
    }
  }

  private async synthesizeWhole(asset: AudioAssetRecord): Promise<{
    audio: Buffer;
    mimeType: string;
    usageUnits: number;
    usageIsReported: boolean;
  }> {
    const text = this.cipher.decrypt(asset.renderedTextEncrypted, asset.assetKey);
    return this.tts.synthesize({
      text,
      language: asset.language,
      voiceProfile: asset.voiceProfile,
      providerVoiceRef: asset.providerVoiceRef,
      model: asset.providerModel,
      outputFormat: asset.outputFormat,
      sampleRate: asset.sampleRate,
      requestId: randomUUID(),
    });
  }

  private async fail(
    asset: AudioAssetRecord,
    error: unknown,
    log: AudioLoggerPort,
    durationMs: number,
  ): Promise<void> {
    const retryable = isRetryable(error);
    const code = errorCodeOf(error);
    await this.repo.markFailed(asset.id, code, retryable);
    this.metrics.increment(AUDIO_METRIC.providerErrors, {
      code,
      retryable: String(retryable),
      provider: this.tts.providerName,
    });
    log.error({
      event: 'audio.generation.failed',
      provider: this.tts.providerName,
      code,
      retryable,
      durationMs,
      error,
    });
    if (retryable) {
      // Se propaga para que la cola durable aplique su backoff y su DLQ.
      throw error;
    }
    await this.compensate(asset);
  }

  /** Libera reserva de presupuesto y cuota diaria de un asset que ya nunca se generará. */
  private async compensate(asset: AudioAssetRecord): Promise<void> {
    if (asset.reservedUnits <= 0) return;
    await this.quota.releaseBudget(
      { provider: asset.provider, monthKey: monthKeyOf(asset.createdAt) },
      asset.reservedUnits,
    );
  }

  private reportSkippedClaim(claim: ClaimOutcome, log: AudioLoggerPort): void {
    switch (claim.outcome) {
      case 'ALREADY_READY':
        log.debug({ event: 'audio.job.skipped', code: 'ALREADY_READY' });
        return;
      case 'LEASED_ELSEWHERE':
        log.debug({ event: 'audio.job.skipped', code: 'LEASED_ELSEWHERE' });
        return;
      case 'EXHAUSTED':
        log.error({ event: 'audio.job.exhausted', code: 'MAX_ATTEMPTS_REACHED' });
        return;
      default:
        // Un job apunta a un asset inexistente: inconsistencia que debe alertarse.
        log.error({ event: 'audio.job.asset_not_found', code: 'ASSET_NOT_FOUND' });
    }
  }
}

function claimCorrelation(claim: ClaimOutcome): string | undefined {
  return claim.outcome === 'NOT_FOUND' ? undefined : claim.asset.correlationId;
}

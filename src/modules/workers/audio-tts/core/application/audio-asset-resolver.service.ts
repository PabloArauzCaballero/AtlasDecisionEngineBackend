import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AudioTtsConfig } from '../config/audio-tts.env';
import type {
  AudioTemplateRecord,
  ResolveAudioRequest,
  ResolveAudioResult,
} from '../domain/audio.types';
import { AudioDomainError } from '../domain/errors';
import {
  AUDIO_ASSET_REPOSITORY,
  AUDIO_LOGGER,
  AUDIO_METRICS,
  AUDIO_QUEUE,
  AUDIO_QUOTA_REPOSITORY,
  AUDIO_TTS_CONFIG,
} from '../domain/audio.tokens';
import type { AudioAssetRepositoryPort } from '../domain/ports/audio-asset.repository';
import type { AudioLoggerPort } from '../domain/ports/audio-logger.port';
import { AUDIO_METRIC, type AudioMetricsPort } from '../domain/ports/audio-metrics.port';
import type { AudioQueuePort } from '../domain/ports/audio-queue.port';
import type { AudioQuotaRepositoryPort } from '../domain/ports/audio-quota.repository';
import { AudioBudgetPolicy, type GenerationPurpose } from './audio-budget.policy';
import { renderIdentity, resolveIdentity } from './audio-identity';
import { AudioValueCipher } from './audio-value-cipher';
import { buildCipher } from './audio-cipher.factory';
import { parseResolveRequest } from './resolve-audio.schema';
import { hasTemplateTokens, renderTemplate } from './template-renderer';

@Injectable()
export class AudioAssetResolver {
  private readonly cipher: AudioValueCipher;
  private readonly policy: AudioBudgetPolicy;

  constructor(
    @Inject(AUDIO_TTS_CONFIG) private readonly config: AudioTtsConfig,
    @Inject(AUDIO_ASSET_REPOSITORY) private readonly repo: AudioAssetRepositoryPort,
    @Inject(AUDIO_QUOTA_REPOSITORY) quota: AudioQuotaRepositoryPort,
    @Inject(AUDIO_QUEUE) private readonly queue: AudioQueuePort,
    @Inject(AUDIO_LOGGER) private readonly logger: AudioLoggerPort,
    @Inject(AUDIO_METRICS) private readonly metrics: AudioMetricsPort,
  ) {
    this.cipher = buildCipher(config);
    this.policy = new AudioBudgetPolicy(quota, config);
  }

  /**
   * Resuelve un audio para uso normal. Un cache hit no consume cuota ni proveedor.
   * Es `async` a propósito: un fallo de validación debe rechazar la promesa, no
   * lanzar de forma síncrona en el llamante.
   */
  async resolve(request: ResolveAudioRequest): Promise<ResolveAudioResult> {
    return this.resolveInternal(parseResolveRequest(request), 'runtime');
  }

  /** Precalienta una plantilla sin variables. Omite el gate runtime, conserva licencia y presupuesto. */
  async prewarm(templateCode: string): Promise<ResolveAudioResult> {
    const request = parseResolveRequest({ templateCode });
    const template = await this.requireTemplate(request.templateCode);
    if (hasTemplateTokens(template.templateText)) {
      throw new AudioDomainError(
        'prewarm solo admite plantillas sin variables',
        'AUDIO_PREWARM_DYNAMIC_TEMPLATE',
      );
    }
    return this.resolveInternal(request, 'prewarm');
  }

  private async resolveInternal(
    request: ResolveAudioRequest,
    purpose: GenerationPurpose,
  ): Promise<ResolveAudioResult> {
    const correlationId = request.correlationId ?? randomUUID();
    const log = this.logger.child({ correlationId, templateCode: request.templateCode });
    const template = await this.requireTemplate(request.templateCode);
    const renderedText = renderTemplate(
      template.templateText,
      request.variables,
      this.config.AUDIO_TTS_MAX_TEXT_LENGTH,
    );
    const identity = resolveIdentity(this.config, template, renderedText, request.language);

    const ready = await this.repo.findReadyByAssetKey(identity.assetKey);
    if (ready?.storageUri) {
      this.metrics.increment(AUDIO_METRIC.cacheHitTotal, { purpose });
      this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'ready', purpose });
      return { status: 'READY', assetId: ready.id, storageUri: ready.storageUri, cacheHit: true };
    }

    const units = [...renderedText].length;
    const reservation = await this.policy.reserve(units, purpose, request.actorId);
    if (!reservation.allowed) {
      const reason = reservation.reason ?? 'GENERATION_DENIED';
      this.metrics.increment(AUDIO_METRIC.budgetDenied, { reason });
      log.info({ event: 'audio.generation.denied', code: reason });
      return this.degrade(template, request, reason, correlationId);
    }

    /*
     * Las variables viajan cifradas junto al texto SIEMPRE que la plantilla las
     * tenga, esté o no encendida la caché de segmentos: son lo que permite a la
     * generación cortar por tramos, y guardarlas sólo con la caché encendida
     * dejaría sin corte todo lo encolado antes de encenderla.
     */
    const variables = request.variables ?? {};
    const variablesEncrypted =
      hasTemplateTokens(template.templateText) && Object.keys(variables).length > 0
        ? this.cipher.encrypt(JSON.stringify(variables), identity.assetKey)
        : undefined;

    const { asset, created } = await this.repo.createPendingIfMissing({
      id: randomUUID(),
      assetKey: identity.assetKey,
      templateCode: template.code,
      templateVersion: template.version,
      renderedTextEncrypted: this.cipher.encrypt(renderedText, identity.assetKey),
      ...(variablesEncrypted ? { variablesEncrypted } : {}),
      providerModel: identity.providerModel,
      reservedUnits: units,
      correlationId,
      language: identity.language,
      provider: identity.provider,
      model: identity.model,
      providerVoiceRef: identity.providerVoiceRef,
      voiceProfile: identity.voiceProfile,
      voiceVersion: identity.voiceVersion,
      outputFormat: identity.outputFormat,
      sampleRate: identity.sampleRate,
    });

    if (!created) {
      // Otra petición ganó la carrera: la reserva de esta no llegará a gastarse.
      await this.policy.release(reservation, request.actorId);
      if (asset.status === 'READY' && asset.storageUri) {
        this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'ready', purpose });
        return { status: 'READY', assetId: asset.id, storageUri: asset.storageUri, cacheHit: true };
      }
    }

    await this.enqueue(asset.id, correlationId, log);
    this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'queued', purpose });
    return { status: 'QUEUED', assetId: asset.id, cacheHit: false };
  }

  /**
   * Publica siempre que el asset siga pendiente: el singletonKey de la cola deduplica.
   * Un fallo de publicación no rompe la petición; el reconciliador lo recupera.
   */
  private async enqueue(
    assetId: string,
    correlationId: string,
    log: AudioLoggerPort,
  ): Promise<void> {
    try {
      const result = await this.queue.publish({ assetId, correlationId });
      log.debug({
        event: 'audio.job.published',
        assetId,
        deduplicated: result.deduplicated,
      });
    } catch (error) {
      log.error({ event: 'audio.job.publish_failed', assetId, error });
      this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'publish_failed' });
    }
  }

  /**
   * Degradación en dos escalones: fallback pre-generado y, si tampoco existe,
   * UNAVAILABLE. El onboarding nunca debe romperse por falta de audio.
   */
  private async degrade(
    template: AudioTemplateRecord,
    request: ResolveAudioRequest,
    reason: string,
    correlationId: string,
  ): Promise<ResolveAudioResult> {
    const code = template.fallbackTemplateCode ?? this.config.AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE;
    const log = this.logger.child({ correlationId });
    try {
      const fallbackTemplate = await this.repo.findTemplate(code);
      if (!fallbackTemplate?.isActive) {
        log.error({ event: 'audio.fallback.template_missing', templateCode: code, code: reason });
        return { status: 'UNAVAILABLE', reason };
      }
      if (fallbackTemplate.strategy !== 'FALLBACK') {
        log.error({ event: 'audio.fallback.strategy_invalid', templateCode: code });
        return { status: 'UNAVAILABLE', reason };
      }
      const identity = renderIdentity(this.config, fallbackTemplate, request.language);
      const ready = await this.repo.findReadyFallback(code, identity);
      if (!ready?.storageUri) {
        log.warn({ event: 'audio.fallback.not_ready', templateCode: code, code: reason });
        this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'unavailable' });
        return { status: 'UNAVAILABLE', reason };
      }
      this.metrics.increment(AUDIO_METRIC.resolveTotal, { result: 'fallback' });
      return { status: 'FALLBACK', assetId: ready.id, storageUri: ready.storageUri, reason };
    } catch (error) {
      log.error({ event: 'audio.fallback.failed', templateCode: code, error });
      return { status: 'UNAVAILABLE', reason };
    }
  }

  private async requireTemplate(code: string): Promise<AudioTemplateRecord> {
    const template = await this.repo.findTemplate(code);
    if (!template?.isActive) {
      throw new AudioDomainError('Plantilla de audio no encontrada', 'AUDIO_TEMPLATE_NOT_FOUND');
    }
    return template;
  }
}

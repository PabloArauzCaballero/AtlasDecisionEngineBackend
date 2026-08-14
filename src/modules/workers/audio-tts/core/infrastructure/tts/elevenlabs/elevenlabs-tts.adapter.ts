import { Inject, Injectable } from '@nestjs/common';
import type { AudioTtsConfig } from '../../../config/audio-tts.env';
import { AUDIO_METRICS, AUDIO_TTS_CONFIG } from '../../../domain/audio.tokens';
import { TtsProviderError } from '../../../domain/errors';
import { AUDIO_METRIC, type AudioMetricsPort } from '../../../domain/ports/audio-metrics.port';
import type {
  TtsProviderHealth,
  TtsProviderPort,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from '../../../domain/ports/tts-provider.port';
import { Bulkhead } from '../../resilience/bulkhead';
import { CircuitBreaker } from '../../resilience/circuit-breaker';
import { backoffWithJitter, ProviderRateGate } from '../../resilience/provider-rate-gate';
import { ElevenLabsHttpClient } from './elevenlabs-http.client';

const CIRCUIT_STATE_VALUE = { CLOSED: 0, HALF_OPEN: 1, OPEN: 2 } as const;

@Injectable()
export class ElevenLabsTtsAdapter implements TtsProviderPort {
  readonly providerName = 'elevenlabs';
  private readonly rateGate: ProviderRateGate;
  private readonly bulkhead: Bulkhead;
  private readonly circuit: CircuitBreaker;

  constructor(
    @Inject(AUDIO_TTS_CONFIG) private readonly config: AudioTtsConfig,
    @Inject(AUDIO_METRICS) private readonly metrics: AudioMetricsPort,
    private readonly http: ElevenLabsHttpClient,
  ) {
    this.rateGate = new ProviderRateGate(
      config.AUDIO_TTS_MAX_REQUESTS_PER_SECOND,
      config.AUDIO_TTS_REPLICA_COUNT,
    );
    this.bulkhead = new Bulkhead(
      config.AUDIO_TTS_MAX_CONCURRENCY,
      config.AUDIO_TTS_BULKHEAD_QUEUE_SIZE,
      config.AUDIO_TTS_BULKHEAD_WAIT_MS,
    );
    this.circuit = new CircuitBreaker({
      failureThreshold: config.AUDIO_TTS_CB_FAILURE_THRESHOLD,
      openMs: config.AUDIO_TTS_CB_OPEN_MS,
      // Solo los fallos transitorios abren el circuito: un 400 es un error propio.
      countsAsFailure: (error) => !(error instanceof TtsProviderError) || error.retryable,
      onStateChange: (state) => {
        this.metrics.gauge(AUDIO_METRIC.circuitState, CIRCUIT_STATE_VALUE[state], {
          provider: this.providerName,
        });
      },
    });
  }

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const startedAt = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.circuit.execute(() =>
          this.bulkhead.execute(async () => {
            await this.rateGate.waitTurn();
            return this.http.synthesize(input);
          }),
        );
        const durationMs = Date.now() - startedAt;
        this.metrics.observe(AUDIO_METRIC.providerDuration, durationMs / 1000, {
          provider: this.providerName,
        });
        return {
          audio: response.audio,
          mimeType: response.mimeType,
          provider: this.providerName,
          model: input.model,
          requestId: response.requestId,
          usageUnits: response.reportedUnits ?? [...input.text].length,
          usageIsReported: response.reportedUnits !== undefined,
          durationMs,
        };
      } catch (error) {
        if (!this.shouldRetry(error, attempt)) throw error;
        await sleep(this.delayFor(error, attempt));
      }
    }
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    if (attempt >= this.config.AUDIO_TTS_HTTP_MAX_RETRIES) return false;
    return error instanceof TtsProviderError && error.retryable;
  }

  private delayFor(error: unknown, attempt: number): number {
    if (error instanceof TtsProviderError && error.retryAfterMs !== undefined) {
      return error.retryAfterMs;
    }
    return backoffWithJitter(attempt, this.config.AUDIO_TTS_RETRY_BASE_MS);
  }

  async health(): Promise<TtsProviderHealth> {
    return {
      configured: Boolean(this.config.ELEVENLABS_API_KEY && this.config.ELEVENLABS_VOICE_ID),
      provider: this.providerName,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

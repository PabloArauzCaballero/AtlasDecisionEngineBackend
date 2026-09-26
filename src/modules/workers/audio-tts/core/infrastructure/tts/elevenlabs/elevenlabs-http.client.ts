import { Inject, Injectable } from '@nestjs/common';
import type { AudioTtsConfig } from '../../../config/audio-tts.env';
import { voiceSettingsPayload } from '../../../config/voice-settings';
import { AUDIO_TTS_CONFIG } from '../../../domain/audio.tokens';
import { TtsProviderError } from '../../../domain/errors';
import type { TtsSynthesisInput } from '../../../domain/ports/tts-provider.port';
import { acceptFor, looksLikeAudio, mimeTypeFor } from '../../storage/audio-format';
import { readCappedBody } from './response-reader';

export interface ElevenLabsResponse {
  audio: Buffer;
  mimeType: string;
  requestId?: string;
  reportedUnits?: number;
}

@Injectable()
export class ElevenLabsHttpClient {
  constructor(@Inject(AUDIO_TTS_CONFIG) private readonly config: AudioTtsConfig) {}

  async synthesize(input: TtsSynthesisInput): Promise<ElevenLabsResponse> {
    const response = await this.send(input);
    if (!response.ok) throw await this.toError(response);
    const audio = await readCappedBody(response, this.config.AUDIO_TTS_MAX_RESPONSE_BYTES);
    return this.validate(audio, response, input);
  }

  private async send(input: TtsSynthesisInput): Promise<Response> {
    const baseUrl = this.config.ELEVENLABS_BASE_URL.replace(/\/+$/u, '');
    const url =
      `${baseUrl}/v1/text-to-speech/${encodeURIComponent(input.providerVoiceRef)}` +
      `?output_format=${encodeURIComponent(input.outputFormat)}`;
    try {
      return await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(this.config.AUDIO_TTS_REQUEST_TIMEOUT_MS),
        headers: {
          'xi-api-key': this.config.ELEVENLABS_API_KEY,
          'content-type': 'application/json',
          accept: acceptFor(input.outputFormat),
        },
        body: JSON.stringify({
          text: input.text,
          model_id: input.model,
          // El idioma forma parte de la identidad del asset: debe llegar al proveedor.
          language_code: toLanguageCode(input.language),
          /*
           * CÓMO habla la voz. Antes no se mandaba nada aquí.
           *
           * No era una omisión inocua: sin `voice_settings` el proveedor aplica
           * los ajustes guardados en la voz, y desde el despliegue no había
           * ninguna forma —ni por `.env`— de tocarlos. Cuando una locución sale
           * plana, que es el motivo corriente de que suene «robótica», el
           * control que lo corrige es `stability`, y no existía.
           *
           * Van SIEMPRE, incluso con los valores por omisión del proveedor: un
           * cuerpo que a veces lleva ajustes y a veces no hace que el mismo
           * texto suene distinto según qué versión del motor lo generó, y eso
           * no se puede auditar después.
           */
          voice_settings: voiceSettingsPayload(this.config),
        }),
      });
    } catch (error) {
      throw toTransportError(error);
    }
  }

  private async toError(response: Response): Promise<TtsProviderError> {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    // El cuerpo no se incluye en el mensaje: podría contener datos del proveedor.
    await response.body?.cancel().catch(() => undefined);
    return new TtsProviderError(
      `ElevenLabs respondió ${response.status}`,
      `ELEVENLABS_HTTP_${response.status}`,
      retryable,
      retryAfter,
    );
  }

  /** Un 200 con cuerpo HTML o vacío jamás debe cachearse como audio válido. */
  private validate(
    audio: Buffer,
    response: Response,
    input: TtsSynthesisInput,
  ): ElevenLabsResponse {
    if (audio.length < this.config.AUDIO_TTS_MIN_RESPONSE_BYTES) {
      throw new TtsProviderError(
        `Respuesta de audio demasiado pequeña (${audio.length} bytes)`,
        'ELEVENLABS_RESPONSE_TOO_SMALL',
        true,
      );
    }
    if (!looksLikeAudio(audio, input.outputFormat)) {
      throw new TtsProviderError(
        'La respuesta del proveedor no es audio del formato solicitado',
        'ELEVENLABS_RESPONSE_NOT_AUDIO',
        false,
      );
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
    return {
      audio,
      mimeType:
        contentType && contentType !== 'application/json'
          ? contentType
          : mimeTypeFor(input.outputFormat),
      requestId: response.headers.get('request-id') ?? undefined,
      reportedUnits: parseReportedUnits(response.headers),
    };
  }
}

/** `es-419` → `es`: el proveedor espera un código ISO-639-1. */
function toLanguageCode(language: string): string {
  return (language.split('-')[0] ?? language).toLowerCase();
}

function parseReportedUnits(headers: Headers): number | undefined {
  const raw = headers.get('character-cost') ?? headers.get('x-character-cost');
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * `AbortSignal.timeout` produce un `TimeoutError`; un abort externo, `AbortError`.
 * Comprobar el nombre del error es frágil, así que se inspeccionan ambos y la causa.
 */
export function toTransportError(error: unknown): TtsProviderError {
  if (error instanceof TtsProviderError) return error;
  const names = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    names.add(current.name);
    current = (current as { cause?: unknown }).cause;
  }
  if (names.has('TimeoutError') || names.has('AbortError')) {
    return new TtsProviderError('Timeout de ElevenLabs', 'ELEVENLABS_TIMEOUT', true);
  }
  return new TtsProviderError('Fallo de red con ElevenLabs', 'ELEVENLABS_NETWORK_ERROR', true);
}

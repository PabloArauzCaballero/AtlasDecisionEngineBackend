import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  TtsProviderHealth,
  TtsProviderPort,
  TtsSynthesisInput,
  TtsSynthesisResult,
} from '../../domain/ports/tts-provider.port';
import { mimeTypeFor } from '../storage/audio-format';

/** Cabecera MP3 mínima para que el audio sintético supere la validación de formato. */
const MP3_HEADER = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

@Injectable()
export class FakeTtsAdapter implements TtsProviderPort {
  readonly providerName = 'fake';

  async synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult> {
    const hash = createHash('sha256')
      .update(`${input.text}\0${input.providerVoiceRef}\0${input.model}\0${input.language}`)
      .digest();
    const body = Buffer.concat([MP3_HEADER, hash, Buffer.alloc(512, hash[0] ?? 0)]);
    return {
      audio: body,
      mimeType: mimeTypeFor(input.outputFormat),
      provider: this.providerName,
      model: input.model,
      requestId: input.requestId,
      usageUnits: [...input.text].length,
      usageIsReported: false,
      durationMs: 0,
    };
  }

  async health(): Promise<TtsProviderHealth> {
    return { configured: true, provider: this.providerName };
  }
}

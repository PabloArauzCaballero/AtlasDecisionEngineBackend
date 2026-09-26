import { Injectable } from '@nestjs/common';
import { TtsProviderError } from '../../domain/errors';
import type {
  TtsProviderHealth,
  TtsProviderPort,
  TtsSynthesisResult,
} from '../../domain/ports/tts-provider.port';

@Injectable()
export class DisabledTtsAdapter implements TtsProviderPort {
  readonly providerName = 'disabled';

  async synthesize(): Promise<TtsSynthesisResult> {
    throw new TtsProviderError('TTS deshabilitado', 'TTS_DISABLED', false);
  }

  async health(): Promise<TtsProviderHealth> {
    return { configured: true, provider: this.providerName };
  }
}

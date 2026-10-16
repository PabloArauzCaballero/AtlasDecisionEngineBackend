import { Injectable } from '@nestjs/common';
import { AudioTtsRuntimeFactory } from './audio-tts.runtime';

/** Con qué voz y hasta qué largo se locuta hoy: entra en la clave de idempotencia. */
@Injectable()
export class AudioRenderPolicy {
  constructor(private readonly runtime: AudioTtsRuntimeFactory) {}

  /**
   * La identidad de la voz vigente, condensada en una cadena.
   *
   * Entra en la clave de idempotencia. No es un adorno: un audio no es función
   * sólo del texto, sino del texto Y de con qué voz se dice, así que cambiar de
   * voz, de modelo o de formato tiene que volver a locutar en vez de devolver
   * lo que se generó con la anterior. Es la misma lección que la huella de
   * calibración del worker de identidad.
   */
  renderFingerprint(): string {
    const core = this.runtime.coreConfig();
    return [
      core.AUDIO_TTS_PROVIDER,
      core.ELEVENLABS_MODEL_ID || core.AUDIO_TTS_MODEL,
      core.ELEVENLABS_VOICE_ID || core.AUDIO_TTS_PROVIDER,
      core.AUDIO_TTS_VOICE_PROFILE,
      String(core.AUDIO_TTS_VOICE_VERSION),
      core.ELEVENLABS_OUTPUT_FORMAT || core.AUDIO_TTS_DEFAULT_FORMAT,
      String(core.AUDIO_TTS_SAMPLE_RATE),
    ].join('|');
  }

  maxTextLength(): number {
    return this.runtime.coreConfig().AUDIO_TTS_MAX_TEXT_LENGTH;
  }
}

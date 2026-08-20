import type { AudioTtsConfig } from '../config/audio-tts.env';
import { voiceSettingsFrom } from '../config/voice-settings';
import type { AudioRenderIdentity, AudioTemplateRecord } from '../domain/audio.types';
import { buildAudioAssetKey } from './audio-asset-key';

export interface ResolvedIdentity extends AudioRenderIdentity {
  providerModel: string;
  assetKey: string;
}

function providerVoiceRef(config: AudioTtsConfig): string {
  if (config.AUDIO_TTS_PROVIDER === 'elevenlabs') return config.ELEVENLABS_VOICE_ID;
  if (config.AUDIO_TTS_PROVIDER === 'fake') return 'fake-default';
  return '';
}

/** Dimensiones de identidad sin el assetKey: sirven para filtrar un fallback equivalente. */
export function renderIdentity(
  config: AudioTtsConfig,
  template: AudioTemplateRecord,
  languageOverride?: string,
): AudioRenderIdentity & { providerModel: string } {
  const model = config.ELEVENLABS_MODEL_ID || config.AUDIO_TTS_MODEL;
  return {
    language: (
      languageOverride ??
      template.language ??
      config.AUDIO_TTS_DEFAULT_LANGUAGE
    ).toLowerCase(),
    provider: config.AUDIO_TTS_PROVIDER,
    model,
    providerModel: model,
    providerVoiceRef: providerVoiceRef(config),
    voiceProfile: config.AUDIO_TTS_VOICE_PROFILE,
    voiceVersion: config.AUDIO_TTS_VOICE_VERSION,
    outputFormat: config.ELEVENLABS_OUTPUT_FORMAT || config.AUDIO_TTS_DEFAULT_FORMAT,
    sampleRate: config.AUDIO_TTS_SAMPLE_RATE,
  };
}

export function resolveIdentity(
  config: AudioTtsConfig,
  template: AudioTemplateRecord,
  renderedText: string,
  languageOverride?: string,
): ResolvedIdentity {
  const identity = renderIdentity(config, template, languageOverride);
  return {
    ...identity,
    assetKey: buildAudioAssetKey({
      templateCode: template.code,
      templateVersion: template.version,
      renderedText,
      ...identity,
      // Sale de la MISMA función que arma el cuerpo enviado al proveedor
      // (`config/voice-settings.ts`). Leer la configuración por segunda vez aquí
      // dejaría que las dos lecturas se separaran, y separadas el fallo es
      // mudo: la caché serviría audio hecho con ajustes distintos a los pedidos.
      voiceSettings: voiceSettingsFrom(config),
    }),
  };
}

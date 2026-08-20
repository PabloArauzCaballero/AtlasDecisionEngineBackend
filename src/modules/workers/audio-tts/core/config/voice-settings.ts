import type { AudioTtsConfig } from './audio-tts.env';

/**
 * Cómo habla la voz, en un solo sitio.
 *
 * Vive aquí y no en el cliente HTTP porque estos cuatro valores tienen que
 * llegar a DOS destinos que no se pueden contradecir: el cuerpo que se manda al
 * proveedor y la clave de caché del audio. Si el cuerpo cambiara sin que
 * cambiara la clave, ajustar la expresividad no se oiría nunca —seguiría
 * sirviéndose el audio de antes— y parecería que el control no funciona; si
 * cambiara la clave sin cambiar el cuerpo, se regeneraría audio idéntico y se
 * pagaría dos veces por lo mismo. Una función leída por los dos hace que ese
 * desacuerdo no se pueda escribir.
 */
export interface VoiceSettings {
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
}

/**
 * Los ajustes vigentes, o `null` cuando el proveedor no los admite.
 *
 * `null` para `fake` y `disabled` a propósito, y por la misma razón que
 * `providerVoiceRef` queda vacío para ellos: meter en la identidad del audio un
 * ajuste que nadie aplicó haría que cambiarlo invalidara la caché sin que el
 * sonido pudiera cambiar.
 */
export function voiceSettingsFrom(config: AudioTtsConfig): VoiceSettings | null {
  if (config.AUDIO_TTS_PROVIDER !== 'elevenlabs') return null;
  return {
    stability: config.ELEVENLABS_VOICE_STABILITY,
    similarityBoost: config.ELEVENLABS_VOICE_SIMILARITY_BOOST,
    style: config.ELEVENLABS_VOICE_STYLE,
    speakerBoost: config.ELEVENLABS_VOICE_SPEAKER_BOOST,
  };
}

/** Los mismos valores con los nombres que espera el proveedor. */
export function voiceSettingsPayload(
  config: AudioTtsConfig,
): Record<string, number | boolean> | undefined {
  const settings = voiceSettingsFrom(config);
  if (!settings) return undefined;
  return {
    stability: settings.stability,
    similarity_boost: settings.similarityBoost,
    style: settings.style,
    use_speaker_boost: settings.speakerBoost,
  };
}

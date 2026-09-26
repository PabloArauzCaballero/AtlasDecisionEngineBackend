import { buildAudioAssetKey } from '../src/modules/workers/audio-tts/core/application/audio-asset-key';
import type { AudioTtsConfig } from '../src/modules/workers/audio-tts/core/config/audio-tts.env';
import {
  voiceSettingsFrom,
  voiceSettingsPayload,
} from '../src/modules/workers/audio-tts/core/config/voice-settings';

/**
 * Cómo habla la voz: que llegue al proveedor Y que cambie la caché.
 *
 * Este worker es cache-first, y eso convierte un olvido en un fallo mudo. Si los
 * ajustes de voz viajan al proveedor pero no entran en la clave del asset,
 * bajarle la estabilidad para que deje de sonar plana NO se oye: la primera
 * petición encuentra en caché el audio de antes y lo devuelve tal cual, sin
 * generar nada y sin decir que no lo hizo. Quien lo ajustó concluye que el
 * control no sirve, cuando lo que pasó es que nunca se usó.
 *
 * Por eso las dos afirmaciones se prueban juntas: el cuerpo y la huella salen de
 * la misma configuración, y tienen que moverse a la vez.
 */
function config(overrides: Partial<AudioTtsConfig> = {}): AudioTtsConfig {
  return {
    AUDIO_TTS_PROVIDER: 'elevenlabs',
    ELEVENLABS_VOICE_STABILITY: 0.5,
    ELEVENLABS_VOICE_SIMILARITY_BOOST: 0.75,
    ELEVENLABS_VOICE_STYLE: 0,
    ELEVENLABS_VOICE_SPEAKER_BOOST: true,
    ...overrides,
  } as AudioTtsConfig;
}

function key(overrides: Partial<AudioTtsConfig> = {}): string {
  return buildAudioAssetKey({
    templateCode: 'onboarding.welcome.generic',
    templateVersion: 1,
    renderedText: 'Hola, bienvenida a Atlas.',
    language: 'es',
    provider: 'elevenlabs',
    model: 'eleven_multilingual_v2',
    voiceProfile: 'brand_es_latam_v1',
    voiceVersion: 1,
    providerVoiceRef: 'voz-1',
    outputFormat: 'mp3_44100_128',
    sampleRate: 44_100,
    voiceSettings: voiceSettingsFrom(config(overrides)),
  });
}

describe('ajustes de voz del worker de locución', () => {
  it('viajan al proveedor con los nombres que espera', () => {
    expect(voiceSettingsPayload(config())).toEqual({
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0,
      use_speaker_boost: true,
    });
  });

  /**
   * El defecto es el DOCUMENTADO por el proveedor, y eso no es un detalle.
   *
   * Cablear un control que antes no existía no debe cambiar por sorpresa cómo
   * suena una marca: quien no toque nada tiene que seguir oyendo lo mismo que
   * oía cuando el cuerpo no llevaba `voice_settings`.
   */
  it('por omisión son los del proveedor, así que cablearlos no cambia cómo suena', () => {
    const settings = voiceSettingsFrom(config());
    expect(settings).toEqual({
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speakerBoost: true,
    });
  });

  it.each([
    ['la estabilidad', { ELEVENLABS_VOICE_STABILITY: 0.3 }],
    ['el parecido', { ELEVENLABS_VOICE_SIMILARITY_BOOST: 0.9 }],
    ['el estilo', { ELEVENLABS_VOICE_STYLE: 0.4 }],
    ['el refuerzo de hablante', { ELEVENLABS_VOICE_SPEAKER_BOOST: false }],
  ])('cambiar %s cambia la clave de caché: el audio se regenera', (_, overrides) => {
    expect(key(overrides)).not.toBe(key());
  });

  it('la misma configuración da la misma clave: no se paga dos veces lo mismo', () => {
    expect(key()).toBe(key());
  });

  /**
   * Con un proveedor que no admite ajustes, la huella no se mueve.
   *
   * Si `fake` metiera estos valores en la clave, tocar la estabilidad invalidaría
   * una caché cuyo sonido no puede cambiar — se regeneraría audio idéntico.
   */
  it('sin proveedor que los admita no hay ajustes ni entran en la clave', () => {
    expect(voiceSettingsFrom(config({ AUDIO_TTS_PROVIDER: 'fake' }))).toBeNull();
    expect(voiceSettingsPayload(config({ AUDIO_TTS_PROVIDER: 'fake' }))).toBeUndefined();
    expect(key({ AUDIO_TTS_PROVIDER: 'fake', ELEVENLABS_VOICE_STABILITY: 0.1 })).toBe(
      key({ AUDIO_TTS_PROVIDER: 'fake' }),
    );
  });
});

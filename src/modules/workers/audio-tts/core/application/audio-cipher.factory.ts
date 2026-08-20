import type { AudioTtsConfig } from '../config/audio-tts.env';
import { AudioValueCipher, parsePreviousKeys } from './audio-value-cipher';

/**
 * Construye el anillo de claves activo. En `test` se admite un secreto corto
 * para no obligar a las pruebas a manejar material criptográfico realista.
 */
export function buildCipher(config: AudioTtsConfig): AudioValueCipher {
  return new AudioValueCipher(
    { id: config.AUDIO_TTS_DATA_KEY_ID, secret: config.AUDIO_TTS_DATA_KEY },
    parsePreviousKeys(config.AUDIO_TTS_DATA_KEYS_PREVIOUS),
    config.NODE_ENV === 'test',
  );
}

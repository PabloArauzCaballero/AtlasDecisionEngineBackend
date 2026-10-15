import type { EnvRule } from './env-rule';

export const requireCoherentAudioTtsSettings: EnvRule = (value, ctx) => {
  /*
   * Locución: coherencia que vale en TODOS los entornos.
   *
   * Estas cuatro vienen del esquema del paquete original y se conservan
   * porque describen combinaciones que no funcionan, no políticas: con ellas
   * mal puestas el worker arranca y falla en cada locución, que es la peor
   * forma de descubrirlo.
   */
  if (value.AUDIO_TTS_WORKER_ENABLED) {
    if (value.AUDIO_TTS_PROVIDER === 'elevenlabs' && !value.ELEVENLABS_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ELEVENLABS_API_KEY'],
        message: 'ELEVENLABS_API_KEY es obligatoria con AUDIO_TTS_PROVIDER=elevenlabs.',
      });
    }
    if (value.AUDIO_TTS_PROVIDER === 'elevenlabs' && !value.ELEVENLABS_VOICE_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['ELEVENLABS_VOICE_ID'],
        message:
          'ELEVENLABS_VOICE_ID es obligatoria con AUDIO_TTS_PROVIDER=elevenlabs: la voz ' +
          'forma parte de la identidad del audio, no es un valor por omisión.',
      });
    }
    /*
     * La clave de cifrado se exige en cuanto el worker está encendido, salvo
     * en pruebas. No es ceremonia: el texto locutado lleva dentro las
     * variables —el nombre de una persona— y su única copia vive en la caché.
     * Sin clave no hay dónde guardarlo cifrado.
     */
    if (value.NODE_ENV !== 'test' && value.AUDIO_TTS_DATA_KEY.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUDIO_TTS_DATA_KEY'],
        message:
          'AUDIO_TTS_DATA_KEY debe tener al menos 32 caracteres con el worker de locución ' +
          'encendido: cifra el texto que se pone en boca de la marca, que lleva dentro las ' +
          'variables de cada locución.',
      });
    }
  }
  /*
   * El arrendamiento tiene que sobrevivir a la petición más lenta al
   * proveedor. Si no, otra réplica recupera el trabajo mientras el primero
   * todavía está esperando el audio, y se paga dos veces por la misma frase.
   */
  if (value.AUDIO_TTS_LEASE_SECONDS * 1_000 <= value.AUDIO_TTS_REQUEST_TIMEOUT_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIO_TTS_LEASE_SECONDS'],
      message:
        'AUDIO_TTS_LEASE_SECONDS debe superar AUDIO_TTS_REQUEST_TIMEOUT_MS: un arrendamiento ' +
        'más corto que la petición al proveedor deja que otra réplica pague la misma locución.',
    });
  }
  if (value.AUDIO_TTS_SAFETY_RESERVE_UNITS > value.AUDIO_TTS_MONTHLY_BUDGET_UNITS) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIO_TTS_SAFETY_RESERVE_UNITS'],
      message:
        'AUDIO_TTS_SAFETY_RESERVE_UNITS no puede superar AUDIO_TTS_MONTHLY_BUDGET_UNITS: ' +
        'dejaría el presupuesto utilizable en cero y ninguna locución llegaría a generarse.',
    });
  }
  if (value.AUDIO_TTS_MIN_RESPONSE_BYTES >= value.AUDIO_TTS_MAX_RESPONSE_BYTES) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUDIO_TTS_MIN_RESPONSE_BYTES'],
      message: 'AUDIO_TTS_MIN_RESPONSE_BYTES debe ser menor que AUDIO_TTS_MAX_RESPONSE_BYTES.',
    });
  }
};

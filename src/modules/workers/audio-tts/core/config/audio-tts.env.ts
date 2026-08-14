/**
 * Configuración que el núcleo del worker de locución espera recibir.
 *
 * El paquete original leía `process.env` y lo validaba con Zod aquí mismo. En
 * el motor eso sobra y además estorba: la validación de entorno vive en un solo
 * sitio (`common/config/env.schema.ts`) y la construye Nest al arrancar, así
 * que un segundo esquema podría aceptar lo que el primero rechaza —o al revés—
 * y nadie sabría cuál gobierna.
 *
 * Lo que queda es el CONTRATO: los mismos nombres de campo, para que el núcleo
 * absorbido no tenga que cambiar ni una línea, y los valores por omisión, que
 * son los del paquete y siguen siendo suyos. Quien lo construye es
 * `audio-tts-config.bridge.ts` a partir del `ConfigService` del motor.
 */

/** El nombre del proveedor gobierna la identidad del audio, no sólo quién lo genera. */
export type AudioTtsProviderName = 'disabled' | 'fake' | 'elevenlabs';

/**
 * Dónde vive el audio ya generado.
 *
 * `database` es el que trae el motor y el que se usa por omisión: los otros
 * tres workers ya guardan su carga útil en la propia base —el PDF del extracto,
 * las imágenes de la verificación— y el audio hereda con ello la misma política
 * de aislamiento por tenant y la misma copia de seguridad. `local` es el
 * adaptador de disco del paquete, absorbido tal cual, útil para desarrollo.
 *
 * El paquete traía además un adaptador S3. **No se absorbe**, y no por
 * descuido: arrastraría dos paquetes del SDK de AWS a un motor que hoy no
 * depende de ninguno, para resolver un problema —dónde poner los bytes— que
 * este motor ya tiene resuelto de otra manera.
 */
export type AudioStorageDriver = 'database' | 'local';

export interface AudioTtsConfig {
  NODE_ENV: string;

  AUDIO_TTS_ENABLED: boolean;
  AUDIO_TTS_PROVIDER: AudioTtsProviderName;
  AUDIO_TTS_ALLOW_RUNTIME_GENERATION: boolean;
  AUDIO_TTS_PROD_LICENSE_CONFIRMED: boolean;

  AUDIO_TTS_DEFAULT_LANGUAGE: string;
  AUDIO_TTS_DEFAULT_FORMAT: string;
  AUDIO_TTS_SAMPLE_RATE: number;
  AUDIO_TTS_VOICE_PROFILE: string;
  AUDIO_TTS_VOICE_VERSION: number;
  AUDIO_TTS_MODEL: string;
  AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE: string;
  AUDIO_TTS_MAX_TEXT_LENGTH: number;

  AUDIO_TTS_MONTHLY_BUDGET_UNITS: number;
  AUDIO_TTS_SAFETY_RESERVE_UNITS: number;
  AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY: number;
  AUDIO_TTS_ACTOR_LIMIT_UNLIMITED: boolean;

  AUDIO_TTS_REQUEST_TIMEOUT_MS: number;
  AUDIO_TTS_MAX_RESPONSE_BYTES: number;
  AUDIO_TTS_MIN_RESPONSE_BYTES: number;
  AUDIO_TTS_HTTP_MAX_RETRIES: number;
  AUDIO_TTS_RETRY_BASE_MS: number;
  AUDIO_TTS_MAX_CONCURRENCY: number;
  AUDIO_TTS_MAX_REQUESTS_PER_SECOND: number;
  AUDIO_TTS_REPLICA_COUNT: number;
  AUDIO_TTS_BULKHEAD_QUEUE_SIZE: number;
  AUDIO_TTS_BULKHEAD_WAIT_MS: number;
  AUDIO_TTS_CB_FAILURE_THRESHOLD: number;
  AUDIO_TTS_CB_OPEN_MS: number;

  AUDIO_TTS_DATA_KEY: string;
  AUDIO_TTS_DATA_KEY_ID: string;
  AUDIO_TTS_DATA_KEYS_PREVIOUS: string;

  ELEVENLABS_API_KEY: string;
  ELEVENLABS_BASE_URL: string;
  ELEVENLABS_VOICE_ID: string;
  ELEVENLABS_MODEL_ID: string;
  ELEVENLABS_OUTPUT_FORMAT: string;

  /**
   * CÓMO habla la voz, no cuál es. Lo que el proveedor llama `voice_settings`.
   *
   * No estaban, y su ausencia no era neutral: el cliente mandaba sólo texto,
   * modelo e idioma, así que el proveedor aplicaba los ajustes guardados en la
   * voz y desde aquí no había forma de tocarlos. Cuando una locución sale plana
   * —el motivo más común de que suene «robótica»— el control que la arregla es
   * `stability`, y sencillamente no existía.
   *
   * Los valores por omisión son los DOCUMENTADOS por el proveedor, a propósito:
   * cablear el control no debe cambiar por sorpresa cómo suena una marca. Quien
   * quiera otra cosa lo dice en su `.env`, y entonces es una decisión de alguien.
   *
   * - `stability` 0–1: cuanto más bajo, más varía la entonación. Bajo suena
   *   expresivo; alto, monótono. Es la palanca contra la lectura plana.
   * - `similarityBoost` 0–1: cuánto se ciñe al timbre original de la voz.
   * - `style` 0–1: exageración del estilo. Por encima de 0 añade expresión y
   *   también latencia, y desestabiliza si se sube mucho.
   * - `speakerBoost`: refuerza el parecido con el hablante original.
   */
  ELEVENLABS_VOICE_STABILITY: number;
  ELEVENLABS_VOICE_SIMILARITY_BOOST: number;
  ELEVENLABS_VOICE_STYLE: number;
  ELEVENLABS_VOICE_SPEAKER_BOOST: boolean;

  AUDIO_GENERATION_LEASE_SECONDS: number;
  AUDIO_QUEUE_RETRY_LIMIT: number;

  AUDIO_STORAGE_DRIVER: AudioStorageDriver;
  AUDIO_LOCAL_STORAGE_PATH: string;

  /**
   * Generar por SEGMENTOS cacheados: los tramos fijos de la plantilla se pagan
   * una vez y una frase nueva sólo paga sus variables. El precio, declarado en
   * el resultado, es la prosodia de las costuras. Apagado por omisión: coser
   * audio es una decisión de calidad que alguien tiene que tomar por escrito.
   */
  AUDIO_SEGMENT_CACHE_ENABLED: boolean;
}

/**
 * Valor por omisión publicado en el repositorio: nunca es un secreto válido.
 *
 * Se conserva del paquete y sigue cumpliendo la misma función: existe para que
 * las pruebas y el desarrollo arranquen, y para que el esquema de entorno pueda
 * RECHAZARLO por su nombre en cuanto el despliegue no es de desarrollo. Una
 * clave por omisión que nadie puede detectar es peor que no tener ninguna.
 */
export const PUBLISHED_DEV_DATA_KEY = 'dev-only-audio-data-key-change';

/** Los mismos valores por omisión del paquete, en un solo sitio. */
export const AUDIO_TTS_DEFAULTS = {
  language: 'es-419',
  format: 'mp3_44100_128',
  sampleRate: 44_100,
  voiceProfile: 'brand_es_latam_v1',
  voiceVersion: 1,
  model: 'eleven_v3',
  fallbackTemplate: 'onboarding.fallback.generic',
  maxTextLength: 5_000,
  monthlyBudgetUnits: 10_000,
  safetyReserveUnits: 1_000,
  generationsPerActorDay: 3,
  leaseSeconds: 300,
  retryLimit: 3,
  localStoragePath: '.local/audio-assets',
} as const;

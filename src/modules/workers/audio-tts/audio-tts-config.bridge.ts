/**
 * Traduce la configuración del motor a la que espera el núcleo absorbido.
 *
 * Mismo papel que `semantic-config.bridge.ts`: el paquete leía `process.env` y
 * lo validaba con su propio esquema al construirse, y eso aquí no puede ser.
 * Validar dos veces la misma variable con dos esquemas distintos deja abierta la
 * posibilidad de que uno acepte lo que el otro rechaza; y validar credenciales
 * al construir impedía arrancar una réplica de API con el worker apagado.
 *
 * Lo que la validación de entorno del motor NO puede comprobar —porque depende
 * de qué proveedor se eligió— se comprueba aquí y en el catálogo: un worker sin
 * proveedor configurado se declara no disponible en vez de aceptar trabajo que
 * va a fallar.
 */
import type { ConfigService } from '@nestjs/config';
import {
  AUDIO_TTS_DEFAULTS,
  type AudioStorageDriver,
  type AudioTtsConfig,
  type AudioTtsProviderName,
} from './core/config/audio-tts.env';

export function buildAudioTtsConfig(config: ConfigService): AudioTtsConfig {
  const num = (key: string, fallback: number): number => config.get<number>(key) ?? fallback;
  const str = (key: string, fallback: string): string => config.get<string>(key) ?? fallback;
  const bool = (key: string, fallback: boolean): boolean => config.get<boolean>(key) ?? fallback;

  return {
    NODE_ENV: str('NODE_ENV', 'development'),

    AUDIO_TTS_ENABLED: bool('AUDIO_TTS_WORKER_ENABLED', false),
    AUDIO_TTS_PROVIDER: str('AUDIO_TTS_PROVIDER', 'disabled') as AudioTtsProviderName,
    AUDIO_TTS_ALLOW_RUNTIME_GENERATION: bool('AUDIO_TTS_ALLOW_RUNTIME_GENERATION', false),
    AUDIO_TTS_PROD_LICENSE_CONFIRMED: bool('AUDIO_TTS_PROD_LICENSE_CONFIRMED', false),

    AUDIO_TTS_DEFAULT_LANGUAGE: str('AUDIO_TTS_DEFAULT_LANGUAGE', AUDIO_TTS_DEFAULTS.language),
    AUDIO_TTS_DEFAULT_FORMAT: str('AUDIO_TTS_DEFAULT_FORMAT', AUDIO_TTS_DEFAULTS.format),
    AUDIO_TTS_SAMPLE_RATE: num('AUDIO_TTS_SAMPLE_RATE', AUDIO_TTS_DEFAULTS.sampleRate),
    AUDIO_TTS_VOICE_PROFILE: str('AUDIO_TTS_VOICE_PROFILE', AUDIO_TTS_DEFAULTS.voiceProfile),
    AUDIO_TTS_VOICE_VERSION: num('AUDIO_TTS_VOICE_VERSION', AUDIO_TTS_DEFAULTS.voiceVersion),
    AUDIO_TTS_MODEL: str('AUDIO_TTS_MODEL', AUDIO_TTS_DEFAULTS.model),
    AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE: str(
      'AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE',
      AUDIO_TTS_DEFAULTS.fallbackTemplate,
    ),
    AUDIO_TTS_MAX_TEXT_LENGTH: num('AUDIO_TTS_MAX_TEXT_LENGTH', AUDIO_TTS_DEFAULTS.maxTextLength),

    AUDIO_TTS_MONTHLY_BUDGET_UNITS: num(
      'AUDIO_TTS_MONTHLY_BUDGET_UNITS',
      AUDIO_TTS_DEFAULTS.monthlyBudgetUnits,
    ),
    AUDIO_TTS_SAFETY_RESERVE_UNITS: num(
      'AUDIO_TTS_SAFETY_RESERVE_UNITS',
      AUDIO_TTS_DEFAULTS.safetyReserveUnits,
    ),
    AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY: num(
      'AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY',
      AUDIO_TTS_DEFAULTS.generationsPerActorDay,
    ),
    AUDIO_TTS_ACTOR_LIMIT_UNLIMITED: bool('AUDIO_TTS_ACTOR_LIMIT_UNLIMITED', false),

    AUDIO_TTS_REQUEST_TIMEOUT_MS: num('AUDIO_TTS_REQUEST_TIMEOUT_MS', 10_000),
    AUDIO_TTS_MAX_RESPONSE_BYTES: num('AUDIO_TTS_MAX_RESPONSE_BYTES', 10_485_760),
    AUDIO_TTS_MIN_RESPONSE_BYTES: num('AUDIO_TTS_MIN_RESPONSE_BYTES', 256),
    AUDIO_TTS_HTTP_MAX_RETRIES: num('AUDIO_TTS_HTTP_MAX_RETRIES', 0),
    AUDIO_TTS_RETRY_BASE_MS: num('AUDIO_TTS_RETRY_BASE_MS', 500),
    AUDIO_TTS_MAX_CONCURRENCY: num('AUDIO_TTS_MAX_CONCURRENCY', 2),
    AUDIO_TTS_MAX_REQUESTS_PER_SECOND: num('AUDIO_TTS_MAX_REQUESTS_PER_SECOND', 2),
    AUDIO_TTS_REPLICA_COUNT: num('AUDIO_TTS_REPLICA_COUNT', 1),
    AUDIO_TTS_BULKHEAD_QUEUE_SIZE: num('AUDIO_TTS_BULKHEAD_QUEUE_SIZE', 16),
    AUDIO_TTS_BULKHEAD_WAIT_MS: num('AUDIO_TTS_BULKHEAD_WAIT_MS', 15_000),
    AUDIO_TTS_CB_FAILURE_THRESHOLD: num('AUDIO_TTS_CB_FAILURE_THRESHOLD', 5),
    AUDIO_TTS_CB_OPEN_MS: num('AUDIO_TTS_CB_OPEN_MS', 30_000),

    AUDIO_TTS_DATA_KEY: str('AUDIO_TTS_DATA_KEY', ''),
    AUDIO_TTS_DATA_KEY_ID: str('AUDIO_TTS_DATA_KEY_ID', 'k1'),
    AUDIO_TTS_DATA_KEYS_PREVIOUS: str('AUDIO_TTS_DATA_KEYS_PREVIOUS', ''),

    ELEVENLABS_API_KEY: str('ELEVENLABS_API_KEY', ''),
    ELEVENLABS_BASE_URL: str('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io'),
    ELEVENLABS_VOICE_ID: str('ELEVENLABS_VOICE_ID', ''),
    ELEVENLABS_MODEL_ID: str('ELEVENLABS_MODEL_ID', ''),
    ELEVENLABS_OUTPUT_FORMAT: str('ELEVENLABS_OUTPUT_FORMAT', ''),
    ELEVENLABS_VOICE_STABILITY: num('ELEVENLABS_VOICE_STABILITY', 0.5),
    ELEVENLABS_VOICE_SIMILARITY_BOOST: num('ELEVENLABS_VOICE_SIMILARITY_BOOST', 0.75),
    ELEVENLABS_VOICE_STYLE: num('ELEVENLABS_VOICE_STYLE', 0),
    ELEVENLABS_VOICE_SPEAKER_BOOST: bool('ELEVENLABS_VOICE_SPEAKER_BOOST', true),

    AUDIO_GENERATION_LEASE_SECONDS: num('AUDIO_TTS_LEASE_SECONDS', AUDIO_TTS_DEFAULTS.leaseSeconds),
    AUDIO_QUEUE_RETRY_LIMIT: num('AUDIO_TTS_MAX_ATTEMPTS', AUDIO_TTS_DEFAULTS.retryLimit),

    AUDIO_STORAGE_DRIVER: str('AUDIO_STORAGE_DRIVER', 'database') as AudioStorageDriver,
    AUDIO_LOCAL_STORAGE_PATH: str('AUDIO_LOCAL_STORAGE_PATH', AUDIO_TTS_DEFAULTS.localStoragePath),

    AUDIO_SEGMENT_CACHE_ENABLED: bool('AUDIO_SEGMENT_CACHE_ENABLED', false),
  };
}

/**
 * ¿Puede este despliegue locutar?
 *
 * Encendido **y** con proveedor, igual que el worker semántico exige proveedor
 * de modelo. Un worker encendido sin proveedor aceptaría trabajo que no puede
 * hacer, y la diferencia entre declararlo no disponible y no hacerlo es una
 * pantalla que lo explica frente a una cola de errores.
 */
export function audioTtsAvailable(config: ConfigService): boolean {
  return (
    (config.get<boolean>('AUDIO_TTS_WORKER_ENABLED') ?? false) &&
    (config.get<string>('AUDIO_TTS_PROVIDER') ?? 'disabled') !== 'disabled'
  );
}

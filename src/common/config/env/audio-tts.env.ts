import { z } from 'zod';
import { booleanFromString } from './helpers';

export const audioTtsEnv = {
  // --- Worker D: locución (ADR-0026) --------------------------------------
  //
  // El único de los cuatro que puede COSTAR DINERO por ejecución, y eso marca
  // casi todas las variables que siguen: hay un presupuesto mensual, un techo
  // por persona y día, y una puerta aparte para permitir generar bajo demanda.
  AUDIO_TTS_WORKER_ENABLED: booleanFromString.default(false),
  /*
   * `disabled` ⇒ el worker no se declara disponible aunque esté encendido.
   * Mismo trato que `SEMANTIC_ANALYSIS_PROVIDER`: es preferible una pantalla
   * que lo explica a una cola de errores.
   *
   * `fake` sintetiza un MP3 determinista sin salir a la red y sin coste. Sirve
   * para recorrer la pantalla y para las pruebas; está PROHIBIDO en producción
   * más abajo, porque un audio de prueba servido a una persona real es peor
   * que no servir ninguno.
   */
  AUDIO_TTS_PROVIDER: z.enum(['disabled', 'fake', 'elevenlabs']).default('disabled'),
  /*
   * Permiso para generar audio NUEVO durante la operación.
   *
   * Apagado, el worker sólo sirve lo que ya está en caché. No es lo mismo que
   * apagar el worker: un despliegue puede querer servir su catálogo ya
   * locutado sin que nadie pueda encargar síntesis nuevas —y por tanto sin
   * que nadie pueda gastar—.
   */
  AUDIO_TTS_ALLOW_RUNTIME_GENERATION: booleanFromString.default(false),
  /*
   * Confirmación EXPLÍCITA de que hay licencia de uso de la voz en producción.
   *
   * Se conserva del paquete original y por su mismo motivo: la voz sintética
   * de un proveedor se licencia, y usarla en producción sin haberlo mirado es
   * una decisión legal que nadie debe tomar heredando un valor por omisión.
   */
  AUDIO_TTS_PROD_LICENSE_CONFIRMED: booleanFromString.default(false),

  AUDIO_TTS_DEFAULT_LANGUAGE: z.string().min(2).max(20).default('es-419'),
  AUDIO_TTS_DEFAULT_FORMAT: z.string().min(3).max(64).default('mp3_44100_128'),
  AUDIO_TTS_SAMPLE_RATE: z.coerce.number().int().min(8_000).max(192_000).default(44_100),
  AUDIO_TTS_VOICE_PROFILE: z.string().min(1).max(100).default('brand_es_latam_v1'),
  AUDIO_TTS_VOICE_VERSION: z.coerce.number().int().min(1).max(100_000).default(1),
  AUDIO_TTS_MODEL: z.string().min(1).max(128).default('eleven_v3'),
  AUDIO_TTS_GLOBAL_FALLBACK_TEMPLATE: z
    .string()
    .min(1)
    .max(160)
    .default('onboarding.fallback.generic'),
  AUDIO_TTS_MAX_TEXT_LENGTH: z.coerce.number().int().min(16).max(20_000).default(5_000),

  // Presupuesto. Un 0 en el límite por actor significa BLOQUEADO, no
  // ilimitado: un valor por omisión inseguro nunca debe abrir la puerta.
  AUDIO_TTS_MONTHLY_BUDGET_UNITS: z.coerce.number().int().min(0).max(1_000_000_000).default(10_000),
  AUDIO_TTS_SAFETY_RESERVE_UNITS: z.coerce.number().int().min(0).max(1_000_000_000).default(1_000),
  AUDIO_TTS_RUNTIME_GENERATIONS_PER_ACTOR_DAY: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(3),
  AUDIO_TTS_ACTOR_LIMIT_UNLIMITED: booleanFromString.default(false),

  // Red y resiliencia frente al proveedor.
  AUDIO_TTS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  AUDIO_TTS_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1_024)
    .max(268_435_456)
    .default(10_485_760),
  AUDIO_TTS_MIN_RESPONSE_BYTES: z.coerce.number().int().min(16).max(1_048_576).default(256),
  AUDIO_TTS_HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(0),
  AUDIO_TTS_RETRY_BASE_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  AUDIO_TTS_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  AUDIO_TTS_MAX_REQUESTS_PER_SECOND: z.coerce.number().positive().max(100).default(2),
  AUDIO_TTS_REPLICA_COUNT: z.coerce.number().int().min(1).max(512).default(1),
  AUDIO_TTS_BULKHEAD_QUEUE_SIZE: z.coerce.number().int().min(0).max(1_024).default(16),
  AUDIO_TTS_BULKHEAD_WAIT_MS: z.coerce.number().int().min(0).max(120_000).default(15_000),
  AUDIO_TTS_CB_FAILURE_THRESHOLD: z.coerce.number().int().min(2).max(50).default(5),
  AUDIO_TTS_CB_OPEN_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

  /*
   * Cifrado del texto locutado. El texto lleva dentro las variables —el nombre
   * de una persona en la plantilla dinámica— y su única copia vive en la
   * caché, así que se guarda cifrado con AES-256-GCM. Vacío sólo se tolera con
   * el worker apagado; ver la comprobación cruzada.
   */
  AUDIO_TTS_DATA_KEY: z.string().default(''),
  AUDIO_TTS_DATA_KEY_ID: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/u)
    .default('k1'),
  /** `id:secreto[,id:secreto]` — claves anteriores, para descifrar durante una rotación. */
  AUDIO_TTS_DATA_KEYS_PREVIOUS: z.string().default(''),

  ELEVENLABS_API_KEY: z.string().default(''),
  ELEVENLABS_BASE_URL: z.string().url().default('https://api.elevenlabs.io'),
  ELEVENLABS_VOICE_ID: z.string().default(''),
  ELEVENLABS_MODEL_ID: z.string().default(''),
  ELEVENLABS_OUTPUT_FORMAT: z.string().default(''),
  /*
   * Los `voice_settings` del proveedor: CÓMO habla la voz elegida.
   *
   * Por omisión, los valores documentados por ElevenLabs. Cablear el control
   * no cambia por sorpresa cómo suena la marca; sólo permite cambiarlo, que
   * hasta ahora no se podía ni tocando el `.env`. `stability` es la palanca
   * contra la locución plana —bajarla da más entonación— y los cuatro entran
   * en la clave de caché, así que ajustarlos regenera el audio en vez de
   * seguir sirviendo el de antes.
   */
  ELEVENLABS_VOICE_STABILITY: z.coerce.number().min(0).max(1).default(0.5),
  ELEVENLABS_VOICE_SIMILARITY_BOOST: z.coerce.number().min(0).max(1).default(0.75),
  ELEVENLABS_VOICE_STYLE: z.coerce.number().min(0).max(1).default(0),
  ELEVENLABS_VOICE_SPEAKER_BOOST: booleanFromString.default(true),

  // Ciclo de vida del trabajo, con la misma forma que los otros tres workers.
  AUDIO_TTS_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
  AUDIO_TTS_WORKER_MAX_POLL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  AUDIO_TTS_RECOVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  // Más baja que la de los otros workers: lo que limita aquí no es la memoria
  // del motor sino las peticiones por segundo que admite el proveedor.
  AUDIO_TTS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  AUDIO_TTS_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  AUDIO_TTS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  // `database` guarda los bytes en la propia base, como el resto de workers
  // guarda su carga útil; `local` es el adaptador de disco del paquete, para
  // desarrollo. El adaptador S3 del paquete no se absorbió.
  AUDIO_STORAGE_DRIVER: z.enum(['database', 'local']).default('database'),
  AUDIO_LOCAL_STORAGE_PATH: z.string().min(1).default('.local/audio-assets'),
  /*
   * Generar por SEGMENTOS cacheados: los tramos fijos de una plantilla se
   * pagan al proveedor una vez, y una frase nueva sólo paga sus variables.
   * Apagado por omisión porque tiene un precio de calidad —la prosodia de
   * las costuras del audio cosido— y aceptarlo es una decisión, no un valor
   * de serie.
   */
  AUDIO_SEGMENT_CACHE_ENABLED: booleanFromString.default(false),
};

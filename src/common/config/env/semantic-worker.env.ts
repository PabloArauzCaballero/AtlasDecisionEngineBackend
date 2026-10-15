import { z } from 'zod';
import { booleanFromString, emptyAsUndefined } from './helpers';

export const semanticWorkerEnv = {
  // --- Workers adicionales (ADR-0026) -------------------------------------
  // Los dos vienen APAGADOS por defecto, al revés que los trabajos nativos: un
  // despliegue que se actualice no debe empezar a consumir cuota de un
  // proveedor de modelos ni a cargar `pdfjs-dist` sin que nadie lo haya pedido.
  SEMANTIC_ANALYSIS_WORKER_ENABLED: booleanFromString.default(false),
  SEMANTIC_ANALYSIS_WORKER_POLL_MS: z.coerce.number().int().min(50).max(10_000).default(500),
  SEMANTIC_ANALYSIS_WORKER_MAX_POLL_MS: z.coerce
    .number()
    .int()
    .min(500)
    .max(600_000)
    .default(30_000),
  SEMANTIC_ANALYSIS_RECOVERY_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(600_000)
    .default(30_000),
  SEMANTIC_ANALYSIS_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  SEMANTIC_ANALYSIS_LEASE_SECONDS: z.coerce.number().int().min(30).max(3_600).default(120),
  // Agotados los intentos la ejecución queda FAILED en vez de volver a la cola:
  // reintentar sin cota convierte un fallo permanente en gasto perpetuo.
  SEMANTIC_ANALYSIS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH: z.coerce.number().int().min(100).max(100_000).default(8_000),

  /*
   * Las dos garantías de que una glosa no se quede sin categoría. Encendidas
   * por defecto; se apagan sólo para medir al modelo por su cuenta.
   */
  SEMANTIC_ANALYSIS_RULE_FAST_PATH_ENABLED: booleanFromString.default(true),
  SEMANTIC_ANALYSIS_TIMEOUT_RESCUE_ENABLED: booleanFromString.default(true),
  // Vacío ⇒ el worker NO se registra, y lo dice en el log. Es preferible a
  // arrancar y fallar en cada job por falta de credenciales.
  /*
   * `cascade` es el modo recomendado con IA: el codificador LOCAL clasifica
   * primero y el LLM sólo entra cuando aquél no resuelve o tarda demasiado.
   * `litellm` a secas manda TODAS las glosas al gateway, que cuesta más y saca
   * más texto del perímetro; se conserva para medir al modelo por su cuenta.
   */
  SEMANTIC_ANALYSIS_PROVIDER: z
    .enum(['', 'openai', 'transformer', 'litellm', 'openrouter', 'cascade'])
    .default(''),
  /** Cuánto se espera al clasificador local antes de escalar al LLM. */
  SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: emptyAsUndefined(
    z.coerce.number().int().min(200).max(60_000).optional(),
  ),
  /**
   * Quién atiende el escalón remoto de la cascada: el gateway propio (por
   * omisión) o OpenRouter. El codificador local no cambia.
   */
  SEMANTIC_CASCADE_REMOTE_PROVIDER: emptyAsUndefined(z.enum(['litellm', 'openrouter']).optional()),
  /*
   * --- OpenRouter (SEMANTIC_ANALYSIS_PROVIDER=openrouter) ------------------
   *
   * El otro gateway. A diferencia de LiteLLM, aquí el motor SÍ nombra el modelo
   * físico (`openai/gpt-4.1-mini`): OpenRouter no tiene alias, tiene catálogo.
   * Es lo que permite elegir el modelo desde la configuración sin desplegar
   * nada — ni el motor ni un `config.yaml` aparte. La única credencial que
   * entra en este proceso es la de OpenRouter.
   */
  OPENROUTER_BASE_URL: emptyAsUndefined(z.url().optional()),
  OPENROUTER_API_KEY: emptyAsUndefined(z.string().trim().min(1).optional()),
  OPENROUTER_FAST_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  OPENROUTER_DEEP_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  OPENROUTER_TIMEOUT_MS: emptyAsUndefined(
    z.coerce.number().int().min(1_000).max(600_000).optional(),
  ),
  OPENROUTER_MAX_ATTEMPTS: emptyAsUndefined(z.coerce.number().int().min(1).max(10).optional()),
  OPENROUTER_MAX_OUTPUT_TOKENS: emptyAsUndefined(
    z.coerce.number().int().min(256).max(32_000).optional(),
  ),
  OPENROUTER_APP_URL: emptyAsUndefined(z.url().optional()),
  OPENROUTER_APP_TITLE: emptyAsUndefined(z.string().trim().min(1).max(80).optional()),
  /*
   * --- Gateway LiteLLM (SEMANTIC_ANALYSIS_PROVIDER=litellm) --------------
   *
   * El motor habla con UN endpoint compatible con OpenAI y pide ALIAS LÓGICOS;
   * qué modelo físico los atiende lo decide `infra/litellm/config.yaml`, que es
   * lo que permite cambiar de proveedor —o añadirle un suplente— sin desplegar
   * el motor. La única credencial que entra en este proceso es la del gateway:
   * las de OpenAI, Anthropic o Vertex viven en el contenedor de LiteLLM.
   */
  LITELLM_BASE_URL: emptyAsUndefined(z.url().optional()),
  LITELLM_API_KEY: emptyAsUndefined(z.string().trim().min(1).optional()),
  LITELLM_FAST_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  LITELLM_DEEP_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  LITELLM_EMBEDDING_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  LITELLM_TIMEOUT_MS: emptyAsUndefined(z.coerce.number().int().min(1_000).max(600_000).optional()),
  LITELLM_MAX_ATTEMPTS: emptyAsUndefined(z.coerce.number().int().min(1).max(10).optional()),
  LITELLM_MAX_OUTPUT_TOKENS: emptyAsUndefined(
    z.coerce.number().int().min(256).max(32_000).optional(),
  ),
  /**
   * Reconocimiento explícito de que el texto analizado SALE del país.
   *
   * El proveedor `openai` envía a `api.openai.com` el texto que se le pide clasificar, y ese
   * texto viene de extractos y descripciones de movimientos: dato personal. Eso es una
   * transferencia internacional, con obligaciones propias —LGPD art. 33 y las cláusulas
   * estándar de la Res. CD/ANPD 19/2024; y, para una institución financiera brasileña, la
   * notificación previa a BACEN que exige la Res. 4.658 arts. 11-15 para procesar datos en
   * el exterior—.
   *
   * Se exige el reconocimiento en producción por el mismo motivo que `SCRIPT_RUNNER_MODE`
   * no admite el runner en proceso: es una decisión con consecuencia legal que nadie debe
   * tomar por omisión, heredando un valor por defecto. Fuera de producción no estorba.
   */
  SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: booleanFromString.default(false),
  SEMANTIC_ANALYSIS_BUDGET_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(3_600),
  SEMANTIC_ANALYSIS_BUDGET_MAX_ANALYSES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(1_000),
  // --- Retención del texto analizado ---
  // El texto que se clasifica se persiste íntegro para poder explicar la
  // decisión, y en el caso de un proveedor alojado ya salió del perímetro una
  // vez. Retenerlo indefinidamente añade una segunda copia permanente que
  // nadie pidió, así que la barrida lo minimiza (lo sustituye por su huella) y
  // más tarde purga la fila entera.
  SEMANTIC_ANALYSIS_MINIMIZE_AFTER_DAYS: z.coerce.number().int().min(0).max(3_650).default(30),
  SEMANTIC_ANALYSIS_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3_650).default(90),
  SEMANTIC_ANALYSIS_RETENTION_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(86_400_000)
    .default(3_600_000),
};

/**
 * Configuración del worker, validada al arrancar (§38).
 *
 * Se lee de `process.env` y NO del `ConfigService` del anfitrión, por un motivo que costaría
 * horas descubrir de otro modo: el esquema de entorno del motor es un `z.object`, y un
 * `z.object` DESCARTA las claves que no declara. Todas las `PDF_*` sobrevivirían a la
 * validación y desaparecerían del `ConfigService`, así que `config.get('PDF_RENDERER')`
 * devolvería `undefined` y el worker arrancaría entero con valores por defecto sin que nada
 * lo dijera.
 *
 * Leer el entorno directamente tiene además la propiedad que hace falta aquí: el worker
 * arranca igual dentro del motor que como proceso suelto, sin que el anfitrión tenga que
 * conocer ni una sola de sus variables.
 */
import { z } from 'zod';
import { PAGE_FORMATS } from '../../domain/enums/document.enums';
import { LETTERHEAD_MODES } from '../../domain/enums/document.enums';

const boolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí'].includes(normalized)) return true;
  if (['false', '0', 'no', ''].includes(normalized)) return false;
  return value;
}, z.boolean());

const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const pdfWorkerEnvSchema = z
  .object({
    // --- Selección de proveedores (§4, §5) ---
    PDF_RENDERER: z.enum(['playwright']).default('playwright'),
    PDF_TEMPLATE_ENGINE: z.enum(['handlebars']).default('handlebars'),

    // --- Concurrencia y plazos (§36) ---
    PDF_RENDER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    PDF_RENDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    PDF_RENDER_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
    PDF_MAX_DOCUMENT_BYTES: z.coerce.number().int().min(1_024).max(268_435_456).default(20_971_520),

    // --- Navegador ---
    PDF_BROWSER_HEADLESS: boolean.default(true),
    PDF_BROWSER_EXECUTABLE_PATH: optionalText,
    /**
     * JavaScript DENTRO de la página, apagado por defecto (§24).
     *
     * Ninguna plantilla lo necesita. Encenderlo sólo tiene sentido para un documento que dibuje
     * gráficos en cliente, y a cambio devuelve al payload una vía de ejecución que el escapado
     * de Handlebars es lo único que separa de él.
     */
    PDF_BROWSER_JAVASCRIPT: boolean.default(false),

    // --- Rutas ---
    PDF_TEMPLATE_PATH: optionalText,
    PDF_ASSETS_PATH: optionalText,
    PDF_FONTS_PATH: optionalText,

    // --- Almacenamiento (§39) ---
    PDF_STORAGE_ENABLED: boolean.default(false),
    PDF_STORAGE_PROVIDER: z.enum(['local', 'memory']).default('local'),
    PDF_STORAGE_PATH: z.string().trim().min(1).default('./var/pdf-worker'),
    PDF_PERSIST_BY_DEFAULT: boolean.default(false),

    // --- Idempotencia (§31) ---
    PDF_IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(86_400),
    PDF_IDEMPOTENCY_LEASE_SECONDS: z.coerce.number().int().min(5).max(3_600).default(120),

    // --- Cola (§17, §40) ---
    PDF_QUEUE_ENABLED: boolean.default(false),
    PDF_QUEUE_CAPACITY: z.coerce.number().int().min(1).max(10_000).default(200),

    // ---------------------------------------------------------------------
    // Autenticación del servicio, sólo cuando el worker corre SUELTO.
    //
    // ENCENDIDA por omisión, al revés que la administración de templates de más abajo. La
    // diferencia no es un descuido: aquélla es una capacidad que la mayoría de los despliegues
    // no usa, y ésta es el suelo. Un valor por omisión inseguro sólo protege a quien lee la
    // documentación entera, y un `docker-compose` no es documentación.
    //
    // Montado DENTRO del motor esto no se registra: allí autentica su `APP_GUARD`, y exigir
    // además una clave de servicio obligaría al motor a mandarse una credencial a sí mismo.
    // ---------------------------------------------------------------------
    PDF_SERVICE_AUTH_ENABLED: boolean.default(true),
    /**
     * Clave de servicio. Se compara en tiempo constante.
     *
     * Mínimo 32 caracteres —más que la de administración, porque ésta protege TODA la
     * superficie— y sin valor por omisión: una clave por omisión es una clave pública.
     */
    PDF_SERVICE_API_KEY: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    PDF_SERVICE_HEADER: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{2,40}$/)
      .default('x-pdf-service-key'),

    // ---------------------------------------------------------------------
    // Administración de templates por API.
    //
    // APAGADA por omisión, y no por prudencia genérica: es la ÚNICA superficie del worker que
    // acepta plantillas del exterior. Un despliegue que no publica templates por API no tiene
    // por qué exponerla, y con esto apagado la ruta responde 404 —no 403—, que es lo que
    // corresponde a algo que para el mundo no existe.
    // ---------------------------------------------------------------------
    PDF_TEMPLATE_ADMIN_ENABLED: boolean.default(false),
    /**
     * Clave de administración. Se compara en tiempo constante.
     *
     * Mínimo 24 caracteres y sin valor por omisión: una clave por omisión es una clave pública,
     * y el arranque la exige sólo si la administración está encendida (ver el `superRefine`).
     */
    PDF_TEMPLATE_ADMIN_KEY: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value === '' ? undefined : value)),
    PDF_TEMPLATE_ADMIN_HEADER: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{2,40}$/)
      .default('x-pdf-admin-key'),
    /** Dónde se guardan los templates publicados por API. Debe ser un volumen persistente. */
    PDF_CUSTOM_TEMPLATE_PATH: z.string().trim().min(1).default('./var/pdf-worker/templates'),

    // --- Presentación por defecto ---
    PDF_DEFAULT_FORMAT: z.enum(PAGE_FORMATS).default('A4'),
    PDF_DEFAULT_LOCALE: z.string().trim().min(2).max(20).default('es-BO'),
    PDF_DEFAULT_TIMEZONE: z.string().trim().min(2).max(60).default('America/La_Paz'),

    // --- Membrete e identidad visual (§11, §12) ---
    PDF_BRAND_ID: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,40}$/)
      .default('atlas'),
    PDF_BRAND_NAME: z.string().trim().min(1).max(120).default('ATLAS Decision Engine'),
    PDF_ORG_NAME: z.string().trim().min(1).max(160).default('ATLAS Decision Engine'),
    PDF_ORG_LEGAL_NAME: optionalText,
    PDF_ORG_TAX_ID: optionalText,
    PDF_ORG_ADDRESS: optionalText,
    PDF_ORG_PHONE: optionalText,
    PDF_ORG_EMAIL: optionalText,
    PDF_ORG_WEBSITE: optionalText,
    PDF_ORG_SECONDARY_TEXT: optionalText,
    /** Referencia de recurso (`asset:nombre.svg`), nunca una URL: la resolución las rechaza. */
    PDF_ORG_LOGO: optionalText,
    PDF_LETTERHEAD_MODE: z.enum(LETTERHEAD_MODES).default('every-page'),
    PDF_FOOTER_TEXT: optionalText,
    PDF_BRAND_ACCENT: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#1d4ed8'),
  })
  .superRefine((value, ctx) => {
    // Nótese que la clave de SERVICIO no se exige aquí, y no por descuido: este esquema lo
    // carga también `PdfWorkerModule.register()` cuando el módulo va DENTRO del motor, donde no
    // hay clave de servicio ninguna porque autentica el anfitrión. Exigirla aquí impediría
    // arrancar el motor entero por una credencial que nunca iba a usar. La exigencia vive en
    // `assertServiceAuthConfigured()`, que sólo se invoca en modo suelto.
    //
    // Encender la administración sin clave dejaría abierta la única ruta que acepta plantillas
    // del exterior. Se aborta el ARRANQUE: descubrirlo con la primera publicación anónima sería
    // descubrirlo tarde.
    if (value.PDF_TEMPLATE_ADMIN_ENABLED && (value.PDF_TEMPLATE_ADMIN_KEY ?? '').length < 24) {
      ctx.addIssue({
        code: 'custom',
        path: ['PDF_TEMPLATE_ADMIN_KEY'],
        message:
          'Con PDF_TEMPLATE_ADMIN_ENABLED=true hace falta una clave de al menos 24 caracteres.',
      });
    }
  });

export type PdfWorkerEnv = z.infer<typeof pdfWorkerEnvSchema>;

/**
 * Valida el entorno o aborta con TODOS los problemas a la vez.
 *
 * De uno en uno, corregir cinco variables cuesta cinco reinicios del contenedor. El mensaje
 * lleva la variable y la regla, nunca el valor: `PDF_ORG_EMAIL` es dato de contacto y estas
 * líneas acaban en el registro de arranque.
 */
export function loadPdfWorkerEnv(source: NodeJS.ProcessEnv = process.env): PdfWorkerEnv {
  const parsed = pdfWorkerEnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((issue) => `  · ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Configuración del PDF worker inválida:\n${detail}`);
}

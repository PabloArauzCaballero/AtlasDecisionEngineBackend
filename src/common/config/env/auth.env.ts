import { z } from 'zod';
import { booleanFromString, emptyAsUndefined, optionalUrl, optionalSecret } from './helpers';

export const authEnv = {
  AUTH_MODE: z
    .enum(['API_KEY', 'JWT', 'HYBRID', 'IDENTITY_PROVIDER', 'IDENTITY_HYBRID'])
    .default('API_KEY'),
  MANAGEMENT_API_KEY: optionalSecret,
  RUNTIME_API_KEY: optionalSecret,
  JWT_JWKS_URL: optionalUrl,
  JWT_ISSUER: z.string().max(500).optional().or(z.literal('')),
  JWT_MANAGEMENT_AUDIENCE: z.string().max(200).default('atlas-decision-management'),
  JWT_RUNTIME_AUDIENCE: z.string().max(200).default('atlas-decision-runtime'),
  JWT_TENANT_CLAIM: z.string().max(120).default('tenant_id'),
  JWT_ROLES_CLAIM: z.string().max(120).default('roles'),
  JWT_JWKS_CACHE_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),
  JWT_JWKS_TIMEOUT_MS: z.coerce.number().int().min(250).max(15_000).default(3_000),
  JWT_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  IDENTITY_PROVIDER_URL: optionalUrl,
  IDENTITY_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(250).max(15_000).default(3_000),
  /*
   * Login gets its own, longer budget because it does more work than a read: it hashes the
   * password and, with the second factor on, issues a PIN and hands it to the mail channel.
   * Measured against the local provider, that takes ~4,7 s — above the 3 s used for every
   * other call — so login timed out on the caller's side while the provider was finishing
   * the job. What the operator saw was two PIN mails, the first one already dead.
   */
  IDENTITY_PROVIDER_LOGIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30_000)
    .default(12_000),
  // Retries only for transient failures (connection refused / 502-503-504), never for a
  // rejected credential and never for a timeout, which does not prove the request failed to
  // arrive. Shields login from the brief window where the provider dev server is restarting
  // (build-and-watch). 0 disables retries.
  IDENTITY_PROVIDER_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(2),
  IDENTITY_PROVIDER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(5_000).default(300),
  /*
   * How long a verified access token is trusted without asking the provider again.
   *
   * Every protected request used to call `/internal/auth/me`, so one screen that
   * fires a dozen requests fired a dozen validations. Under any real burst — the
   * portal classifying a bank statement, a route sweep — the provider hit its
   * timeout and the engine answered 503 on random requests, which the portal
   * showed as features failing for no reason.
   *
   * The window is deliberately small because it is also the revocation lag: a
   * disabled account, or a role that was taken away, keeps working for at most
   * this long. Ten seconds removes the stampede while keeping that lag shorter
   * than a person can act on. 0 disables the cache and restores per-request
   * validation.
   */
  /*
   * Umbrales de la bandeja de valores sin clasificar (ADR de clasificación
   * no resuelta). No se fijan en el código porque «suficiente confianza»
   * depende de lo que cueste equivocarse, y eso lo decide quien opera el
   * motor: en una cartera de consumo un 0,85 puede bastar; en una de crédito
   * corporativo, no.
   *
   * Por encima de HIGH el motor PODRIA resolver solo, y sólo si
   * AUTO_RESOLVE_ENABLED lo permite: la política por defecto es que no, porque
   * clasificar sin que nadie lo mire es justo lo que este mecanismo evita.
   * Entre MEDIUM y HIGH se muestra la recomendación; por debajo se pide
   * clasificación manual.
   */
  UNRESOLVED_HIGH_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.9),
  UNRESOLVED_MEDIUM_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  /*
   * Confianza mínima para que la REEVALUACIÓN cierre un pendiente sin que nadie
   * mire. Por debajo de HIGH a propósito: una decisión por regla de instrumento
   * —traspaso, QR, retiro de efectivo— es determinista y no necesita el listón
   * que se le pide a una similitud. Los cajones «Otros» no se cierran nunca,
   * sea cual sea este valor: son justo los que necesitan a una persona.
   */
  UNRESOLVED_AUTO_CLOSE_FLOOR: z.coerce.number().min(0).max(1).default(0.75),
  UNRESOLVED_AUTO_RESOLVE_ENABLED: booleanFromString.default(false),
  IDENTITY_PROVIDER_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(300).default(10),
  IDENTITY_REFRESH_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{3,80}$/)
    .default('atlas_refresh'),
  IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(7_776_000)
    .default(2_592_000),
  IDENTITY_SESSION_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),
  // MOT-08: absolute lifetime of a portal session, counted from sign-in. A refresh never extends it.
  IDENTITY_SESSION_ABSOLUTE_MAX_HOURS: z.coerce.number().min(1).max(168).default(12),
  // Signs the session start inside the refresh cookie. Optional: derived from AUDIT_HASH_SECRET when unset.
  IDENTITY_SESSION_SIGNING_SECRET: emptyAsUndefined(z.string().min(32).optional()),
};

import { z } from 'zod';

const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return value;
}, z.boolean());

const optionalUrl = z.string().url().optional().or(z.literal(''));
const optionalSecret = z.string().min(24).optional().or(z.literal(''));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    BUILD_VERSION: z.string().max(80).default('2.0.0'),
    COMMIT_SHA: z.string().max(80).default('local'),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(15),
    DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

    REDIS_URL: optionalUrl,
    REDIS_PREFIX: z.string().regex(/^[a-zA-Z0-9:_-]{1,80}$/).default('atlas:decision'),
    REQUIRE_REDIS_IN_PRODUCTION: booleanFromString.default(true),

    AUTH_MODE: z.enum(['API_KEY', 'JWT', 'HYBRID', 'IDENTITY_PROVIDER', 'IDENTITY_HYBRID']).default('API_KEY'),
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
    IDENTITY_REFRESH_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/).default('atlas_refresh'),
    IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS: z.coerce.number().int().min(300).max(7_776_000).default(2_592_000),
    IDENTITY_SESSION_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),

    CORS_ALLOWED_ORIGINS: z.string().default(''),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(1_048_576),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
    SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),

    RATE_LIMIT_ENABLED: booleanFromString.default(true),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
    RATE_LIMIT_MANAGEMENT_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(300),
    RATE_LIMIT_RUNTIME_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(1_500),
    AUTH_FAILURE_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(20),

    SWAGGER_ENABLED: booleanFromString.default(false),
    METRICS_ENABLED: booleanFromString.default(true),
    METRICS_TOKEN: optionalSecret,
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    LOG_FILE_PATH: z.string().min(1).default('logs/atlas-decision-engine.log'),
    ACCESS_AUDIT_ENABLED: booleanFromString.default(true),

    VARIABLE_BACKEND_URL: optionalUrl,
    VARIABLE_BACKEND_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(1_500),
    AUDIT_HASH_SECRET: z.string().min(32),
    DEFAULT_ENVIRONMENT: z.string().regex(/^[A-Z0-9_-]{2,40}$/).default('PROD'),
    MAX_EXECUTION_STEPS: z.coerce.number().int().min(16).max(10_000).default(256),
    SCRIPT_NODES_ENABLED: booleanFromString.default(false),
    SCRIPT_RUNNER_MODE: z.enum(['IN_PROCESS', 'SIDECAR']).default('IN_PROCESS'),
    SCRIPT_RUNNER_SOCKET_PATH: z.string().min(1).default('/var/run/atlas-runner/runner.sock'),
    SCRIPT_NODE_TIMEOUT_MS: z.coerce.number().int().min(10).max(5_000).default(250),
    SCRIPT_NODE_MAX_SOURCE_BYTES: z.coerce.number().int().min(1).max(65_536).default(16_384),
    SCRIPT_NODE_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    MAX_PAGE_SIZE: z.coerce.number().int().min(10).max(500).default(100),
  })
  .superRefine((value, ctx) => {
    const requiresApiKeys = value.AUTH_MODE === 'API_KEY' || value.AUTH_MODE === 'HYBRID' || value.AUTH_MODE === 'IDENTITY_HYBRID';
    const requiresJwt = value.AUTH_MODE === 'JWT' || value.AUTH_MODE === 'HYBRID';
    const requiresIdentityProvider = value.AUTH_MODE === 'IDENTITY_PROVIDER' || value.AUTH_MODE === 'IDENTITY_HYBRID';

    if (requiresApiKeys) {
      if (!value.MANAGEMENT_API_KEY) {
        ctx.addIssue({ code: 'custom', path: ['MANAGEMENT_API_KEY'], message: 'Required for API_KEY or HYBRID authentication' });
      }
      if (!value.RUNTIME_API_KEY) {
        ctx.addIssue({ code: 'custom', path: ['RUNTIME_API_KEY'], message: 'Required for API_KEY or HYBRID authentication' });
      }
      if (value.MANAGEMENT_API_KEY && value.RUNTIME_API_KEY && value.MANAGEMENT_API_KEY === value.RUNTIME_API_KEY) {
        ctx.addIssue({ code: 'custom', path: ['RUNTIME_API_KEY'], message: 'Management and runtime API keys must be different' });
      }
    }

    if (requiresJwt) {
      if (!value.JWT_JWKS_URL) {
        ctx.addIssue({ code: 'custom', path: ['JWT_JWKS_URL'], message: 'Required for JWT or HYBRID authentication' });
      }
      if (!value.JWT_ISSUER) {
        ctx.addIssue({ code: 'custom', path: ['JWT_ISSUER'], message: 'Required for JWT or HYBRID authentication' });
      }
    }

    if (requiresIdentityProvider && !value.IDENTITY_PROVIDER_URL) {
      ctx.addIssue({ code: 'custom', path: ['IDENTITY_PROVIDER_URL'], message: 'Required for identity provider authentication' });
    }

    if (value.NODE_ENV === 'production') {
      if (value.SCRIPT_NODES_ENABLED && value.SCRIPT_RUNNER_MODE !== 'SIDECAR') {
        ctx.addIssue({
          code: 'custom',
          path: ['SCRIPT_NODES_ENABLED'],
          message:
            'The in-process script runner is not an OS security boundary and cannot be enabled in production. Set SCRIPT_RUNNER_MODE=SIDECAR and deploy the isolated runner container.',
        });
      }
      if (value.REQUIRE_REDIS_IN_PRODUCTION && !value.REDIS_URL) {
        ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'Redis is required in production' });
      }
      if (value.METRICS_ENABLED && !value.METRICS_TOKEN) {
        ctx.addIssue({ code: 'custom', path: ['METRICS_TOKEN'], message: 'A metrics token is required in production' });
      }
      if (value.AUTH_MODE === 'API_KEY') {
        ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'Production must use JWT, HYBRID or identity provider authentication' });
      }
      if (value.JWT_JWKS_URL && !value.JWT_JWKS_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['JWT_JWKS_URL'], message: 'JWKS URL must use HTTPS in production' });
      }
      if (value.IDENTITY_PROVIDER_URL && !value.IDENTITY_PROVIDER_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['IDENTITY_PROVIDER_URL'], message: 'Identity provider URL must use HTTPS in production' });
      }
      const forbiddenExamples: Array<[keyof AppEnv, string]> = [
        ['MANAGEMENT_API_KEY', 'change-me-management'],
        ['RUNTIME_API_KEY', 'change-me-runtime'],
        ['AUDIT_HASH_SECRET', 'replace-with-a-long-random-secret'],
        ['METRICS_TOKEN', 'change-me-metrics-token'],
      ];
      for (const [key, example] of forbiddenExamples) {
        if (value[key] === example) {
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} cannot use the example value in production` });
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnvironment(input: Record<string, unknown>): AppEnv {
  return envSchema.parse(input);
}

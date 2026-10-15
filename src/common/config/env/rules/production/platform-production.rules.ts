import type { RawEnv } from '../../env-object';
import type { EnvRule } from '../env-rule';

export const requireHardenedPlatformInProduction: EnvRule = (value, ctx) => {
  if (value.SCRIPT_NODES_ENABLED && value.SCRIPT_RUNNER_MODE !== 'SIDECAR') {
    ctx.addIssue({
      code: 'custom',
      path: ['SCRIPT_NODES_ENABLED'],
      message:
        'The in-process script runner is not an OS security boundary and cannot be enabled in production. Set SCRIPT_RUNNER_MODE=SIDECAR and deploy the isolated runner container.',
    });
  }
  if (value.REQUIRE_REDIS_IN_PRODUCTION && !value.REDIS_URL) {
    ctx.addIssue({
      code: 'custom',
      path: ['REDIS_URL'],
      message: 'Redis is required in production',
    });
  }
  if (value.METRICS_ENABLED && !value.METRICS_TOKEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['METRICS_TOKEN'],
      message: 'A metrics token is required in production',
    });
  }
  if (value.AUTH_MODE === 'API_KEY') {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_MODE'],
      message: 'Production must use JWT, HYBRID or identity provider authentication',
    });
  }
  if (value.JWT_JWKS_URL && !value.JWT_JWKS_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['JWT_JWKS_URL'],
      message: 'JWKS URL must use HTTPS in production',
    });
  }
  if (value.IDENTITY_PROVIDER_URL && !value.IDENTITY_PROVIDER_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDENTITY_PROVIDER_URL'],
      message: 'Identity provider URL must use HTTPS in production',
    });
  }
  if (value.VARIABLE_BACKEND_URL && !value.VARIABLE_BACKEND_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['VARIABLE_BACKEND_URL'],
      message: 'Variable backend URL must use HTTPS in production',
    });
  }
  if (value.SWAGGER_ENABLED) {
    ctx.addIssue({
      code: 'custom',
      path: ['SWAGGER_ENABLED'],
      message: 'Swagger must be disabled in production',
    });
  }
  if (value.LOG_LEVEL === 'debug' || value.LOG_LEVEL === 'verbose') {
    ctx.addIssue({
      code: 'custom',
      path: ['LOG_LEVEL'],
      message: 'LOG_LEVEL must not be debug or verbose in production',
    });
  }
  const forbiddenExamplePrefixes: Array<[keyof RawEnv, string]> = [
    ['MANAGEMENT_API_KEY', 'change-me-management'],
    ['RUNTIME_API_KEY', 'change-me-runtime'],
    ['AUDIT_HASH_SECRET', 'replace-with-a-long-random-secret'],
    ['METRICS_TOKEN', 'change-me-metrics-token'],
  ];
  for (const [key, examplePrefix] of forbiddenExamplePrefixes) {
    const configured = value[key];
    if (typeof configured === 'string' && configured.startsWith(examplePrefix)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} cannot use an example value in production`,
      });
    }
  }
};

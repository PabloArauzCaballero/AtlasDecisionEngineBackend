import { validateEnvironment } from '../src/common/config/env.schema';

const base = {
  DATABASE_URL: 'postgresql://atlas:atlas@localhost:5432/atlas_decision',
  REDIS_URL: 'redis://localhost:6379',
  MANAGEMENT_API_KEY: 'management-key-with-enough-entropy-123',
  RUNTIME_API_KEY: 'runtime-key-with-enough-entropy-456',
  AUDIT_HASH_SECRET: 'audit-secret-with-at-least-thirty-two-characters',
};

const jwtProduction = {
  ...base,
  NODE_ENV: 'production',
  AUTH_MODE: 'HYBRID',
  JWT_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
  JWT_ISSUER: 'https://identity.example.com/',
  METRICS_TOKEN: 'metrics-token-with-enough-entropy-789',
};

describe('environment validation', () => {
  it('accepts a secure production configuration', () => {
    const result = validateEnvironment(jwtProduction);
    expect(result.NODE_ENV).toBe('production');
    expect(result.AUTH_MODE).toBe('HYBRID');
  });

  it('accepts the external identity provider mode in production', () => {
    const result = validateEnvironment({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'IDENTITY_PROVIDER',
      IDENTITY_PROVIDER_URL: 'https://identity.example.com/api/v1',
      METRICS_TOKEN: 'metrics-token-with-enough-entropy-789',
    });
    expect(result.AUTH_MODE).toBe('IDENTITY_PROVIDER');
  });

  it('requires an HTTPS identity provider URL in production', () => {
    expect(() => validateEnvironment({
      ...base,
      NODE_ENV: 'production',
      AUTH_MODE: 'IDENTITY_PROVIDER',
      IDENTITY_PROVIDER_URL: 'http://identity.example.com/api/v1',
      METRICS_TOKEN: 'metrics-token-with-enough-entropy-789',
    })).toThrow();
  });

  it('rejects API key-only authentication in production', () => {
    expect(() => validateEnvironment({ ...jwtProduction, AUTH_MODE: 'API_KEY' })).toThrow();
  });

  it('requires JWKS and issuer for JWT authentication', () => {
    expect(() => validateEnvironment({ ...jwtProduction, JWT_JWKS_URL: '' })).toThrow();
    expect(() => validateEnvironment({ ...jwtProduction, JWT_ISSUER: '' })).toThrow();
  });

  it('rejects using the same management and runtime API key', () => {
    expect(() => validateEnvironment({
      ...jwtProduction,
      MANAGEMENT_API_KEY: 'shared-key-with-enough-entropy-12345',
      RUNTIME_API_KEY: 'shared-key-with-enough-entropy-12345',
    })).toThrow();
  });

  it('allows API key mode for local development', () => {
    const result = validateEnvironment({
      NODE_ENV: 'development',
      ...base,
      AUTH_MODE: 'API_KEY',
      METRICS_ENABLED: 'false',
    });
    expect(result.AUTH_MODE).toBe('API_KEY');
  });

  it('rejects invalid boolean strings instead of silently coercing them', () => {
    expect(() => validateEnvironment({
      NODE_ENV: 'development',
      ...base,
      REQUIRE_REDIS_IN_PRODUCTION: 'sometimes',
    })).toThrow();
  });

  it('rejects the in-process script runner in production', () => {
    expect(() => validateEnvironment({
      ...jwtProduction,
      SCRIPT_NODES_ENABLED: true,
    })).toThrow(/OS security boundary/);
    expect(() => validateEnvironment({
      ...jwtProduction,
      SCRIPT_NODES_ENABLED: true,
      SCRIPT_RUNNER_MODE: 'IN_PROCESS',
    })).toThrow(/OS security boundary/);
  });

  it('allows the isolated sidecar script runner in production', () => {
    const result = validateEnvironment({
      ...jwtProduction,
      SCRIPT_NODES_ENABLED: true,
      SCRIPT_RUNNER_MODE: 'SIDECAR',
      SCRIPT_RUNNER_SOCKET_PATH: '/var/run/atlas-runner/runner.sock',
    });
    expect(result.SCRIPT_RUNNER_MODE).toBe('SIDECAR');
  });

  it('leaves script nodes disabled and in-process by default', () => {
    const result = validateEnvironment({ NODE_ENV: 'development', ...base });
    expect(result.SCRIPT_NODES_ENABLED).toBe(false);
    expect(result.SCRIPT_RUNNER_MODE).toBe('IN_PROCESS');
  });
});

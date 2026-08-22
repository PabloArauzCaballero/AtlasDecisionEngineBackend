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

/**
 * Compose pasa las credenciales opcionales como `${VAR:-}`: cuando no están configuradas, el
 * contenedor recibe la CADENA VACÍA, no la ausencia de variable. Y `''` no es `undefined`, así que
 * un `.optional()` con `min(1)` al lado tumbaba el arranque de cualquier despliegue que no usara
 * el gateway — verificado en caliente, con la API entrando en bucle de reinicio.
 */
describe('variables opcionales que llegan vacías desde Docker', () => {
  const vacias = {
    LITELLM_API_KEY: '',
    LITELLM_BASE_URL: '',
    LITELLM_FAST_MODEL: '',
    LITELLM_DEEP_MODEL: '',
    LITELLM_EMBEDDING_MODEL: '',
    LITELLM_TIMEOUT_MS: '',
    LITELLM_MAX_ATTEMPTS: '',
    LITELLM_MAX_OUTPUT_TOKENS: '',
    SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: '',
  };

  it('un despliegue SIN gateway arranca aunque compose le pase las variables vacías', () => {
    expect(() => validateEnvironment({ ...base, ...vacias })).not.toThrow();
  });

  it('una variable vacía se lee como ausente, no como cadena vacía', () => {
    const result = validateEnvironment({ ...base, ...vacias });
    expect(result.LITELLM_API_KEY).toBeUndefined();
    expect(result.LITELLM_TIMEOUT_MS).toBeUndefined();
  });

  it('con un valor de verdad, se sigue validando igual', () => {
    expect(() => validateEnvironment({ ...base, LITELLM_TIMEOUT_MS: '5' })).toThrow(); // por debajo del mínimo de 1000 ms
    const ok = validateEnvironment({ ...base, LITELLM_TIMEOUT_MS: '5000' });
    expect(ok.LITELLM_TIMEOUT_MS).toBe(5000);
  });
});

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
    expect(() =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        AUTH_MODE: 'IDENTITY_PROVIDER',
        IDENTITY_PROVIDER_URL: 'http://identity.example.com/api/v1',
        METRICS_TOKEN: 'metrics-token-with-enough-entropy-789',
      }),
    ).toThrow();
  });

  it('rejects API key-only authentication in production', () => {
    expect(() => validateEnvironment({ ...jwtProduction, AUTH_MODE: 'API_KEY' })).toThrow();
  });

  it('requires JWKS and issuer for JWT authentication', () => {
    expect(() => validateEnvironment({ ...jwtProduction, JWT_JWKS_URL: '' })).toThrow();
    expect(() => validateEnvironment({ ...jwtProduction, JWT_ISSUER: '' })).toThrow();
  });

  it('rejects using the same management and runtime API key', () => {
    expect(() =>
      validateEnvironment({
        ...jwtProduction,
        MANAGEMENT_API_KEY: 'shared-key-with-enough-entropy-12345',
        RUNTIME_API_KEY: 'shared-key-with-enough-entropy-12345',
      }),
    ).toThrow();
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
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        ...base,
        REQUIRE_REDIS_IN_PRODUCTION: 'sometimes',
      }),
    ).toThrow();
  });

  it('validates retired audit keys during startup rather than during a chain verification', () => {
    expect(() =>
      validateEnvironment({ ...base, AUDIT_HASH_PREVIOUS_SECRETS: '["not-a-map"]' }),
    ).toThrow(/JSON object/);
    expect(() =>
      validateEnvironment({ ...base, AUDIT_HASH_PREVIOUS_SECRETS: '{"v0":"short"}' }),
    ).toThrow(/at least 32/);
    expect(
      validateEnvironment({
        ...base,
        AUDIT_HASH_PREVIOUS_SECRETS: JSON.stringify({
          v0: 'retired-audit-secret-with-at-least-thirty-two-characters',
        }),
      }).AUDIT_HASH_PREVIOUS_SECRETS,
    ).toContain('v0');
  });

  it('rejects the in-process script runner in production', () => {
    expect(() =>
      validateEnvironment({
        ...jwtProduction,
        SCRIPT_NODES_ENABLED: true,
      }),
    ).toThrow(/OS security boundary/);
    expect(() =>
      validateEnvironment({
        ...jwtProduction,
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_RUNNER_MODE: 'IN_PROCESS',
      }),
    ).toThrow(/OS security boundary/);
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

  it('rejects Swagger enabled in production', () => {
    expect(() => validateEnvironment({ ...jwtProduction, SWAGGER_ENABLED: 'true' })).toThrow();
  });

  it('rejects a debug log level in production', () => {
    expect(() => validateEnvironment({ ...jwtProduction, LOG_LEVEL: 'debug' })).toThrow();
    expect(() => validateEnvironment({ ...jwtProduction, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it.each([
    ['MANAGEMENT_API_KEY', 'change-me-management-with-at-least-24-characters'],
    ['RUNTIME_API_KEY', 'change-me-runtime-with-at-least-24-characters'],
    ['AUDIT_HASH_SECRET', 'replace-with-a-long-random-secret-at-least-32-characters'],
    ['METRICS_TOKEN', 'change-me-metrics-token-with-at-least-24-characters'],
  ])('rejects the complete example value for %s in production', (key, exampleValue) => {
    expect(() => validateEnvironment({ ...jwtProduction, [key]: exampleValue })).toThrow(
      /example value/,
    );
  });

  it('requires an HTTPS variable backend URL in production', () => {
    expect(() =>
      validateEnvironment({
        ...jwtProduction,
        VARIABLE_BACKEND_URL: 'http://variables.internal/api',
      }),
    ).toThrow();
    expect(
      validateEnvironment({
        ...jwtProduction,
        VARIABLE_BACKEND_URL: 'https://variables.internal/api',
      }).VARIABLE_BACKEND_URL,
    ).toBe('https://variables.internal/api');
  });
  /*
   * Locución con proveedor de pago.
   *
   * Estas guardas existen para que un despliegue mal configurado falle AL
   * ARRANCAR y no en cada locución: una cola de errores contra un proveedor que
   * cobra por petición es cara de descubrir y cara de parar.
   */
  describe('worker de locución', () => {
    const conVoz = {
      ...base,
      AUDIO_TTS_WORKER_ENABLED: 'true',
      AUDIO_TTS_PROVIDER: 'elevenlabs',
      AUDIO_TTS_DATA_KEY: 'clave-de-datos-con-al-menos-32-caracteres',
    };

    it('exige la credencial del proveedor', () => {
      expect(() => validateEnvironment(conVoz)).toThrow(/ELEVENLABS_API_KEY/);
    });

    it('exige la VOZ: elegirla es una decisión de marca, no un valor heredado', () => {
      expect(() =>
        validateEnvironment({ ...conVoz, ELEVENLABS_API_KEY: 'clave-de-proveedor' }),
      ).toThrow(/ELEVENLABS_VOICE_ID/);
    });

    it('acepta la configuración completa', () => {
      const resultado = validateEnvironment({
        ...conVoz,
        ELEVENLABS_API_KEY: 'clave-de-proveedor',
        ELEVENLABS_VOICE_ID: 'voz-de-la-marca',
      });
      expect(resultado.AUDIO_TTS_PROVIDER).toBe('elevenlabs');
    });

    /*
     * El texto locutado lleva dentro las variables —el nombre de una persona en
     * la plantilla dinámica— y su única copia vive en la caché. Sin clave no hay
     * dónde guardarlo cifrado.
     */
    it('exige la clave de cifrado del texto locutado', () => {
      expect(() =>
        validateEnvironment({
          ...conVoz,
          AUDIO_TTS_DATA_KEY: 'corta',
          ELEVENLABS_API_KEY: 'clave-de-proveedor',
          ELEVENLABS_VOICE_ID: 'voz-de-la-marca',
        }),
      ).toThrow(/AUDIO_TTS_DATA_KEY/);
    });

    // Un audio de prueba servido a una persona real es peor que no servir ninguno.
    it('prohíbe el proveedor simulado en producción', () => {
      expect(() =>
        validateEnvironment({
          ...jwtProduction,
          AUDIO_TTS_WORKER_ENABLED: 'true',
          AUDIO_TTS_PROVIDER: 'fake',
          AUDIO_TTS_DATA_KEY: 'clave-de-datos-con-al-menos-32-caracteres',
          AUDIO_TTS_PROD_LICENSE_CONFIRMED: 'true',
        }),
      ).toThrow(/AUDIO_TTS_PROVIDER/);
    });

    // Un arrendamiento más corto que la petición al proveedor deja que otra
    // réplica reclame el trabajo y se pague la misma locución dos veces.
    it('exige que el arrendamiento sobreviva a la petición más lenta', () => {
      expect(() =>
        validateEnvironment({
          ...base,
          AUDIO_TTS_LEASE_SECONDS: '30',
          AUDIO_TTS_REQUEST_TIMEOUT_MS: '60000',
        }),
      ).toThrow(/AUDIO_TTS_LEASE_SECONDS/);
    });
  });
});

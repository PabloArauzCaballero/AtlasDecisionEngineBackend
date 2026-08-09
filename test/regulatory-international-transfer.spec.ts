import { validateEnvironment } from '../src/common/config/env.schema';

/**
 * Transferencia internacional de datos personales.
 *
 * El proveedor semántico alojado envía a `api.openai.com` el texto que clasifica, y ese texto
 * sale de extractos y descripciones de movimientos. Es dato personal cruzando la frontera:
 * LGPD art. 33 con las cláusulas estándar de la Res. CD/ANPD 19/2024 y, para una institución
 * financiera brasileña, la notificación previa a BACEN que exige la Res. 4.658 arts. 11-15.
 *
 * Lo que se fija aquí es que **nadie transfiera por omisión**. La fábrica de proveedores usa
 * `openai` por defecto, así que sin esta guarda bastaba con encender el worker para empezar a
 * mandar datos fuera sin que ninguna persona lo hubiera decidido. Es el mismo criterio con el
 * que `SCRIPT_RUNNER_MODE` no admite el runner en proceso en producción.
 */
describe('Guarda de transferencia internacional', () => {
  /** Entorno de producción válido y mínimo, al que cada caso añade lo suyo. */
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://atlas_app:secret@localhost:5432/atlas',
    AUTH_MODE: 'JWT',
    JWT_JWKS_URL: 'https://idp.example.com/.well-known/jwks.json',
    JWT_ISSUER: 'https://idp.example.com/',
    REDIS_URL: 'redis://localhost:6379',
    METRICS_TOKEN: 'metrics-token-with-at-least-24-characters',
    AUDIT_HASH_SECRET: 'audit-secret-with-at-least-32-characters-long',
    SWAGGER_ENABLED: 'false',
  };

  const validate = (extra: Record<string, string>) =>
    (() => {
      try {
        validateEnvironment({ ...base, ...extra });
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

  it('bloquea el arranque si el worker sale al exterior sin declararlo', () => {
    const error = validate({ SEMANTIC_ANALYSIS_WORKER_ENABLED: 'true' });
    expect(error).toContain('SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER');
  });

  it('arranca cuando la transferencia se declara explícitamente', () => {
    expect(
      validate({
        SEMANTIC_ANALYSIS_WORKER_ENABLED: 'true',
        SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: 'true',
      }),
    ).toBeNull();
  });

  it('el proveedor local no necesita declaración: no sale del perímetro', () => {
    expect(
      validate({
        SEMANTIC_ANALYSIS_WORKER_ENABLED: 'true',
        SEMANTIC_ANALYSIS_PROVIDER: 'transformer',
      }),
    ).toBeNull();
  });

  it('con el worker apagado la guarda no estorba', () => {
    // El worker viene apagado de fábrica; exigir la declaración a quien no lo usa convertiría
    // un control en un trámite.
    expect(validate({ SEMANTIC_ANALYSIS_WORKER_ENABLED: 'false' })).toBeNull();
  });

  it('fuera de producción no se exige', () => {
    // En desarrollo el dato es sintético y el trámite no protege nada.
    expect(
      validate({ NODE_ENV: 'development', SEMANTIC_ANALYSIS_WORKER_ENABLED: 'true' }),
    ).toBeNull();
  });

  it('el valor por defecto es NO transferir', () => {
    const parsed = validateEnvironment({ ...base, NODE_ENV: 'development' }) as Record<
      string,
      unknown
    >;
    // Un interruptor de consecuencia legal no puede venir encendido.
    expect(parsed.SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER).toBe(false);
  });
});

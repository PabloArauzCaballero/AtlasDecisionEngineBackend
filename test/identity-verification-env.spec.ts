import { validateEnvironment } from '../src/common/config/env.schema';

/**
 * Lo que el worker de identidad NO puede dejar salir a producción.
 *
 * Estas guardas venían del paquete original y se perdieron al absorberlo. Sin
 * ellas, un despliegue que sólo encendiera el worker decidiría sobre la
 * identidad de personas reales con un comparador sintético, sin prueba de vida
 * y sin decir contra qué calibración decidió — y nada se lo impediría.
 *
 * Se comprueban sobre el esquema porque es donde fallan: al arrancar el
 * proceso, con un mensaje que se puede leer, y no en la primera verificación.
 *
 * Zod acumula TODOS los problemas en un solo error, así que cada prueba busca
 * su motivo dentro del mensaje agregado y comprueba además que desaparece
 * cuando la condición se satisface. Buscar sólo la presencia dejaría pasar una
 * guarda que nunca se apaga.
 */

const base = {
  DATABASE_URL: 'postgresql://atlas:atlas@localhost:5432/atlas_decision',
  REDIS_URL: 'redis://localhost:6379',
  MANAGEMENT_API_KEY: 'management-key-with-enough-entropy-123',
  RUNTIME_API_KEY: 'runtime-key-with-enough-entropy-456',
  AUDIT_HASH_SECRET: 'audit-secret-with-at-least-thirty-two-characters',
};

/** Producción con la autenticación en regla; lo demás lo decide cada prueba. */
const produccion = {
  ...base,
  NODE_ENV: 'production',
  AUTH_MODE: 'HYBRID',
  JWT_JWKS_URL: 'https://identity.example.com/.well-known/jwks.json',
  JWT_ISSUER: 'https://identity.example.com/',
  METRICS_TOKEN: 'metrics-token-with-enough-entropy-789',
};

/** El mensaje agregado de zod, para poder buscar motivos dentro. */
function motivos(env: Record<string, unknown>): string {
  try {
    validateEnvironment(env);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('guardas de producción del worker de identidad', () => {
  it('el worker APAGADO no impone ninguna de estas condiciones', () => {
    // Es lo que permite desplegar el resto del motor sin configurar nada de
    // esto: el precio se paga al encender el worker, no en cada despliegue.
    expect(() => validateEnvironment(produccion)).not.toThrow();
  });

  it('encenderlo en producción sin calibrar falla, y dice qué falta', () => {
    const salida = motivos({ ...produccion, IDENTITY_VERIFICATION_WORKER_ENABLED: 'true' });
    // Sin perfil calibrado, el veredicto no dice contra qué se decidió.
    expect(salida).toMatch(/IDENTITY_THRESHOLD_PROFILE_VERSION/);
  });

  it('rechaza en producción un perfil calibrado sobre rostros SINTÉTICOS', () => {
    /*
     * La guarda que sustituyó a la del comparador simulado. El comparador ya es
     * real, así que la pregunta dejó de ser «¿mira las imágenes?» y pasó a ser
     * «¿contra qué población se midió el corte?». Una población dibujada no
     * cubre el espacio de rasgos que cubren las personas: su tasa de falsas
     * aceptaciones no predice la de caras reales.
     */
    const salida = motivos({
      ...produccion,
      IDENTITY_VERIFICATION_WORKER_ENABLED: 'true',
      IDENTITY_THRESHOLD_PROFILE_VERSION: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
    });
    expect(salida).toMatch(/rostros sintéticos/i);
    expect(salida).toMatch(/calibrar:identidad/);
  });

  it('el aviso del perfil se apaga al nombrar una calibración real', () => {
    const salida = motivos({
      ...produccion,
      IDENTITY_VERIFICATION_WORKER_ENABLED: 'true',
      IDENTITY_THRESHOLD_PROFILE_VERSION: 'real-a1b2c3d4-40x4-fmr1e-3-fnmr1e-2',
    });
    expect(salida).not.toMatch(/IDENTITY_THRESHOLD_PROFILE_VERSION/);
    expect(salida).not.toMatch(/rostros sintéticos/i);
  });

  it('apagar la prueba de vida en producción exige aceptar el riesgo por escrito', () => {
    // Viene encendida por omisión desde que es real; apagarla es legítimo, pero
    // no en silencio: sin ella una foto impresa del documento junto a otra de su
    // titular pasa la comparación 1:1.
    const sinAceptar = motivos({
      ...produccion,
      IDENTITY_VERIFICATION_WORKER_ENABLED: 'true',
      IDENTITY_LIVENESS_ENABLED: 'false',
    });
    expect(sinAceptar).toMatch(/una foto impresa del documento/i);

    const aceptando = motivos({
      ...produccion,
      IDENTITY_VERIFICATION_WORKER_ENABLED: 'true',
      IDENTITY_LIVENESS_ENABLED: 'false',
      IDENTITY_ACCEPT_NO_LIVENESS_RISK: 'true',
    });
    expect(aceptando).not.toMatch(/una foto impresa del documento/i);
  });

  it('en desarrollo el worker se enciende con el perfil sintético', () => {
    // Es la topología que levanta docker-compose: proveedores reales y locales,
    // umbrales medidos sobre la población sintética del repositorio.
    expect(() =>
      validateEnvironment({
        ...base,
        IDENTITY_VERIFICATION_WORKER_ENABLED: 'true',
        IDENTITY_MATCH_THRESHOLD: '0.8824',
        IDENTITY_REVIEW_THRESHOLD: '0.7789',
        IDENTITY_THRESHOLD_PROFILE_VERSION: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
      }),
    ).not.toThrow();
  });
});

describe('coherencia de los umbrales, en cualquier entorno', () => {
  it('rechaza un umbral suelto', () => {
    // Con uno solo, el motor de decisión se comporta como si no hubiera ninguno
    // —todo a revisión— y quien lo configuró no entiende por qué.
    expect(() => validateEnvironment({ ...base, IDENTITY_MATCH_THRESHOLD: '0.9' })).toThrow(
      /se configuran juntos/i,
    );
    expect(() => validateEnvironment({ ...base, IDENTITY_REVIEW_THRESHOLD: '0.7' })).toThrow(
      /se configuran juntos/i,
    );
  });

  it('exige que el de revisión sea menor que el de coincidencia', () => {
    // Entre los dos está la franja ambigua que se manda a una persona; al revés
    // esa franja no existe.
    expect(() =>
      validateEnvironment({
        ...base,
        IDENTITY_MATCH_THRESHOLD: '0.7',
        IDENTITY_REVIEW_THRESHOLD: '0.9',
      }),
    ).toThrow(/MENOR que IDENTITY_MATCH_THRESHOLD/);
  });

  it('acepta el par bien puesto y lo entrega como número', () => {
    const resuelto = validateEnvironment({
      ...base,
      IDENTITY_MATCH_THRESHOLD: '0.8824',
      IDENTITY_REVIEW_THRESHOLD: '0.7789',
    });
    expect(resuelto.IDENTITY_MATCH_THRESHOLD).toBe(0.8824);
    expect(resuelto.IDENTITY_REVIEW_THRESHOLD).toBe(0.7789);
  });

  it('rechaza encender la prueba de vida con el proveedor deshabilitado', () => {
    // Es pedir una comprobación y apagarla a la vez: el resultado sería
    // `NOT_RUN` para siempre.
    expect(() =>
      validateEnvironment({
        ...base,
        IDENTITY_LIVENESS_ENABLED: 'true',
        IDENTITY_LIVENESS_PROVIDER: 'disabled',
      }),
    ).toThrow(/no puede ser «disabled»/);
  });

  it('exige que el corte de fallo de la prueba de vida sea menor que el de éxito', () => {
    // Al revés no deja franja de duda: deja una banda donde el mismo resultado
    // supera Y falla a la vez, y gana el que se evalúe primero.
    expect(() =>
      validateEnvironment({
        ...base,
        IDENTITY_LIVENESS_PASS_SCORE: '0.4',
        IDENTITY_LIVENESS_FAIL_SCORE: '0.6',
      }),
    ).toThrow(/MENOR que IDENTITY_LIVENESS_PASS_SCORE/);
  });
});

import { WorkersModule } from '../src/modules/workers/workers.module';
import type { TransformerIdentityOptions } from '../src/modules/workers/identity-verification/core/adapters/transformer-identity.adapter';
import {
  IDENTITY_DEFAULTS,
  IDENTITY_EMBEDDER_PORT,
} from '../src/modules/workers/identity-verification/core/identity-options';

/**
 * El codificador semántico de identidad recibe NÚMEROS, aunque el entorno traiga cadenas.
 *
 * Medido contra una cédula boliviana auténtica: el resultado traía
 * `pruebasAusentes: ['SEMANTIC:The "delay" argument must be of type number. Received type
 * string (\'15000\')']`. Ese mensaje es un `TypeError` de `AbortSignal.timeout`, no una
 * indisponibilidad del servidor de embeddings — así que un defecto de TIPOS se publicaba como
 * «no se pudo medir la conformidad semántica», que es una frase creíble y falsa.
 *
 * La causa: `SEMANTIC_TRANSFORMER_TIMEOUT_MS` no está en el esquema de entorno, así que llega
 * cruda, y `config.get<number>(…)` es un CAST de TypeScript, no una conversión. Esta prueba
 * lee el proveedor del módulo con un `ConfigService` que devuelve cadenas —como lo hace
 * `process.env`— y exige que lo construido sean números.
 */
type Factory = {
  provide: unknown;
  useFactory: (...args: unknown[]) => unknown;
};

function proveedorDelCodificador(): Factory {
  const providers = Reflect.getMetadata('providers', WorkersModule) as Factory[];
  const proveedor = providers.find((p) => p?.provide === IDENTITY_EMBEDDER_PORT);
  if (!proveedor) throw new Error('WorkersModule ya no declara IDENTITY_EMBEDDER_PORT');
  return proveedor;
}

describe('codificador semántico de identidad: coerción de la configuración', () => {
  const configDeCadenas = {
    get: (clave: string): unknown =>
      ({
        SEMANTIC_TRANSFORMER_TIMEOUT_MS: '15000',
        SEMANTIC_TRANSFORMER_MAX_ATTEMPTS: '3',
        SEMANTIC_TRANSFORMER_RETRY_BACKOFF_MS: '250',
      })[clave],
  };

  it('convierte los tres ajustes numéricos aunque el entorno los dé como cadenas', () => {
    const adaptador = proveedorDelCodificador().useFactory(configDeCadenas, {
      ...IDENTITY_DEFAULTS,
      fraudDetectionEnabled: true,
    }) as { options: TransformerIdentityOptions };

    expect(typeof adaptador.options.timeoutMs).toBe('number');
    expect(adaptador.options.timeoutMs).toBe(15_000);
    expect(adaptador.options.maxAttempts).toBe(3);
    expect(adaptador.options.retryBackoffMs).toBe(250);
  });

  it('un ajuste ilegible cae al valor por defecto en vez de propagar NaN', () => {
    const adaptador = proveedorDelCodificador().useFactory(
      {
        get: (clave: string): unknown =>
          clave === 'SEMANTIC_TRANSFORMER_TIMEOUT_MS' ? 'pronto' : undefined,
      },
      { ...IDENTITY_DEFAULTS, fraudDetectionEnabled: true },
    ) as { options: TransformerIdentityOptions };

    expect(adaptador.options.timeoutMs).toBe(15_000);
  });

  it('sin detección de fraude no hay codificador, y eso no es un fallo', () => {
    const adaptador = proveedorDelCodificador().useFactory(configDeCadenas, {
      ...IDENTITY_DEFAULTS,
      fraudDetectionEnabled: false,
    });

    expect(adaptador).toBeNull();
  });
});

import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { canonicalize } from '../src/common/crypto/canonical-json';
import { canSignAuditSeed, seedHashKeyId, seedHmac } from '../src/modules/seeding/data/audit-hash';

/**
 * La firma de la SIEMBRA y la firma del MOTOR tienen que ser la misma función.
 *
 * `HashService` es un proveedor de Nest y depende de `ConfigService`; la siembra corre
 * también por CLI (`prisma db seed`), donde no hay contenedor de inyección, así que
 * `audit-hash.ts` reproduce las mismas tres líneas. Dos implementaciones del hash que firma
 * la evidencia se separan en cuanto una cambia, y el síntoma no sería un error de
 * compilación: sería la pantalla de integridad del portal declarando ROTA una cadena que
 * nadie tocó. Esta prueba es lo que convierte esa divergencia en un fallo de la batería.
 */
const SECRETO = 'un-secreto-de-pruebas-suficientemente-largo-para-hmac';

function motor(env: Record<string, string>): HashService {
  return new HashService({
    get: (clave: string) => env[clave],
    getOrThrow: (clave: string) => {
      const valor = env[clave];
      if (valor === undefined) throw new Error(`Falta ${clave}`);
      return valor;
    },
  } as unknown as ConfigService);
}

describe('la firma de la siembra de auditoría', () => {
  const env = { AUDIT_HASH_SECRET: SECRETO, AUDIT_HASH_KEY_ID: 'v1' };

  it('coincide con HashService sobre una cadena ya canonicalizada', () => {
    // Es el caso REAL: tanto el motor como la siembra congelan el `canonicalPayload` y
    // firman esa cadena, no el objeto. Verificar rehashea justamente esa cadena.
    const canonico = canonicalize({
      tenantId: '1',
      eventType: 'DEPLOYMENT_ACTIVATED',
      aggregateType: 'DecisionDeployment',
      aggregateId: 'BNPL_CREDIT_DECISION@2.3.0@PROD',
      actorId: 'marco.tarifa@atlas.test',
      requestId: 'seed-bitacora-demo',
      payload: { environment: 'PROD', mode: 'FULL' },
      previousHash: null,
    });

    expect(seedHmac(canonico, env)).toBe(motor(env).hmacWithKey(canonico, 'v1'));
  });

  it('coincide también sobre objetos, que es donde la canonicalización podría separarse', () => {
    // Un objeto con las claves desordenadas y un número de precisión alta: si las dos
    // rutas no compartieran `canonicalize`, aquí es donde se notaría.
    const evento = { b: 2, a: { z: null, y: [3, 1] }, c: 0.10000000000000002 };
    expect(seedHmac(evento, env)).toBe(motor(env).hmacWithKey(evento, 'v1'));
  });

  it('usa el mismo identificador de clave que el motor, y `v1` por omisión', () => {
    expect(seedHashKeyId(env)).toBe(motor(env).activeHashKeyId());
    expect(seedHashKeyId({})).toBe('v1');
  });

  it('se niega a firmar sin secreto en vez de degradar a uno por omisión', () => {
    // Una cadena firmada con «changeme» verifica igual de bien y no prueba nada, que es
    // peor que no tener cadena: la pantalla la enseñaría en verde.
    expect(canSignAuditSeed({})).toBe(false);
    expect(canSignAuditSeed(env)).toBe(true);
    expect(() => seedHmac('lo que sea', {})).toThrow(/AUDIT_HASH_SECRET/);
  });
});

/**
 * Claves para los bloqueos consultivos de PostgreSQL.
 *
 * `pg_advisory_lock` tiene **un único espacio de claves de 64 bits para toda la base de
 * datos**: dos dominios que calculen el mismo número se serializan entre sí aunque no tengan
 * nada que ver. Y las tres familias de claves que usa este servicio se derivaban de
 * identificadores crudos que pueden coincidir:
 *
 *  - la cadena de auditoría usaba `tenantId` tal cual,
 *  - los despliegues, `(artifactId << 32) ^ environmentId` — del orden de 2^32 en adelante,
 *  - el sembrado, la constante `46262026`.
 *
 * Los identificadores de tenant de esta plataforma no son pequeños (el generador de pruebas
 * ya produce valores de 17 cifras), así que la coincidencia entre el espacio de auditoría y
 * el de despliegues es perfectamente alcanzable. El síntoma sería un misterio de rendimiento:
 * despliegues de un artefacto serializándose contra las decisiones de un tenant sin relación.
 *
 * Mezclar el dominio dentro de la clave elimina la coincidencia por construcción y, de paso,
 * deja escrito qué bloqueos existen y en qué orden deben tomarse.
 */
export enum AdvisoryLockDomain {
  /** Cadena de auditoría por tenant. Se toma SIEMPRE en último lugar dentro de una
   *  transacción, para que ningún otro bloqueo pueda quedar por debajo de él y abrir un
   *  ciclo de espera. */
  AuditChain = 1,
  /** Ventana de activación de un (artefacto, entorno). */
  Deployment = 2,
  /** Sembrado de datos de demostración, uno por base. */
  Seeding = 3,
}

const MASK_64 = (1n << 64n) - 1n;

/** Mezcla de avalancha de 64 bits (splitmix64): dispersa entradas contiguas y pequeñas. */
function mix(value: bigint): bigint {
  let z = value & MASK_64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (z ^ (z >> 31n)) & MASK_64;
}

/**
 * Clave de 64 bits con signo para `pg_advisory_xact_lock`, derivada del dominio y de los
 * identificadores que lo acotan.
 *
 * `BigInt.asIntN` al final porque el parámetro de Postgres es `bigint` con signo: sin la
 * conversión, un valor por encima de 2^63 desbordaría al enviarse.
 */
export function advisoryLockKey(domain: AdvisoryLockDomain, ...parts: bigint[]): bigint {
  let key = mix(BigInt(domain));
  for (const part of parts) {
    // Encadenar la mezcla hace que el orden de las partes importe: (artefacto, entorno) y
    // (entorno, artefacto) no pueden acabar en la misma clave.
    key = mix(key ^ mix(part));
  }
  return BigInt.asIntN(64, key);
}

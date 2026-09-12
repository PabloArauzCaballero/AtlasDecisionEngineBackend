import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * La conservación INDEFINIDA de las imágenes, convertida en algo que se rompe si alguien la cambia.
 *
 * Decisión de Pablo del 2026-09-11: las caras y las cédulas de los clientes se conservan sin plazo.
 * Hoy eso ya es el comportamiento —nada borra objetos del almacén— pero es un comportamiento por
 * AUSENCIA, y una ausencia no se defiende sola: el día que alguien añada un barrido de retención
 * «para que la cuenta no crezca», el borrado entrará sin que nadie recuerde la decisión, y la
 * evidencia sobre la que se decidió acerca de una persona desaparecerá en silencio.
 *
 * Así que esto fija la superficie: `remove()` del almacén sólo puede llamarse desde los DOS sitios
 * que limpian objetos huérfanos cuando una subida no llegó a crear su fila. Cualquier otro sitio
 * —un barrido, un job, un endpoint de borrado— hace fallar esta prueba, que es exactamente el
 * momento en que hay que hablarlo en vez de descubrirlo después.
 *
 * No prohíbe borrar para siempre: prohíbe borrar sin que nadie lo decida.
 */
const RAIZ = join(__dirname, '..', 'src');

/**
 * Los dos únicos sitios legítimos, y por qué.
 *
 * Los dos limpian lo que acaban de escribir cuando la fila no se pudo crear —huella duplicada o
 * error de la transacción—. Borran objetos que ninguna ejecución referencia, en el único momento en
 * que se sabe cuáles son; no tocan la evidencia de nada ya decidido.
 */
const PERMITIDOS = new Set([
  'modules/workers/identity-verification/identity-verification.service.ts',
  'modules/workers/bank-statement/bank-statement.service.ts',
]);

function ficherosTs(directorio: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...ficherosTs(ruta));
    else if (entrada.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

describe('las imágenes se conservan indefinidamente', () => {
  const ficheros = ficherosTs(RAIZ);

  it('sólo dos sitios pueden borrar del almacén, y son los que limpian huérfanos', () => {
    const conBorrado = ficheros
      .filter((ruta) => /(?:objectStorage|storage)\.remove\s*\(/.test(readFileSync(ruta, 'utf8')))
      .map((ruta) => ruta.slice(RAIZ.length + 1))
      .sort();

    expect(new Set(conBorrado)).toEqual(PERMITIDOS);
  });

  /*
   * El otro camino por el que la evidencia podría desaparecer sin que nadie lo decida: que el
   * barrido de retención del runtime empezara a tocar las tablas de los workers. Hoy purga una
   * sola, y esta prueba lo fija leyendo el servicio como texto —igual que el guardia de roles
   * apilados—, porque lo que importa es su ALCANCE, no el resultado de una consulta.
   */
  it('el barrido de retención sigue tocando sólo la idempotencia del runtime', () => {
    const fuente = readFileSync(join(RAIZ, 'modules/runtime/retention-sweeper.service.ts'), 'utf8');
    // Borra con SQL crudo, no por el cliente de Prisma, así que lo que hay que leer son los
    // `DELETE FROM`: es el alcance real del barrido.
    const tablasBorradas = [...fuente.matchAll(/DELETE\s+FROM\s+(\w+)/gi)].map((m) =>
      m[1].toLowerCase(),
    );

    expect([...new Set(tablasBorradas)]).toEqual(['decision_runtime_idempotency']);
    for (const prohibida of [
      'decision_identity_verification_run',
      'decision_bank_statement_run',
      'identityVerificationRun',
      'bankStatementRun',
      'objectStorage',
    ]) {
      expect(fuente).not.toContain(prohibida);
    }
  });

  it('las columnas de bytes SÍ se siguen vaciando: la copia duradera es la del almacén', () => {
    const pipeline = readFileSync(
      join(RAIZ, 'modules/workers/identity-verification/identity-run-worker.service.ts'),
      'utf8',
    );
    // Vaciar `*_bytes` al cerrar es la decisión de privacidad de esta tabla y no cambia: lo que
    // sobrevive es el objeto del almacén, con su huella en la fila.
    expect(pipeline).toContain('documentBytes: null');
    expect(pipeline).toContain('selfieBytes: null');
  });
});

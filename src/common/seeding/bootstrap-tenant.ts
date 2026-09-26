/**
 * A qué tenant pertenece lo que se siembra.
 *
 * Vivía en `modules/seeding/data/helpers.ts`, junto a los sembradores que ya no existen. Sobrevive
 * aparte porque no es un detalle de la siembra: `prisma/clean-test-data.ts` necesita resolver el
 * mismo tenant para saber qué puede borrar, y si los dos lo resolvieran por su cuenta acabarían
 * apuntando a tenants distintos —que es exactamente el fallo que documenta el comentario de abajo.
 */

/**
 * Tenant al que pertenece TODO lo que siembra este módulo.
 *
 * Era `1n` fijo, y `BOOTSTRAP_TENANT_ID` sólo lo honraba el sembrador de clientes de
 * integración. Con `BOOTSTRAP_TENANT_ID=7`, una instalación nueva terminaba con la API key
 * habilitada para el tenant 7 y el catálogo entero —variables, motivos, librerías, campos
 * calculados, categorías semánticas— en el 1: el único llamante registrado no veía nada, y
 * el motor rechazaba cualquier decisión por variable inexistente. Es el conjunto que sí
 * corre en producción, así que el desacuerdo se pagaba en la instalación real.
 *
 * `SEED_TENANT_ID` se acepta como sinónimo porque es el nombre que ya usaban los scripts
 * de desarrollo de `prisma/`. Dos nombres para el mismo tenant es como se llega a que
 * apunten a tenants distintos.
 */
export function resolveBootstrapTenantId(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = (env.BOOTSTRAP_TENANT_ID ?? env.SEED_TENANT_ID ?? '').trim();
  if (!raw) return 1n;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`El tenant de siembra ha de ser un entero positivo; se recibió '${raw}'`);
  }
  const tenantId = BigInt(raw);
  // El 0 pasa la expresión regular y no es un tenant: sembrar contra él deja el catálogo
  // en una fila que ninguna sesión reclama nunca.
  if (tenantId < 1n) {
    throw new Error(`El tenant de siembra ha de ser >= 1; se recibió '${raw}'`);
  }
  return tenantId;
}

/**
 * Escapa un texto de búsqueda para usarlo dentro de `contains` de Prisma (`ILIKE '%…%'`).
 *
 * Prisma NO escapa `%`, `_` ni `\` en `contains`: los pasa tal cual al patrón, y en `ILIKE` son
 * comodines. Buscar «100%» casaba con «100» seguido de cualquier cosa y buscar `A_C` casaba con
 * «ABC»; peor, un `%` solo devolvía TODAS las filas. Se midió contra Postgres 16 (la prueba de
 * contrato del puerto de auditoría falla sin esto). Postgres usa la barra invertida como carácter
 * de escape por omisión, así que basta con anteponerla a los tres.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

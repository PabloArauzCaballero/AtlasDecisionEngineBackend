/**
 * Por qué existe en un backend que usa Prisma.
 *
 * Las plantillas etiquetadas de Prisma (`$queryRaw`) parametrizan lo interpolado, así que por
 * ahí no entra nada. La **consola SQL interna** es otra cosa: `query-executor.service.ts`
 * ejecuta con `$queryRawUnsafe` el texto que un operador escribe, y ese texto es literalmente
 * `db.query.text`. Una consulta tan normal como `WHERE documento = '7712345'` publicaría un
 * documento de identidad en el backend de trazas, que no cifra, no filtra por inquilino y no
 * audita quién lo consulta.
 *
 * Medido en AtlasBackend, que comparte el problema por otra vía (Sequelize incrusta literales):
 * una petición de login publicaba el hash del identificador de quien intentaba entrar.
 *
 * Se conserva la FORMA de la sentencia (operación, tablas, columnas, nombres de parámetro),
 * que es lo que sirve para diagnosticar, y se descarta el contenido.
 */

/** Tope del texto publicado. Una sentencia enorme no diagnostica mejor y sí cuesta en cada span. */
export const MAX_STATEMENT_LENGTH = 1024;

const TRUNCATION_MARK = '…[recortado]';

/**
 * Sustituye todo literal de cadena por `'?'` y recorta.
 *
 * Los literales NUMÉRICOS se conservan a propósito: son límites, versiones e identificadores
 * internos (`LIMIT 50`, `tenant_id = 3`), que sí ayudan a leer la consulta y que la política
 * admite como identificadores opacos. Lo que identifica a una persona en este motor —documento,
 * nombre, correo y sus hashes— viaja siempre como cadena.
 */
export function redactSqlLiterals(statement: string): string {
  // El patrón admite la comilla duplicada (`''`), que es como SQL escapa una comilla dentro de
  // un literal: sin contemplarla, un literal con apóstrofo partiría la sustitución en dos y
  // dejaría fuera un trozo del valor.
  const withoutStrings = statement.replace(/'(?:[^']|'')*'/g, "'?'");
  // Bloques con delimitador en dólar (`$$…$$`, `$tag$…$tag$`): poco frecuentes en Sequelize,
  // pero pueden llevar cuerpos enteros de función o de JSON.
  const withoutDollarQuoted = withoutStrings.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, '$?$');
  return truncate(collapseWhitespace(withoutDollarQuoted));
}

/** Una sentencia de Sequelize llega con saltos de línea y sangría; en un atributo sólo estorban. */
function collapseWhitespace(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim();
}

function truncate(statement: string): string {
  if (statement.length <= MAX_STATEMENT_LENGTH) return statement;
  return `${statement.slice(0, MAX_STATEMENT_LENGTH - TRUNCATION_MARK.length)}${TRUNCATION_MARK}`;
}

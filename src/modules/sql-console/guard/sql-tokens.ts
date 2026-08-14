/**
 * Lector léxico de SQL, escrito para una sola cosa: que las reglas de `sql-guard.ts`
 * miren CÓDIGO y no texto.
 *
 * Toda guardia de SQL escrita con expresiones regulares sobre la cadena cruda tiene el
 * mismo agujero, y siempre por el mismo sitio: el comentario y la cadena literal. Un
 * `WHERE nombre = 'no--es un comentario'` se parte por la mitad si se borran comentarios
 * a la ligera, y un literal que contenga la palabra DROP entre delimitadores de comentario
 * dispara un bloqueo falso. Los dos fallos son igual de malos: el primero deja pasar, el
 * segundo enseña a la gente que la guardia se equivoca y hay que rodearla.
 *
 * Así que se recorre carácter a carácter, se reconocen los cuatro contextos que Postgres
 * distingue —comentario de línea, comentario de bloque (anidable), literal entre comillas
 * simples (con `''` y con `E'\''`) e identificador entre comillas dobles— y se devuelve el
 * SQL con comentarios y literales sustituidos por espacios de la MISMA longitud. Conservar
 * las posiciones no es un detalle: es lo que permite señalar la columna exacta en el error
 * que ve quien escribe la consulta.
 */

export interface ScannedSql {
  /** SQL con comentarios y literales en blanco. Es sobre esto que se aplican las reglas. */
  readonly masked: string;
  /** Identificadores entre comillas dobles, sin las comillas. */
  readonly quotedIdentifiers: readonly string[];
  /** Hubo una cadena con dólar (`$$…$$`), que la guardia rechaza sin más análisis. */
  readonly hasDollarQuoted: boolean;
  /** Un comentario o literal quedó abierto al acabar la entrada. */
  readonly unterminated: 'comentario' | 'literal' | 'identificador' | null;
}

const SPACE = ' ';

/** Reemplaza el tramo `[from, to)` por espacios, conservando los saltos de línea. */
function blank(source: string, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i += 1) out += source[i] === '\n' ? '\n' : SPACE;
  return out;
}

export function scanSql(sql: string): ScannedSql {
  const quotedIdentifiers: string[] = [];
  let masked = '';
  let hasDollarQuoted = false;
  let unterminated: ScannedSql['unterminated'] = null;
  let i = 0;

  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    // -- comentario de línea
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      masked += blank(sql, i, stop);
      i = stop;
      continue;
    }

    // /* comentario de bloque */ — anidable en Postgres, al contrario que en SQL estándar.
    // Contarlos mal es explotable: `/* /* */ DROP ...` termina el comentario antes de tiempo
    // para un lector ingenuo y deja el resto visible para la base pero no para la guardia.
    if (char === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) unterminated = 'comentario';
      masked += blank(sql, i, Math.min(j, sql.length));
      i = j;
      continue;
    }

    // $tag$ … $tag$ — sólo se detecta para poder rechazarla. Ninguna consulta de análisis
    // la necesita, y es la vía más cómoda para esconder una carga útil de cualquier lector.
    if (char === '$') {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        hasDollarQuoted = true;
        const closing = sql.indexOf(tag[0], i + tag[0].length);
        const stop = closing === -1 ? sql.length : closing + tag[0].length;
        if (closing === -1) unterminated = 'literal';
        masked += blank(sql, i, stop);
        i = stop;
        continue;
      }
    }

    // 'literal' — `''` escapa una comilla. La forma `E'\''` de escapar con contrabarra sólo
    // aplica dentro de una cadena con prefijo E, así que se mira el carácter anterior.
    if (char === "'") {
      const escapeString = /[eE]$/.test(masked.slice(-1)) && !/[A-Za-z0-9_]/.test(masked.slice(-2, -1));
      let j = i + 1;
      let closed = false;
      while (j < sql.length) {
        if (escapeString && sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (!closed) unterminated = 'literal';
      masked += blank(sql, i, Math.min(j, sql.length));
      i = j;
      continue;
    }

    // "identificador" — se conserva su contenido para que la guardia lo valide igual que
    // uno sin comillas: `SELECT * FROM "pg_class"` tiene que fallar por el mismo motivo
    // que `SELECT * FROM pg_class`.
    if (char === '"') {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += sql[j];
        j += 1;
      }
      if (!closed) unterminated = 'identificador';
      quotedIdentifiers.push(value);
      // Se deja en blanco para que las reglas de palabra no lo lean como sintaxis, pero su
      // contenido ya se ha guardado aparte y se revisa por su cuenta.
      masked += blank(sql, i, Math.min(j, sql.length));
      i = j;
      continue;
    }

    masked += char;
    i += 1;
  }

  return { masked, quotedIdentifiers, hasDollarQuoted, unterminated };
}

/** Posición legible (línea y columna, base 1) de un desplazamiento dentro del SQL. */
export function positionOf(sql: string, offset: number): { line: number; column: number } {
  const upTo = sql.slice(0, Math.max(0, offset));
  const lines = upTo.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

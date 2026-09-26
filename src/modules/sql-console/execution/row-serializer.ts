/**
 * De lo que devuelve Postgres a lo que puede viajar por JSON, sin mentir por el camino.
 *
 * Tres conversiones que parecen triviales y ninguna lo es:
 *
 *  · **`bigint` va como CADENA.** `JSON.stringify` lanza sobre un BigInt, así que hay que
 *    convertirlo; convertirlo a `number` sería peor que lanzar, porque a partir de 2^53 el
 *    identificador cambia SIN error. Una consola que redondea identificadores en silencio
 *    es una consola que cruza filas equivocadas y nadie se entera.
 *  · **`Decimal` también va como cadena.** Un monto de 18,4 no cabe en un `double`, y el
 *    error aparece justo donde más caro sale: sumando una cartera.
 *  · **`Date` va en ISO-8601 con zona.** Las columnas son `timestamptz`; mandar la fecha
 *    local del servidor haría que el mismo dato se leyera distinto según dónde corra.
 *
 * El tipo declarado viaja junto al valor (`ResultColumn.kind`) para que el portal sepa
 * alinear a la derecha un número que le llega como texto, y para que no intente
 * reinterpretar como número algo que se convirtió a cadena precisamente para no perderlo.
 */

export type ResultValue = string | number | boolean | null;

export type ResultColumnKind = 'texto' | 'numero' | 'entero' | 'booleano' | 'fecha' | 'json';

export interface ResultColumn {
  readonly name: string;
  readonly kind: ResultColumnKind;
}

export interface SerializedRows {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly (readonly ResultValue[])[];
}

/** Un `Decimal` de Prisma sin importar la clase: se reconoce por su contrato. */
function isDecimalLike(value: unknown): value is { toFixed(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    's' in value &&
    'e' in value &&
    'd' in value &&
    typeof (value as { toFixed?: unknown }).toFixed === 'function'
  );
}

function classify(value: unknown): ResultColumnKind {
  if (typeof value === 'bigint') return 'entero';
  if (typeof value === 'number') return Number.isInteger(value) ? 'entero' : 'numero';
  if (typeof value === 'boolean') return 'booleano';
  if (value instanceof Date) return 'fecha';
  if (isDecimalLike(value)) return 'numero';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'texto';
}

function convert(value: unknown): ResultValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (isDecimalLike(value)) return String(value);
  // Objetos y arreglos (columnas `json`/`jsonb`, o un arreglo de Postgres) se serializan
  // como texto: la rejilla los enseña en una celda y el panel JSON los muestra enteros.
  return JSON.stringify(value);
}

/**
 * Convierte las filas de Prisma en columnas + matriz.
 *
 * Se pasa a matriz y no se deja el arreglo de objetos porque una consulta puede devolver
 * dos columnas con el MISMO nombre (`SELECT a.id, b.id …`), y un objeto sólo conserva la
 * última. En una consola de SQL eso no es un detalle de formato: es una columna que el
 * analista pidió y no recibe, sin ningún aviso.
 *
 * `columnNames` viene de la descripción del cursor cuando está disponible; si no, se
 * deduce de la primera fila.
 */
export function serializeRows(
  rows: readonly Record<string, unknown>[],
  columnNames?: readonly string[],
): SerializedRows {
  const names = columnNames?.length ? [...columnNames] : Object.keys(rows[0] ?? {});
  const kinds = new Map<string, ResultColumnKind>();
  for (const row of rows) {
    for (const name of names) {
      if (kinds.has(name)) continue;
      const value = row[name];
      if (value !== null && value !== undefined) kinds.set(name, classify(value));
    }
    if (kinds.size === names.length) break;
  }

  return {
    columns: names.map((name) => ({ name, kind: kinds.get(name) ?? 'texto' })),
    rows: rows.map((row) => names.map((name) => convert(row[name]))),
  };
}

import type { Client } from 'pg';
import { ColumnRef, MAX_PARAMS, TableRef, quoteIdentifier, quoteTable, tableKey } from './model';

export async function copyTable(
  source: Client,
  target: Client,
  table: TableRef,
  columns: readonly ColumnRef[],
  log: (message: string) => void,
): Promise<number> {
  if (columns.length === 0) return 0;

  const selectList = columns
    .map((column) => `${quoteIdentifier(column.name)}::text AS ${quoteIdentifier(column.name)}`)
    .join(', ');
  const { rows } = await source.query<Record<string, string | null>>(
    `SELECT ${selectList} FROM ${quoteTable(table)}`,
  );
  if (rows.length === 0) return 0;

  // Una identidad GENERATED ALWAYS rechaza el valor explícito salvo con OVERRIDING SYSTEM VALUE, y
  // conservar el identificador de origen es justo lo que mantiene válidas las claves foráneas.
  const overriding = columns.some((column) => column.alwaysIdentity)
    ? ' OVERRIDING SYSTEM VALUE'
    : '';
  const columnList = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / columns.length));

  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const parameters: (string | null)[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        parameters.push(row[column.name] ?? null);
        return `$${parameters.length}::${column.type}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await target.query(
      `INSERT INTO ${quoteTable(table)} (${columnList})${overriding} VALUES ${tuples.join(', ')}`,
      parameters,
    );
    inserted += chunk.length;
  }

  log(`  ${tableKey(table).padEnd(52)} ${String(inserted).padStart(6)} filas`);
  return inserted;
}

/** Deja cada secuencia por encima del máximo copiado: sin esto el primer INSERT del runtime choca. */
export async function resyncSequences(
  target: Client,
  tables: readonly TableRef[],
  log: (message: string) => void,
): Promise<void> {
  const { rows } = await target.query<{
    schema: string;
    table: string;
    column: string;
    seq: string;
  }>(
    // El CTE es MATERIALIZED a propósito. Sin él, el planificador puede evaluar
    // `pg_get_serial_sequence` ANTES de aplicar el filtro de nombres, y entonces la llama sobre
    // relaciones que no son del manifiesto —incluidas las de `pg_toast`—, que un rol no
    // superusuario no puede leer: la carga entera moría con «permission denied for schema
    // pg_toast». Con un superusuario no se nota, que es exactamente por lo que conviene fijarlo.
    `WITH columnas AS MATERIALIZED (
       SELECT n.nspname AS schema, c.relname AS "table", a.attname AS col
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
          AND n.nspname || '.' || c.relname = ANY($1::text[])
     )
     SELECT schema, "table", col AS "column", seq
       FROM (
         SELECT schema, "table", col,
                pg_get_serial_sequence(format('%I.%I', schema, "table"), col) AS seq
           FROM columnas
       ) resueltas
      WHERE seq IS NOT NULL`,
    [tables.map(tableKey)],
  );

  for (const row of rows) {
    await target.query(
      `SELECT setval($1, COALESCE((SELECT MAX(${quoteIdentifier(row.column)}) FROM ${quoteIdentifier(row.schema)}.${quoteIdentifier(row.table)}), 0) + 1, false)`,
      [row.seq],
    );
  }
  if (rows.length > 0) log(`Secuencias reposicionadas: ${rows.length}.`);
}

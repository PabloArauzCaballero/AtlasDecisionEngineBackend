import type { Client } from 'pg';
import {
  ColumnRef,
  EXCLUDED_SCHEMAS,
  ForeignKeyRef,
  TRACKING_TABLES,
  TableRef,
  tableKey,
} from './model';

/** Tablas con al menos una fila en el origen. Es el manifiesto: lo que el origen considera semilla. */
export async function listSeededTables(client: Client): Promise<TableRef[]> {
  const { rows } = await client.query<{ schema: string; name: string; rows: string }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint AS rows
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r' AND n.nspname <> ALL($1::text[])
      ORDER BY 1, 2`,
    [EXCLUDED_SCHEMAS],
  );
  return rows
    .filter((row) => Number(row.rows) > 0 && !TRACKING_TABLES.has(`${row.schema}.${row.name}`))
    .map((row) => ({ schema: row.schema, name: row.name, rows: Number(row.rows) }));
}

export async function readColumns(
  client: Client,
  tables: readonly TableRef[],
): Promise<Map<string, ColumnRef[]>> {
  const { rows } = await client.query<{
    schema: string;
    table: string;
    column: string;
    type: string;
    identity: string;
    generated: string;
  }>(
    `SELECT n.nspname AS schema, c.relname AS "table", a.attname AS column,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attidentity AS identity, a.attgenerated AS generated
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname || '.' || c.relname = ANY($1::text[])
      ORDER BY a.attnum`,
    [tables.map(tableKey)],
  );

  const byTable = new Map<string, ColumnRef[]>();
  for (const row of rows) {
    // Una columna GENERATED ALWAYS AS la recalcula el destino: insertarla es un error de sintaxis.
    if (row.generated === 's') continue;
    const key = `${row.schema}.${row.table}`;
    const columns = byTable.get(key) ?? [];
    columns.push({ name: row.column, type: row.type, alwaysIdentity: row.identity === 'a' });
    byTable.set(key, columns);
  }
  return byTable;
}

/**
 * Claves foráneas que TOCAN el manifiesto, en cualquiera de los dos sentidos.
 *
 * Las que salen de una tabla del manifiesto hay que retirarlas para poder cargar en cualquier orden.
 * Las que ENTRAN —una tabla de runtime que apunta a una sembrada— hay que retirarlas por una razón
 * distinta y menos evidente: sin ellas, vaciar exigiría `TRUNCATE ... CASCADE`, y CASCADE alcanza a
 * esas tablas de runtime y las vacía también. Es un fallo caro y silencioso: al traer 8 840 filas de
 * catálogo se llevó por delante 390 000 de bitácora de auditoría, que no son semilla de nadie.
 *
 * Retirándolas se puede truncar SIN cascade, y al recrearlas se valida que las filas de runtime
 * siguen apuntando a algo que existe. Si la rama trae un catálogo incompatible con lo que ya hay
 * escrito, el `ALTER` falla y la carga entera se revierte — que es exactamente lo que debe pasar.
 */
export async function readForeignKeys(
  client: Client,
  tables: readonly TableRef[],
): Promise<ForeignKeyRef[]> {
  const { rows } = await client.query<ForeignKeyRef>(
    `SELECT n.nspname AS schema, c.relname AS "table", co.conname AS name,
            pg_get_constraintdef(co.oid) AS definition
       FROM pg_constraint co
       JOIN pg_class c ON c.oid = co.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class pc ON pc.oid = co.confrelid
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE co.contype = 'f'
        AND (n.nspname || '.' || c.relname = ANY($1::text[])
             OR pn.nspname || '.' || pc.relname = ANY($1::text[]))
      ORDER BY 1, 2, 3`,
    [tables.map(tableKey)],
  );
  return rows;
}

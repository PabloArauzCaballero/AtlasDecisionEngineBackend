import type { Client } from 'pg';
import { SeedSyncResult, quoteIdentifier, quoteTable, tableKey } from './model';
import { listSeededTables, readColumns, readForeignKeys } from './schema-reader';
import { copyTable, resyncSequences } from './table-copy';

/**
 * Copia el conjunto sembrado de `source` a `target`. Es DESTRUCTIVO sobre las tablas del
 * manifiesto: las vacía antes de cargarlas, para que el resultado sea el conjunto publicado y no
 * una mezcla con lo que hubiera antes.
 */
/**
 * ¿Se ha traído alguna vez el conjunto sembrado a esta base?
 *
 * Es la pregunta que gobierna `--if-empty`, y NO se puede responder contando filas. Una base recién
 * migrada ya tiene datos: las migraciones insertan permisos internos, plantillas de notificación y
 * la versión del esquema. Con «¿hay alguna tabla poblada?» el arranque automatizado se saltaba la
 * siembra en una base virgen y dejaba la instalación sin catálogo, que es justo lo contrario de lo
 * que la guarda pretende.
 *
 * Así que la carga deja una MARCA y la guarda mira la marca. Es exacto en los dos sentidos: una base
 * nueva no la tiene y se siembra; una base ya sembrada la tiene y no se toca, por muchas filas que
 * el runtime haya escrito o borrado desde entonces.
 */
export async function hasSeedLoad(target: Client): Promise<boolean> {
  const { rows } = await target.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'atlas_seed' AND c.relname = 'load_log' AND c.relkind = 'r'
     ) AS exists`,
  );
  if (!rows[0]?.exists) return false;
  const { rows: count } = await target.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM atlas_seed.load_log',
  );
  return Number(count[0]?.n ?? '0') > 0;
}

/** Deja constancia en el DESTINO de qué se trajo y de dónde. La lee {@link hasSeedLoad}. */
async function recordSeedLoad(
  target: Client,
  meta: { source: string; rows: number; tables: number },
): Promise<void> {
  await target.query('CREATE SCHEMA IF NOT EXISTS atlas_seed');
  await target.query(
    `CREATE TABLE IF NOT EXISTS atlas_seed.load_log (
       id serial PRIMARY KEY,
       loaded_at timestamptz NOT NULL DEFAULT now(),
       source text NOT NULL,
       total_rows bigint NOT NULL,
       total_tables int NOT NULL
     )`,
  );
  await target.query(
    'INSERT INTO atlas_seed.load_log (source, total_rows, total_tables) VALUES ($1, $2, $3)',
    [meta.source, meta.rows, meta.tables],
  );
}

export async function syncSeedData(options: {
  source: Client;
  target: Client;
  /** Cómo se llama la rama de origen, para dejarlo escrito en la marca de carga. */
  sourceLabel?: string;
  log?: (message: string) => void;
}): Promise<SeedSyncResult> {
  const { source, target } = options;
  // Progreso por stdout directo: es un flujo de avance de una tarea de línea de comandos, no un
  // evento de la aplicación, y `console` está restringido a error/warn en este repositorio.
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));

  const tables = await listSeededTables(source);
  if (tables.length === 0) {
    throw new Error(
      'La rama de semillas no tiene ninguna tabla con datos: no hay nada que copiar.',
    );
  }

  const columnsByTable = await readColumns(source, tables);
  const foreignKeys = await readForeignKeys(target, tables);
  log(
    `Origen: ${tables.length} tablas con datos, ${tables.reduce((total, table) => total + table.rows, 0)} filas.`,
  );

  await target.query('BEGIN');
  try {
    for (const foreignKey of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)} DROP CONSTRAINT ${quoteIdentifier(foreignKey.name)}`,
      );
    }
    log(`Claves foráneas retiradas dentro de la transacción: ${foreignKeys.length}.`);

    // Los disparadores de usuario se apagan por dos razones distintas: hay tablas protegidas como
    // append-only —`decision_audit_event` rechaza TRUNCATE por disparador— y un BEFORE INSERT que recalcule
    // marcas de tiempo o hashes reescribiría filas que ya vienen calculadas del origen.
    for (const table of tables)
      await target.query(`ALTER TABLE ${quoteTable(table)} DISABLE TRIGGER USER`);

    await target.query(
      // Sin CASCADE, y eso es el punto: CASCADE vaciaría también las tablas de runtime que
      // apuntan al catálogo. Se puede prescindir de él porque las claves que entran ya se retiraron.
      `TRUNCATE TABLE ${tables.map(quoteTable).join(', ')} RESTART IDENTITY`,
    );

    let copied = 0;
    for (const table of tables) {
      copied += await copyTable(
        source,
        target,
        table,
        columnsByTable.get(tableKey(table)) ?? [],
        log,
      );
    }

    await resyncSequences(target, tables, log);
    for (const table of tables)
      await target.query(`ALTER TABLE ${quoteTable(table)} ENABLE TRIGGER USER`);

    for (const foreignKey of foreignKeys) {
      await target.query(
        `ALTER TABLE ${quoteIdentifier(foreignKey.schema)}.${quoteIdentifier(foreignKey.table)} ADD CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${foreignKey.definition}`,
      );
    }
    log(`Claves foráneas recreadas y validadas: ${foreignKeys.length}.`);

    await recordSeedLoad(target, {
      source: options.sourceLabel ?? '(sin identificar)',
      rows: copied,
      tables: tables.length,
    });

    await target.query('COMMIT');
    return { rows: copied, tables: tables.length };
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}

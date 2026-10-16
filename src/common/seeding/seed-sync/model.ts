/** Contabilidad de migraciones y seeds: describe al DESTINO, así que nunca se copia. */
export const TRACKING_TABLES = new Set([
  'public.SequelizeMeta',
  'public.SequelizeDataSeedersDevelopment',
  'public.SequelizeDataSeedersDevelopments',
  'public.SequelizeDataSeedersProduction',
  'public.SequelizeDataSeedersProductions',
  'public.atlas_sql_migrations',
  'public._prisma_migrations',
]);

export const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'atlas_seed'];

/** Tope de parámetros por sentencia. PostgreSQL admite 65535; se deja margen. */
export const MAX_PARAMS = 30000;

export interface TableRef {
  readonly schema: string;
  readonly name: string;
  readonly rows: number;
}

export interface ColumnRef {
  readonly name: string;
  readonly type: string;
  readonly alwaysIdentity: boolean;
}

export interface ForeignKeyRef {
  readonly schema: string;
  readonly table: string;
  readonly name: string;
  readonly definition: string;
}

export interface SeedSyncResult {
  readonly rows: number;
  readonly tables: number;
}

export const quoteIdentifier = (identifier: string): string =>
  `"${identifier.replace(/"/g, '""')}"`;
export const quoteTable = (table: { schema: string; name: string }): string =>
  `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`;
export const tableKey = (table: { schema: string; name: string }): string =>
  `${table.schema}.${table.name}`;

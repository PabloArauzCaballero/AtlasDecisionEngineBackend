import { auditoria } from './auditoria';
import { catalogo } from './catalogo';
import { decisiones } from './decisiones';
import { desenlaces, riesgo } from './desenlaces-y-riesgo';
import { CatalogDataset, CatalogTable } from './types';

export const SQL_CONSOLE_CATALOG: readonly CatalogDataset[] = [
  decisiones,
  catalogo,
  desenlaces,
  riesgo,
  auditoria,
];

/** Nombres de esquema que la sesión puede resolver. Es también el `search_path`. */
export const DATASET_NAMES: readonly string[] = SQL_CONSOLE_CATALOG.map((d) => d.name);

/**
 * Toda relación consultable, en las dos formas en que se puede escribir.
 *
 * Se incluye el nombre suelto además del calificado porque el `search_path` de la sesión
 * cubre los cinco datasets: `FROM ejecuciones` es válido y tiene que serlo, o la consola
 * obligaría a calificar donde BigQuery no obliga. Que `motivos` exista en dos datasets no
 * es un problema para la guardia —sólo comprueba que el nombre sea consultable— y sí lo
 * resuelve Postgres por orden del `search_path`, igual que en cualquier esquema.
 */
export const QUALIFIED_RELATIONS: ReadonlySet<string> = new Set(
  SQL_CONSOLE_CATALOG.flatMap((dataset) =>
    dataset.tables.flatMap((table) => [`${dataset.name}.${table.name}`, table.name]),
  ),
);

export function findTable(dataset: string, table: string): CatalogTable | undefined {
  return SQL_CONSOLE_CATALOG.find((d) => d.name === dataset)?.tables.find((t) => t.name === table);
}

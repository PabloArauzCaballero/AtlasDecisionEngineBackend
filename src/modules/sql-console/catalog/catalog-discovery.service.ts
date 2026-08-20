/**
 * Qué publica de verdad la base, preguntándoselo a ella.
 *
 * `dataset-catalog.ts` era la única verdad sobre la superficie de consulta y estaba escrita a
 * mano. Correcta el día que se escribió, y muda desde la primera migración que añadiera una
 * vista: el explorador seguía enseñando dieciséis relaciones, el autocompletado sugería esas
 * dieciséis y la guardia rechazaba la decimoséptima con «no existe en los datasets de la
 * consola» — sobre una vista que existía, estaba gobernada y ya tenía el `SELECT` concedido
 * (la migración deja puesto `ALTER DEFAULT PRIVILEGES`). El síntoma más caro de un catálogo a
 * mano no es que falte algo: es que el que mira no tiene forma de saber que falta.
 *
 * Aquí se invierte el reparto. La FORMA —qué esquemas, qué vistas, qué columnas y de qué
 * tipo— se descubre contra `pg_catalog`. Lo escrito a mano pasa a ser la FICHA: la
 * explicación de cada tabla, el grano y la descripción de cada columna, que son prosa y no
 * pueden deducirse de un `information_schema`. Una vista nueva aparece sola, con la
 * descripción que su propio `COMMENT ON` declare.
 *
 * Lo que NO se deduce es el aislamiento por inquilino, y ésa es la línea que sostiene todo lo
 * demás. Una vista descubierta se sirve sólo si su definición invoca
 * `public.atlas_current_tenant()`, que es como este repositorio acota cada una de las suyas.
 * La que no lo haga se descubre, NO se sirve, y se informa con el motivo. Dar por gobernada
 * toda vista que aparezca en un esquema gobernado convertiría un `CREATE VIEW` sin `WHERE` en
 * una fuga entre organizaciones, en silencio y con el catálogo en verde.
 *
 * Los esquemas siguen declarados (`DATASET_NAMES`) a propósito: son el `search_path` de la
 * sesión y el destino de los `GRANT`. Añadir uno es una decisión de privilegios, no de
 * modelado, y debe costar una firma.
 */
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CatalogColumn,
  CatalogDataset,
  CatalogTable,
  ColumnKind,
  DATASET_NAMES,
  findTable,
  SQL_CONSOLE_CATALOG,
} from './dataset-catalog';

/** Una relación que la base publica y la consola NO sirve, con el motivo en una línea. */
export interface OmittedRelation {
  readonly name: string;
  readonly reason: string;
}

export interface DiscoveredCatalog {
  readonly datasets: readonly CatalogDataset[];
  readonly omitted: readonly OmittedRelation[];
  /** Toda relación consultable, calificada y suelta. Es la lista blanca de la guardia. */
  readonly relations: ReadonlySet<string>;
}

/** La tabla mientras se construye: sus columnas llegan fila a fila desde `pg_attribute`. */
interface MutableTable extends Omit<CatalogTable, 'columns'> {
  columns: CatalogColumn[];
}

interface MutableDataset {
  description: string;
  tables: Map<string, MutableTable>;
}

interface CatalogRow {
  schema: string;
  schema_description: string | null;
  relation: string;
  relation_description: string | null;
  filters_tenant: boolean;
  column_name: string;
  data_type: string;
  column_description: string | null;
}

/**
 * De tipo de Postgres a la clase con la que se PRESENTA la columna.
 *
 * No es una traducción del sistema de tipos: es lo que necesita saber quien lee una tabla
 * para alinearla y formatearla. `numeric` y `bigint` se separan de `integer` porque viajan
 * como cadena para no perder precisión, y quien pinta necesita saber que aun así son números.
 */
function kindOf(dataType: string): ColumnKind {
  const type = dataType.toLowerCase();
  if (type.startsWith('bool')) return 'booleano';
  if (type.includes('timestamp') || type === 'date' || type.startsWith('time')) return 'fecha';
  if (type === 'uuid' || type.endsWith('[]')) return 'identificador';
  if (type.startsWith('int') || type === 'smallint' || type === 'bigint') return 'entero';
  if (type.startsWith('numeric') || type.startsWith('double') || type.startsWith('real')) {
    return 'numero';
  }
  return 'texto';
}

/**
 * La descripción de una vista que nadie describió en el código.
 *
 * Sale de su `COMMENT ON VIEW`, que es donde quien crea la vista ya está escribiendo. Si
 * tampoco lo hay, se dice exactamente eso: que no está descrita. Inventar una frase a partir
 * del nombre —«Vista de pagos»— llenaría el explorador de descripciones que no explican nada
 * y que además parecen escritas por alguien.
 */
function describedBy(comment: string | null, qualified: string): string {
  return comment?.trim() || `Sin descripción declarada. Añádela con COMMENT ON VIEW ${qualified}.`;
}

@Injectable()
export class CatalogDiscoveryService {
  private readonly logger = new Logger(CatalogDiscoveryService.name);

  /**
   * El catálogo cambia con una migración, no entre peticiones: se cachea por proceso.
   *
   * Se guarda la PROMESA y no el valor para que dos peticiones simultáneas al arrancar no
   * disparen dos veces la misma consulta al catálogo. Si falla, se descarta: cachear el fallo
   * dejaría la consola muerta hasta el siguiente despliegue.
   */
  private cached: Promise<DiscoveredCatalog> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  catalog(): Promise<DiscoveredCatalog> {
    if (!this.cached) {
      this.cached = this.discover().catch((error: unknown) => {
        this.cached = null;
        throw error;
      });
    }
    return this.cached;
  }

  /** Para las pruebas y para un futuro aviso de migración: vuelve a preguntar a la base. */
  invalidate(): void {
    this.cached = null;
  }

  private async discover(): Promise<DiscoveredCatalog> {
    const rows = await this.query();
    if (rows.length === 0) {
      /*
       * Ni una vista en cinco esquemas gobernados. O la migración no corrió, o el rol de la
       * aplicación no ve estos esquemas. En los dos casos hay que fallar: devolver un catálogo
       * vacío dejaría el explorador en blanco y la guardia rechazándolo TODO, y el mensaje que
       * llegaría a quien consulta sería «esa tabla no existe» sobre la base entera.
       */
      throw new ServiceUnavailableException(
        'La consola no encuentra las vistas gobernadas en esta base. Corre las migraciones ' +
          '(yarn prisma migrate deploy) y vuelve a intentarlo.',
      );
    }

    const datasets = new Map<string, MutableDataset>();
    const omitted: OmittedRelation[] = [];
    const relations = new Set<string>();

    for (const row of rows) {
      const qualified = `${row.schema}.${row.relation}`;
      if (!row.filters_tenant) {
        if (!omitted.some((entry) => entry.name === qualified)) {
          omitted.push({
            name: qualified,
            reason:
              'Su definición no invoca public.atlas_current_tenant(), así que no hay nada que ' +
              'acote las filas al inquilino que consulta. No se sirve hasta que la vista filtre.',
          });
        }
        continue;
      }

      const dataset = this.datasetOf(datasets, row);
      const table = this.tableOf(dataset.tables, row, qualified);
      table.columns.push(this.columnOf(row));
      relations.add(qualified);
      relations.add(row.relation);
    }

    if (omitted.length > 0) {
      // Se registra además de devolverse: quien despliega una vista sin filtro no está mirando
      // el explorador de la consola en ese momento.
      this.logger.warn(
        `Vistas gobernadas descartadas por no acotar el inquilino: ${omitted
          .map((entry) => entry.name)
          .join(', ')}`,
      );
    }

    return { datasets: this.ordered(datasets), omitted, relations };
  }

  private datasetOf(datasets: Map<string, MutableDataset>, row: CatalogRow): MutableDataset {
    const existing = datasets.get(row.schema);
    if (existing) return existing;

    const declared = SQL_CONSOLE_CATALOG.find((dataset) => dataset.name === row.schema);
    const created: MutableDataset = {
      description: declared?.description ?? describedBy(row.schema_description, row.schema),
      tables: new Map<string, MutableTable>(),
    };
    datasets.set(row.schema, created);
    return created;
  }

  private tableOf(
    tables: Map<string, MutableTable>,
    row: CatalogRow,
    qualified: string,
  ): MutableTable {
    const existing = tables.get(row.relation);
    if (existing) return existing;

    const declared = findTable(row.schema, row.relation);
    const created: MutableTable = {
      name: row.relation,
      description: declared?.description ?? describedBy(row.relation_description, qualified),
      /*
       * El grano NO se inventa. Es la frase que dice qué es UNA fila, y sin ella un `COUNT(*)`
       * se interpreta mal —no es lo mismo una fila por decisión que una por nodo recorrido—.
       * Una vista recién descubierta que no lo declare sale con `null`, y la pantalla se calla
       * en vez de afirmar un grano que nadie comprobó.
       */
      grain: declared?.grain ?? null,
      columns: [],
    };
    tables.set(row.relation, created);
    return created;
  }

  private columnOf(row: CatalogRow): CatalogColumn {
    const declared = findTable(row.schema, row.relation)?.columns.find(
      (column) => column.name === row.column_name,
    );
    return {
      name: row.column_name,
      kind: declared?.kind ?? kindOf(row.data_type),
      description:
        declared?.description ??
        row.column_description?.trim() ??
        `Columna ${row.data_type} sin descripción declarada.`,
    };
  }

  /**
   * Los esquemas salen en el orden DECLARADO y los descubiertos detrás.
   *
   * El orden del explorador es una jerarquía leída: `decisiones` primero porque es por lo que
   * la gente abre la consola. Ordenar alfabéticamente pondría `auditoria` arriba y enterraría
   * lo que se viene a mirar.
   */
  private ordered(datasets: Map<string, MutableDataset>): CatalogDataset[] {
    const names = [
      ...DATASET_NAMES.filter((name) => datasets.has(name)),
      ...[...datasets.keys()].filter((name) => !DATASET_NAMES.includes(name)),
    ];
    return names.map((name) => {
      const entry = datasets.get(name)!;
      return {
        name,
        description: entry.description,
        tables: [...entry.tables.values()],
      };
    });
  }

  /**
   * Una sola consulta, y el filtro por inquilino resuelto DENTRO de ella.
   *
   * `pg_get_viewdef` se compara aquí y no en JavaScript porque es Postgres quien normaliza el
   * texto de la vista: la definición que devuelve lleva el nombre calificado y expandido
   * (`public.atlas_current_tenant()`) escriba lo que escriba la migración. Comparar el SQL
   * original a mano fallaría con `atlas_current_tenant()` a secas, que es como está escrito en
   * la mitad de las vistas.
   *
   * Los `::text` no son adorno. `nspname`, `relname` y `attname` son del tipo `name` de
   * Postgres, y el adaptador de Prisma lo rechaza con `UnsupportedNativeDataType`: la consulta
   * revienta ENTERA, no devuelve columnas raras. No lo atrapa ninguna prueba con Prisma
   * simulado —el simulado devuelve cadenas, que es lo que el código espera—, sólo aparece
   * contra una base de verdad.
   */
  private query(): Promise<CatalogRow[]> {
    return this.prisma.$queryRaw<CatalogRow[]>`
      SELECT n.nspname::text                             AS schema,
             obj_description(n.oid, 'pg_namespace')      AS schema_description,
             c.relname::text                             AS relation,
             obj_description(c.oid, 'pg_class')          AS relation_description,
             pg_get_viewdef(c.oid) ILIKE '%atlas_current_tenant()%' AS filters_tenant,
             a.attname::text                             AS column_name,
             format_type(a.atttypid, a.atttypmod)        AS data_type,
             col_description(c.oid, a.attnum)            AS column_description
        FROM pg_namespace n
        JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('v', 'm')
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE n.nspname = ANY(${[...DATASET_NAMES]}::text[])
       ORDER BY n.nspname, c.relname, a.attnum`;
  }
}

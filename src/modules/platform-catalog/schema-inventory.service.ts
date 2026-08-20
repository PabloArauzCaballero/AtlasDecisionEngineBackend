/**
 * Inventario de tablas leído del `information_schema` de ESTE servicio.
 *
 * Es deliberadamente la misma técnica que Atlas Backend aplica sobre su propia base
 * (`SystemsSchemaIntrospectionService`), y no una lectura del `schema.prisma`. Dos razones:
 *
 *  1. Lo que existe en la base es la verdad. Una migración aplicada a mano, una tabla heredada o
 *     una vista materializada no están en el modelo de Prisma, y son exactamente las que un
 *     auditor pregunta por qué nadie sabe explicar.
 *  2. Homogeneidad. Si el motor reportara modelos de Prisma y el ERP modelos de Sequelize, el
 *     catálogo unificado del portal mezclaría dos nociones distintas de «entidad» bajo la misma
 *     columna. Preguntando al `information_schema` los tres bloques contestan lo mismo.
 *
 * La clasificación (PII, financiero, riesgo) es una HEURÍSTICA por nombre de columna, y el
 * federador la marca como inferida con confianza media. No pretende sustituir a la revisión
 * humana: pretende que la revisión humana tenga algo que revisar en vez de una tabla vacía.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CatalogManifestDataEntityDto } from './platform-catalog.dto';

/**
 * Las columnas se piden con `::text` explícito.
 *
 * `information_schema` las declara como el tipo interno `name` de PostgreSQL, y el driver de Prisma
 * no sabe deserializarlo: la consulta fallaba entera con «Failed to deserialize column of type
 * 'name'», que se lee como un problema de permisos o de esquema y no lo es. El casteo es la
 * traducción explícita a un tipo que el cliente sí conoce.
 */
type ColumnRow = {
  schemaName: string;
  tableName: string;
  columnName: string;
  isPrimaryKey: boolean;
};

/** Fragmentos de nombre que delatan datos personales identificables. */
const PII_HINTS = ['email', 'phone', 'msisdn', 'document', 'dni', 'nit', 'address', 'birth', 'full_name', 'first_name', 'last_name', 'ip_address'];
/** Fragmentos que delatan importes, saldos o límites. */
const FINANCIAL_HINTS = ['amount', 'balance', 'limit', 'price', 'currency', 'interest', 'payment', 'invoice', 'credit'];
/** Fragmentos que delatan puntajes, políticas o decisiones. */
const RISK_HINTS = ['score', 'risk', 'decision', 'policy', 'rule', 'fraud', 'threshold', 'outcome'];
/** Fragmentos que delatan evidencia que una auditoría necesita leer entera. */
const AUDIT_HINTS = ['audit', 'log', 'event', 'trace', 'approval', 'deployment', 'version', 'signature'];

@Injectable()
export class SchemaInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(moduleResolver: (tableName: string) => string): Promise<CatalogManifestDataEntityDto[]> {
    const rows = await this.prisma.$queryRaw<ColumnRow[]>`
WITH pk AS (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
     AND kcu.table_name = tc.table_name
   WHERE tc.constraint_type = 'PRIMARY KEY'
)
SELECT c.table_schema::text AS "schemaName",
       c.table_name::text   AS "tableName",
       c.column_name::text  AS "columnName",
       (pk.column_name IS NOT NULL) AS "isPrimaryKey"
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema
   AND t.table_name = c.table_name
   AND t.table_type = 'BASE TABLE'
  LEFT JOIN pk
    ON pk.table_schema = c.table_schema
   AND pk.table_name = c.table_name
   AND pk.column_name = c.column_name
 WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
   AND c.table_name NOT LIKE '\\_prisma%'
 ORDER BY c.table_schema, c.table_name, c.ordinal_position;`;

    const byTable = new Map<string, ColumnRow[]>();
    for (const row of rows) {
      const key = `${row.schemaName}.${row.tableName}`;
      const bucket = byTable.get(key);
      if (bucket) bucket.push(row);
      else byTable.set(key, [row]);
    }

    return [...byTable.values()].map((columns) => this.describe(columns, moduleResolver));
  }

  private describe(
    columns: ColumnRow[],
    moduleResolver: (tableName: string) => string,
  ): CatalogManifestDataEntityDto {
    const [first] = columns;
    const names = columns.map((column) => column.columnName.toLowerCase());
    const tableName = first.tableName;
    const entityName = humanize(tableName);
    const containsRiskData = matchesAny(names, RISK_HINTS) || matchesAny([tableName.toLowerCase()], RISK_HINTS);

    return {
      schemaName: first.schemaName,
      tableName,
      entityName,
      module: moduleResolver(tableName),
      columnCount: columns.length,
      primaryKeyColumns: columns.filter((column) => column.isPrimaryKey).map((column) => column.columnName),
      containsPii: matchesAny(names, PII_HINTS),
      containsFinancialData: matchesAny(names, FINANCIAL_HINTS),
      containsRiskData,
      isAuditCritical: matchesAny([tableName.toLowerCase()], AUDIT_HINTS) || containsRiskData,
      businessPurpose: `Tabla \`${first.schemaName}.${tableName}\` con ${columns.length} columnas. Propósito inferido del esquema: pendiente de revisión humana.`,
    };
  }
}

function matchesAny(values: string[], hints: string[]): boolean {
  return values.some((value) => hints.some((hint) => value.includes(hint)));
}

function humanize(identifier: string): string {
  const words = identifier.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Inventario de tablas leído del catálogo de PostgreSQL de ESTE servicio.
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
 * Dos detalles de la consulta que no son opcionales:
 *
 * - Las columnas se piden con `::text` explícito. El catálogo las declara como el tipo interno
 *   `name` de PostgreSQL y el driver de Prisma no sabe deserializarlo: la consulta fallaba entera
 *   con «Failed to deserialize column of type 'name'», que se lee como un problema de permisos o de
 *   esquema y no lo es.
 * - Se lee `pg_catalog` y no `information_schema`. La vista `key_column_usage` —la forma canónica
 *   de sacar las claves primarias— tarda segundos en una base con cientos de tablas, más que el
 *   plazo de la petición que la federa, y el bloque acababa reportándose como «no responde». La
 *   misma respuesta sale de `pg_class`/`pg_index` en milisegundos.
 */
type ColumnRow = {
  schemaName: string;
  tableName: string;
  columnName: string;
  isPrimaryKey: boolean;
};

/** Fragmentos de nombre que delatan datos personales identificables. */
const PII_HINTS = [
  'email',
  'phone',
  'msisdn',
  'document',
  'dni',
  'nit',
  'address',
  'birth',
  'full_name',
  'first_name',
  'last_name',
  'ip_address',
];
/** Fragmentos que delatan importes, saldos o límites. */
const FINANCIAL_HINTS = [
  'amount',
  'balance',
  'limit',
  'price',
  'currency',
  'interest',
  'payment',
  'invoice',
  'credit',
];
/** Fragmentos que delatan puntajes, políticas o decisiones. */
const RISK_HINTS = ['score', 'risk', 'decision', 'policy', 'rule', 'fraud', 'threshold', 'outcome'];
/** Fragmentos que delatan evidencia que una auditoría necesita leer entera. */
const AUDIT_HINTS = [
  'audit',
  'log',
  'event',
  'trace',
  'approval',
  'deployment',
  'version',
  'signature',
];

@Injectable()
export class SchemaInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(
    moduleResolver: (tableName: string) => string,
  ): Promise<CatalogManifestDataEntityDto[]> {
    const rows = await this.prisma.$queryRaw<ColumnRow[]>`
SELECT n.nspname::text  AS "schemaName",
       c.relname::text  AS "tableName",
       a.attname::text  AS "columnName",
       COALESCE(i.indisprimary, false) AS "isPrimaryKey"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND n.nspname NOT LIKE 'pg\\_%'
   AND c.relname NOT LIKE '\\_prisma%'
 ORDER BY n.nspname, c.relname, a.attnum;`;

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
    const containsRiskData =
      matchesAny(names, RISK_HINTS) || matchesAny([tableName.toLowerCase()], RISK_HINTS);

    return {
      schemaName: first.schemaName,
      tableName,
      entityName,
      module: moduleResolver(tableName),
      columnCount: columns.length,
      primaryKeyColumns: columns
        .filter((column) => column.isPrimaryKey)
        .map((column) => column.columnName),
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

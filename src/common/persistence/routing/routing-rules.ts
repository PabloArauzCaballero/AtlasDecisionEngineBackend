/**
 * Reglas de enrutamiento de datos: declarativas, validadas y versionadas.
 *
 * Un controlador no elige conexión. Declara su módulo y si la operación es lectura o
 * escritura, y estas reglas —cargadas del entorno y validadas al arrancar— deciden el
 * resto. Cambiar la topología de datos de un módulo es editar una variable, no el código.
 *
 * Formato de `DATA_ROUTING_RULES` (JSON):
 *
 *   {
 *     "audit-query": { "read": "postgres-read", "consistency": "eventual" },
 *     "runtime":     { "read": "postgres-write", "write": "postgres-write" }
 *   }
 *
 * Lo que no se declare hereda de `default`.
 */
import { z } from 'zod';
import { DataSourceConfigurationError } from '../errors/persistence-errors';
import type { CapabilityName } from '../ports/adapter-capabilities';
import type { ConsistencyLevel } from '../ports/data-source.types';
import { READ_CONNECTION, WRITE_CONNECTION } from '../connections/connection-registry.service';

const CONNECTION_NAME = z.string().regex(/^[a-z][a-z0-9-]{1,60}$/, {
  message: 'A connection name must be lower-case, dash-separated and start with a letter',
});

const CAPABILITY_NAMES = [
  'transactions',
  'fullTextSearch',
  'optimisticLocking',
  'changeStreams',
  'rowLevelSecurity',
  'nativeJson',
  'readReplica',
  'distributedTransactions',
] as const satisfies readonly CapabilityName[];

const moduleRuleSchema = z
  .object({
    read: CONNECTION_NAME.optional(),
    write: CONNECTION_NAME.optional(),
    consistency: z.enum(['strong', 'eventual', 'read-after-write']).optional(),
    /** Capacidades que este módulo necesita de su motor; se comprueban al arrancar. */
    requires: z.array(z.enum(CAPABILITY_NAMES)).optional(),
  })
  .strict();

export type ModuleRoutingRule = z.infer<typeof moduleRuleSchema>;

export const routingRulesSchema = z.record(z.string().min(1).max(80), moduleRuleSchema);
export type RoutingRules = Record<string, ModuleRoutingRule>;

export const DEFAULT_MODULE = 'default';

/**
 * Reglas base.
 *
 * `default.read` apunta a `postgres-read`, que —mientras no se declare `DATABASE_READ_URL`—
 * es el MISMO pool que la escritura. Es decir: el enrutamiento está activo desde el primer
 * día y separar físicamente las rutas no cambia ninguna regla.
 *
 * `runtime` es la excepción declarada: el camino de decisión lee lo que acaba de escribir
 * (idempotencia, despliegue activo, contadores), así que resolver su lectura contra una
 * réplica devolvería una decisión tomada con estado viejo. Se ancla al primario.
 */
export const BASE_ROUTING_RULES: RoutingRules = {
  [DEFAULT_MODULE]: {
    read: READ_CONNECTION,
    write: WRITE_CONNECTION,
    consistency: 'strong',
    requires: ['transactions', 'rowLevelSecurity'],
  },
  runtime: { read: WRITE_CONNECTION, write: WRITE_CONNECTION, consistency: 'read-after-write' },
  governance: { read: WRITE_CONNECTION, write: WRITE_CONNECTION, consistency: 'read-after-write' },
  'audit-query': { read: READ_CONNECTION, write: WRITE_CONNECTION, consistency: 'eventual' },
  views: { read: READ_CONNECTION, write: WRITE_CONNECTION, consistency: 'eventual' },
  traceability: { read: READ_CONNECTION, write: WRITE_CONNECTION, consistency: 'eventual' },
};

/** Parsea el JSON del entorno. Un valor mal formado impide arrancar, no se ignora. */
export function parseRoutingOverrides(raw: string | undefined): RoutingRules {
  if (!raw || !raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DataSourceConfigurationError('DATA_ROUTING_RULES is not valid JSON');
  }
  const result = routingRulesSchema.safeParse(parsed);
  if (!result.success) {
    const [issue] = result.error.issues;
    throw new DataSourceConfigurationError(
      `DATA_ROUTING_RULES is invalid at "${issue.path.join('.') || '<root>'}": ${issue.message}`,
    );
  }
  return result.data;
}

/** Fusiona por módulo: un override parcial no borra lo que no menciona. */
export function mergeRoutingRules(base: RoutingRules, overrides: RoutingRules): RoutingRules {
  const merged: RoutingRules = { ...base };
  for (const [moduleName, rule] of Object.entries(overrides)) {
    merged[moduleName] = { ...(merged[moduleName] ?? {}), ...rule };
  }
  return merged;
}

/** Resuelve la regla efectiva de un módulo heredando de `default`. */
export function effectiveRule(
  rules: RoutingRules,
  moduleName: string,
): Required<ModuleRoutingRule> {
  const fallback = rules[DEFAULT_MODULE] ?? BASE_ROUTING_RULES[DEFAULT_MODULE];
  const rule = rules[moduleName] ?? {};
  return {
    read: rule.read ?? fallback.read ?? READ_CONNECTION,
    write: rule.write ?? fallback.write ?? WRITE_CONNECTION,
    consistency: (rule.consistency ?? fallback.consistency ?? 'strong') as ConsistencyLevel,
    requires: rule.requires ?? fallback.requires ?? [],
  };
}

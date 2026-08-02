/**
 * Catálogo canónico de tipos de dato del contrato (§1.1).
 *
 * Un único lugar donde vive la respuesta a "¿qué tipos existen y qué valor JSON
 * los satisface?". Antes cada validador traía su propia lista de alias
 * (`['STRING','TEXT','UUID',...]`), lo que hacía que entrada y salida aceptaran
 * conjuntos distintos para el mismo nombre de tipo.
 */

export const DATA_TYPES = [
  'STRING',
  'LONG_TEXT',
  'INTEGER',
  'DECIMAL',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIME',
  'ENUM',
  'LIST',
  'OBJECT',
  'IDENTIFIER',
  'PERCENTAGE',
  'CURRENCY',
  'CODE',
  'STRUCTURED_RESULT',
] as const;

export type DataType = (typeof DATA_TYPES)[number];

/**
 * Nombres históricos aceptados en contratos ya persistidos. Se normalizan al tipo
 * canónico en vez de rechazarse: hay artefactos aprobados (inmutables) que usan
 * `NUMBER` o `TEXT` y no pueden reescribirse.
 */
const ALIASES: Readonly<Record<string, DataType>> = {
  TEXT: 'STRING',
  VARCHAR: 'STRING',
  UUID: 'IDENTIFIER',
  ID: 'IDENTIFIER',
  INT: 'INTEGER',
  BIGINT: 'INTEGER',
  NUMBER: 'DECIMAL',
  FLOAT: 'DECIMAL',
  DOUBLE: 'DECIMAL',
  NUMERIC: 'DECIMAL',
  MONEY: 'CURRENCY',
  BOOL: 'BOOLEAN',
  ARRAY: 'LIST',
  JSON: 'OBJECT',
  MAP: 'OBJECT',
  TIMESTAMP: 'DATETIME',
  RESULT: 'STRUCTURED_RESULT',
};

/** Tipos cuyo valor JSON es un número. */
export const NUMERIC_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'INTEGER',
  'DECIMAL',
  'PERCENTAGE',
  'CURRENCY',
]);

/** Tipos cuyo valor JSON es una cadena. */
export const TEXTUAL_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'STRING',
  'LONG_TEXT',
  'ENUM',
  'IDENTIFIER',
  'CODE',
  'DATE',
  'DATETIME',
  'TIME',
]);

/** Tipos admitidos como salida primaria: deben ser escalares legibles. */
export const SCALAR_TYPES: ReadonlySet<DataType> = new Set<DataType>([
  'STRING',
  'ENUM',
  'CODE',
  'IDENTIFIER',
  'BOOLEAN',
  'INTEGER',
  'DECIMAL',
  'PERCENTAGE',
  'CURRENCY',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/;

/** Normaliza cualquier alias histórico al tipo canónico; `undefined` si no existe. */
export function normalizeDataType(raw: string | null | undefined): DataType | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  if ((DATA_TYPES as readonly string[]).includes(upper)) return upper as DataType;
  return ALIASES[upper];
}

/** Igual que `normalizeDataType` pero cae a STRING para datos legados sin tipo válido. */
export function normalizeDataTypeOrString(raw: string | null | undefined): DataType {
  return normalizeDataType(raw) ?? 'STRING';
}

export interface TypeCheckResult {
  ok: boolean;
  /** Motivo legible, listo para el mensaje de error del contrato. */
  reason?: string;
}

/**
 * ¿Es `value` una instancia válida de `type`? No aplica restricciones (rango,
 * longitud, enum): eso es responsabilidad del motor de restricciones.
 */
export function checkTypeShape(type: DataType, value: unknown): TypeCheckResult {
  switch (type) {
    case 'INTEGER':
      return typeof value === 'number' && Number.isSafeInteger(value)
        ? { ok: true }
        : { ok: false, reason: 'expected a whole number' };
    case 'DECIMAL':
    case 'CURRENCY':
      return typeof value === 'number' && Number.isFinite(value)
        ? { ok: true }
        : { ok: false, reason: 'expected a finite number' };
    case 'PERCENTAGE':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, reason: 'expected a finite number' };
      }
      // Un porcentaje fuera de [0,100] casi siempre es una fracción mal escalada
      // (0.42 en vez de 42) y produce decisiones silenciosamente erróneas.
      return value >= 0 && value <= 100
        ? { ok: true }
        : { ok: false, reason: 'a percentage must be between 0 and 100' };
    case 'BOOLEAN':
      return typeof value === 'boolean'
        ? { ok: true }
        : { ok: false, reason: 'expected true or false' };
    case 'LIST':
      return Array.isArray(value) ? { ok: true } : { ok: false, reason: 'expected a list' };
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? { ok: true }
        : { ok: false, reason: 'expected an object' };
    case 'DATE':
      return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
        ? { ok: true }
        : { ok: false, reason: 'expected an ISO date (YYYY-MM-DD)' };
    case 'DATETIME':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? { ok: true }
        : { ok: false, reason: 'expected an ISO 8601 date-time' };
    case 'TIME':
      return typeof value === 'string' && ISO_TIME.test(value)
        ? { ok: true }
        : { ok: false, reason: 'expected a time (HH:MM[:SS])' };
    default:
      return typeof value === 'string' ? { ok: true } : { ok: false, reason: 'expected text' };
  }
}

/** ¿Puede un valor del tipo `from` alimentar un contrato que declara `to`? (§9.2) */
export function isTypeAssignable(from: DataType, to: DataType): boolean {
  if (from === to) return true;
  // Un entero satisface cualquier contrato numérico; lo inverso no (perdería precisión).
  if (from === 'INTEGER' && NUMERIC_TYPES.has(to)) return true;
  // Un porcentaje o un importe siguen siendo números decimales.
  if (NUMERIC_TYPES.has(from) && to === 'DECIMAL') return true;
  // Los tipos textuales especializados encajan en texto libre, no al revés.
  if (TEXTUAL_TYPES.has(from) && (to === 'STRING' || to === 'LONG_TEXT')) return true;
  if (from === 'STRUCTURED_RESULT' && to === 'OBJECT') return true;
  if (from === 'OBJECT' && to === 'STRUCTURED_RESULT') return true;
  return false;
}

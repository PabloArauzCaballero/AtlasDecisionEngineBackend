/**
 * Construcción de un valor VÁLIDO a partir del contrato de una variable (§10.3).
 *
 * Separado de `contract-generator.ts` porque son dos responsabilidades distintas: aquí se
 * responde «qué valor satisface ESTE contrato», allí «cómo se reparte un lote entre
 * válidos, frontera e inválidos». Mezclarlas era lo que hacía que las restricciones menos
 * frecuentes —`pattern`, `format`, `precision`, `itemType`— se quedaran sin cubrir dentro
 * de un `switch` por tipo que ya no cabía en la cabeza.
 *
 * ## La regla que gobierna este fichero
 *
 * Un valor VÁLIDO tiene que pasar `validateAgainstConstraints`, que es el mismo juez que
 * rechazará la ejecución después. Por eso todo valor se comprueba antes de devolverse y,
 * si no pasa, se repara con un valor derivado del propio contrato. Cuando ni así se
 * consigue, el contrato es contradictorio (`format: EMAIL` con `maxLength: 4`, `min`
 * mayor que `max`) y se dice explícitamente con `satisfied: false` en vez de entregar un
 * valor que miente.
 */
import {
  parseConstraints,
  resolveConstraints,
  validateAgainstConstraints,
} from '../../common/contracts/constraint-engine';
import type { VariableConstraints } from '../../common/contracts/constraints.types';
import { normalizeDataTypeOrString, type DataType } from '../../common/contracts/data-types';
import { documentSampleValue } from './document-samples';
import { sampleForPattern } from './pattern-samples';
import type { DistributionShape, SeededRandom } from './seeded-random';

/**
 * Cómo se reparten los valores de UNA variable dentro de su rango (§10.4).
 *
 * Sin esto el generador reparte uniformemente, que es justo lo que infrarrepresenta los
 * casos que más interesan: si el 3 % de la cartera real cobra el mínimo, un lote uniforme
 * apenas roza ese tramo y la política que lo rechaza mal se publica sin haberse probado.
 * La distribución NO relaja el contrato: sesga dónde caen los valores, nunca genera uno
 * que las restricciones prohíban.
 */
export interface VariableDistribution {
  shape?: DistributionShape;
  /** Pesos relativos por valor, solo para variables con enumeración cerrada. */
  valueWeights?: Record<string, number>;
}

export type DistributionMap = Readonly<Record<string, VariableDistribution>>;

export interface GeneratorContractVariable {
  code: string;
  dataType: string;
  required: boolean;
  nullable: boolean;
  defaultValue?: unknown;
  constraints?: unknown;
}

export interface ValidValueResult {
  value: unknown;
  /** `false` cuando ningún valor puede satisfacer el contrato tal como está declarado. */
  satisfied: boolean;
}

/** Intentos de generación antes de pasar a la reparación derivada del contrato. */
const GENERATION_ATTEMPTS = 4;
/** Longitud por defecto de un texto sin `minLength` declarado. */
const DEFAULT_MIN_LENGTH = 3;
/** Techo de longitud para un texto sin `maxLength`: un caso de prueba debe ser legible. */
const DEFAULT_MAX_LENGTH = 64;

export function resolvedConstraintsOf(variable: GeneratorContractVariable): VariableConstraints {
  return resolveConstraints(parseConstraints(variable.constraints), { siblings: {} });
}

/** ¿Acepta el contrato este valor? Mismo juez que usará la ejecución. */
export function satisfiesContract(variable: GeneratorContractVariable, value: unknown): boolean {
  return (
    validateAgainstConstraints(variable.dataType, parseConstraints(variable.constraints), value)
      .length === 0
  );
}

/**
 * Un valor válido para la variable, respetando TODAS sus restricciones.
 *
 * Los documentos son la única excepción declarada al juicio final: para el contrato
 * `extracto_pdf_base64` es un `STRING` cualquiera, pero rellenarlo con letras al azar
 * produce un caso inejecutable. Se antepone el documento sintético aunque su longitud
 * desborde un `maxLength` mal declarado, porque un PDF recortado no es un PDF.
 */
export function buildValidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
  distribution?: VariableDistribution,
): ValidValueResult {
  const document = documentSampleValue(variable.code, variable.dataType);
  if (document !== null) return { value: document, satisfied: true };

  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);

  let last: unknown;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    last = composeValue(type, constraints, random, distribution);
    if (satisfiesContract(variable, last)) return { value: last, satisfied: true };
  }

  for (const candidate of repairCandidates(type, constraints)) {
    if (satisfiesContract(variable, candidate)) return { value: candidate, satisfied: true };
  }
  return { value: last, satisfied: false };
}

function composeValue(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
  distribution?: VariableDistribution,
): unknown {
  if (constraints.allowedValues?.length) {
    return distribution?.valueWeights
      ? random.pickWeighted(constraints.allowedValues, (value) => weightFor(distribution, value))
      : random.pick(constraints.allowedValues);
  }

  const shape = distribution?.shape;
  switch (type) {
    case 'INTEGER':
      return integerValue(constraints, random, shape);
    case 'DECIMAL':
    case 'CURRENCY':
    case 'PERCENTAGE':
      return decimalValue(type, constraints, random, shape);
    case 'BOOLEAN':
      // Un booleano no tiene rango que deformar, pero sí proporción: el peso de `true`
      // frente al de `false` es exactamente lo que se quiere sesgar.
      return random.bool(booleanProbability(distribution));
    case 'DATE':
      return random.isoDate();
    case 'DATETIME':
      return `${random.isoDate()}T${pad(random.int(0, 23))}:${pad(random.int(0, 59))}:00Z`;
    case 'TIME':
      return `${pad(random.int(0, 23))}:${pad(random.int(0, 59))}`;
    case 'LIST':
      return listValue(constraints, random);
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return { valor: random.int(1, 100) };
    default:
      return textValue(type, constraints, random);
  }
}

/* ------------------------------------------------------------------ numéricos */

/**
 * Rango efectivo de un numérico: mezcla `min`/`max`, los límites exclusivos convertidos
 * al primer valor representable con la escala declarada, el techo que impone `precision`
 * y el rango natural del tipo.
 */
function numericRange(
  type: DataType,
  constraints: VariableConstraints,
  scale: number,
): [number, number] {
  const step = 10 ** -scale;
  let min = constraints.min ?? -(10 ** 6);
  let max = constraints.max ?? 10 ** 6;
  if (constraints.exclusiveMin !== undefined) min = Math.max(min, constraints.exclusiveMin + step);
  if (constraints.exclusiveMax !== undefined) max = Math.min(max, constraints.exclusiveMax - step);

  if (constraints.precision !== undefined) {
    // `significantDigits` cuenta los dígitos sin el separador decimal: con precisión 4 y
    // escala 2 el mayor admitido es 99,99, no 9999.
    const limit = 10 ** (constraints.precision - scale) - step;
    min = Math.max(min, -limit);
    max = Math.min(max, limit);
  }
  // Un porcentaje fuera de [0,100] lo rechaza ya la forma del tipo.
  if (type === 'PERCENTAGE') {
    min = Math.max(min, 0);
    max = Math.min(max, 100);
  }
  // Sin restricciones declaradas se mantiene el rango amable de siempre.
  if (constraints.min === undefined && constraints.exclusiveMin === undefined && min < 0) {
    min = 0;
  }
  if (constraints.max === undefined && constraints.exclusiveMax === undefined) {
    max = Math.min(max, type === 'INTEGER' ? 1_000 : type === 'PERCENTAGE' ? 100 : 10_000);
  }
  return [min, max];
}

function integerValue(
  constraints: VariableConstraints,
  random: SeededRandom,
  shape?: DistributionShape,
): number {
  const [min, max] = numericRange('INTEGER', constraints, 0);
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return upper < lower ? lower : random.int(lower, upper, shape);
}

function decimalValue(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
  shape?: DistributionShape,
): number {
  const scale = constraints.scale ?? 2;
  const [min, max] = numericRange(type, constraints, scale);
  const factor = 10 ** scale;
  // Se acotan los extremos ANTES de sortear: `random.float` redondea al final, y redondear
  // un valor pegado al borde lo empujaba fuera del rango (por debajo de `min` con escala 0,
  // o justo sobre un `exclusiveMax`).
  const lower = Math.ceil(min * factor) / factor;
  const upper = Math.floor(max * factor) / factor;
  if (upper < lower) return roundTo(lower, scale);
  const drawn = random.float(lower, upper, scale, shape);
  return roundTo(Math.min(upper, Math.max(lower, drawn)), scale);
}

/** Redondeo estable a `scale` decimales: `toFixed` evita los 0,30000000000000004. */
function roundTo(value: number, scale: number): number {
  return Number(value.toFixed(Math.max(0, Math.min(scale, 15))));
}

/* ---------------------------------------------------------------------- texto */

const FORMAT_ALPHABETS: Readonly<Record<string, readonly string[]>> = {
  ISO_COUNTRY: ['BO', 'PE', 'CL', 'AR', 'MX', 'CO', 'EC', 'UY'],
  ISO_CURRENCY: ['BOB', 'USD', 'PEN', 'CLP', 'ARS', 'MXN', 'COP'],
};

function textValue(type: DataType, constraints: VariableConstraints, random: SeededRandom): string {
  const [lower, upper] = lengthBounds(type, constraints);
  const fits = (candidate: string) => candidate.length >= lower && candidate.length <= upper;

  if (constraints.format) {
    const formatted = formatSample(constraints.format, random, upper);
    // El formato manda sobre la longitud: un correo recortado deja de ser un correo, y el
    // contrato contradictorio se denuncia con `satisfied: false` en vez de disimularse.
    if (formatted !== null) return formatted;
  }
  if (constraints.pattern) {
    const fromPattern = sampleForPattern(constraints.pattern, random, fits);
    if (fromPattern !== null) return fromPattern;
  }
  return random.string(random.int(lower, upper), alphabetFor(type));
}

/**
 * Longitudes admitidas, ya reconciliadas.
 *
 * El cálculo anterior partía de un mínimo por defecto de 3 y lo dejaba ganar sobre
 * `maxLength`: un contrato con `maxLength: 2` recibía tres caracteres. Aquí el máximo
 * declarado acota siempre al mínimo por defecto, y solo un `minLength` explícito puede
 * superarlo (contrato contradictorio, que sale por `satisfied: false`).
 */
function lengthBounds(type: DataType, constraints: VariableConstraints): [number, number] {
  const preferred = type === 'IDENTIFIER' ? 8 : DEFAULT_MIN_LENGTH;
  const ceiling = constraints.maxLength ?? DEFAULT_MAX_LENGTH;
  const lower =
    constraints.minLength !== undefined
      ? Math.max(0, constraints.minLength)
      : Math.max(0, Math.min(preferred, ceiling));
  const upper = Math.max(
    lower,
    Math.min(constraints.maxLength ?? Math.max(lower + 5, 12), DEFAULT_MAX_LENGTH),
  );
  return [lower, upper];
}

function alphabetFor(type: DataType): string {
  if (type === 'IDENTIFIER') return 'ABCDEF0123456789';
  if (type === 'CODE' || type === 'ENUM') return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
  return 'abcdefghijklmnopqrstuvwxyz0123456789';
}

/**
 * Valor que satisface un formato semántico. `null` para un formato desconocido, de modo
 * que el patrón o el texto genérico tomen el relevo en vez de inventar una forma.
 */
function formatSample(format: string, random: SeededRandom, maxLength: number): string | null {
  const enumerated = FORMAT_ALPHABETS[format];
  if (enumerated) return random.pick(enumerated);

  switch (format) {
    case 'EMAIL': {
      // Se encoge la parte local para caber en `maxLength` siempre que quepa un correo.
      const local = Math.max(1, Math.min(6, maxLength - '@ejemplo.test'.length));
      return `${random.string(local)}@ejemplo.test`;
    }
    case 'UUID': {
      const hex = (length: number) => random.string(length, '0123456789abcdef');
      return `${hex(8)}-${hex(4)}-4${hex(3)}-${random.pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
    }
    case 'URL':
      return `https://ejemplo.test/${random.string(Math.max(1, Math.min(8, maxLength - 21)))}`;
    case 'PHONE':
      return `+591${random.string(8, '0123456789')}`;
    case 'IBAN':
      return `${random.pick(['BO', 'ES', 'DE'])}${random.string(2, '0123456789')}${random.string(
        16,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      )}`;
    default:
      return null;
  }
}

/* --------------------------------------------------------------------- listas */

function listValue(constraints: VariableConstraints, random: SeededRandom): unknown[] {
  const ceiling = constraints.maxItems ?? Number.MAX_SAFE_INTEGER;
  const lower = Math.max(0, Math.min(constraints.minItems ?? 1, ceiling));
  const upper = Math.max(lower, Math.min(constraints.maxItems ?? Math.max(lower + 2, 3), 10));
  const size = random.int(lower, upper);
  const itemType = constraints.itemType ?? 'INTEGER';

  const items: unknown[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < size; index += 1) {
    let item = itemSample(itemType, index, random);
    // `unique` obliga a que los elementos sean distintos; el índice ya los separa para los
    // tipos derivados de él, pero un booleano o una enumeración corta pueden repetirse.
    for (let retry = 0; constraints.unique && seen.has(stableKey(item)) && retry < 8; retry += 1) {
      item = itemSample(itemType, index + (retry + 1) * 97, random);
    }
    seen.add(stableKey(item));
    items.push(item);
  }
  return items;
}

function itemSample(itemType: DataType, index: number, random: SeededRandom): unknown {
  switch (itemType) {
    case 'INTEGER':
      return index + 1;
    case 'DECIMAL':
    case 'CURRENCY':
      return roundTo(index + random.float(0, 1, 2), 2);
    case 'PERCENTAGE':
      return roundTo(random.float(0, 100, 2), 2);
    case 'BOOLEAN':
      return random.bool();
    case 'DATE':
      return random.isoDate();
    case 'DATETIME':
      return `${random.isoDate()}T00:00:00Z`;
    case 'TIME':
      return `${pad(random.int(0, 23))}:${pad(random.int(0, 59))}`;
    case 'LIST':
      return [index + 1];
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return { valor: index + 1 };
    default:
      return `${random.string(4, alphabetFor(itemType))}${index}`;
  }
}

function stableKey(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

/* ---------------------------------------------------------------- reparación */

/**
 * Valores derivados directamente del contrato, en orden de fidelidad. Se usan cuando el
 * sorteo no consiguió un valor aceptable: casi siempre es una combinación estrecha
 * (`allowedValues` junto a `min`, o una longitud exacta) que el azar no acierta.
 */
function repairCandidates(type: DataType, constraints: VariableConstraints): unknown[] {
  const candidates: unknown[] = [];
  if (constraints.allowedValues?.length) candidates.push(...constraints.allowedValues);

  const scale = constraints.scale ?? (type === 'INTEGER' ? 0 : 2);
  const [min, max] = numericRange(type, constraints, scale);
  candidates.push(roundTo(min, scale), roundTo(max, scale));

  if (constraints.minLength !== undefined) candidates.push('a'.repeat(constraints.minLength));
  if (constraints.maxLength !== undefined) candidates.push('a'.repeat(constraints.maxLength));

  const [lower] = [Math.max(0, constraints.minItems ?? 0)];
  candidates.push(Array.from({ length: lower }, (_, index) => index + 1));
  return candidates;
}

/* ------------------------------------------------------------------ auxiliares */

/** Peso declarado para un valor concreto de una enumeración; 1 cuando no se declaró. */
function weightFor(distribution: VariableDistribution | undefined, value: unknown): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 1;
  const declared = weights[String(value)];
  return declared === undefined ? 1 : declared;
}

/**
 * Proporción de `true` para un booleano sesgado. Se deriva de los mismos `valueWeights`
 * que las enumeraciones para no inventar una segunda forma de decir lo mismo.
 */
function booleanProbability(distribution: VariableDistribution | undefined): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 0.5;
  const positive = Math.max(0, Number(weights.true ?? weights.TRUE ?? 1));
  const negative = Math.max(0, Number(weights.false ?? weights.FALSE ?? 1));
  const total = positive + negative;
  return total > 0 ? positive / total : 0.5;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

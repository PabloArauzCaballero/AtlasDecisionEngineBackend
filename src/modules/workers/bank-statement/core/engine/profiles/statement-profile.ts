import type { CanonicalField } from '../generic/header-lexicon';

/**
 * Perfil de formato: **datos** que ajustan al motor generalista para una
 * plantilla concreta, sin escribir código.
 *
 * Es el escalón intermedio de la cascada. Cuando un formato se lee casi bien
 * con el motor generalista y solo falla en un detalle —un rótulo propio, una
 * convención numérica, un pie que estorba—, un perfil lo arregla y queda por
 * encima del generalista en confianza, pero siempre por debajo de un analizador
 * verificado.
 */
export interface StatementProfile {
  /** Identificador estable; forma el `id` de la estrategia. */
  readonly id: string;
  readonly institutionCode?: string;
  readonly institutionName?: string;
  /**
   * Todas deben aparecer en el documento para que el perfil se aplique. Se
   * exigen **todas** y no una cualquiera por la misma razón que un analizador
   * especializado exige tres marcas: un indicio suelto reclama documentos que no
   * le corresponden.
   */
  readonly documentSignals: readonly RegExp[];
  /** Rótulos propios de la plantilla, por campo canónico. */
  readonly headerAliases?: Readonly<Partial<Record<CanonicalField, readonly RegExp[]>>>;
  readonly decimalSeparator?: '.' | ',';
  readonly thousandSeparator?: '.' | ',' | '';
  /** `true` si el día va delante en las fechas de esta plantilla. */
  readonly dayFirst?: boolean;
  /** Renglones que nunca forman parte de la tabla. */
  readonly ignoredPatterns?: readonly RegExp[];
  /**
   * Techo de confianza del perfil. Por encima del generalista y por debajo de
   * un analizador verificado; el valor por defecto respeta ese orden.
   */
  readonly confidenceCeiling?: number;
}

/** Techo por defecto: mejor que deducir todo, peor que una plantilla medida. */
export const DEFAULT_PROFILE_CEILING = 0.92;

const CANONICAL_FIELDS: readonly CanonicalField[] = [
  'transactionDate',
  'valueDate',
  'time',
  'description',
  'reference',
  'documentNumber',
  'debit',
  'credit',
  'amount',
  'balance',
  'currency',
  'channel',
  'branch',
  'movementType',
];

export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProfileError';
  }
}

/**
 * Valida y convierte un perfil escrito en JSON.
 *
 * Un perfil llega como configuración, es decir, de fuera del código, y sus
 * patrones acaban compilados como expresiones regulares. Validarlo aquí evita
 * dos cosas distintas: un perfil incompleto que fallaría en mitad de una
 * conversión, y una expresión mal formada que reventaría al compilarse.
 */
export function parseStatementProfile(raw: unknown): StatementProfile {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidProfileError('Un perfil debe ser un objeto.');
  }
  const source = raw as Record<string, unknown>;

  const id = source['id'];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new InvalidProfileError('Un perfil necesita un `id` no vacío.');
  }

  const signals = toRegExpList(source['documentSignals'], `${id}.documentSignals`);
  if (signals.length === 0) {
    throw new InvalidProfileError(
      `El perfil ${id} necesita al menos una señal en \`documentSignals\`.`,
    );
  }

  const aliasesSource = source['headerAliases'];
  const headerAliases: Partial<Record<CanonicalField, readonly RegExp[]>> = {};
  if (aliasesSource !== undefined) {
    if (typeof aliasesSource !== 'object' || aliasesSource === null) {
      throw new InvalidProfileError(`El perfil ${id} tiene \`headerAliases\` que no es un objeto.`);
    }
    for (const [field, patterns] of Object.entries(aliasesSource)) {
      if (!CANONICAL_FIELDS.includes(field as CanonicalField)) {
        throw new InvalidProfileError(
          `El perfil ${id} usa el campo desconocido \`${field}\` en \`headerAliases\`.`,
        );
      }
      headerAliases[field as CanonicalField] = toRegExpList(
        patterns,
        `${id}.headerAliases.${field}`,
      );
    }
  }

  return {
    id,
    institutionCode: optionalString(source['institutionCode'], `${id}.institutionCode`),
    institutionName: optionalString(source['institutionName'], `${id}.institutionName`),
    documentSignals: signals,
    headerAliases,
    decimalSeparator: optionalSeparator(source['decimalSeparator'], id, ['.', ',']),
    thousandSeparator: optionalSeparator(source['thousandSeparator'], id, ['.', ',', '']),
    dayFirst: optionalBoolean(source['dayFirst'], `${id}.dayFirst`),
    ignoredPatterns: source['ignoredPatterns']
      ? toRegExpList(source['ignoredPatterns'], `${id}.ignoredPatterns`)
      : [],
    confidenceCeiling: optionalCeiling(source['confidenceCeiling'], id),
  };
}

export function parseStatementProfiles(raw: unknown): StatementProfile[] {
  if (!Array.isArray(raw)) {
    throw new InvalidProfileError('Los perfiles deben venir en un arreglo.');
  }
  const profiles = raw.map(parseStatementProfile);
  const identifiers = new Set<string>();
  for (const profile of profiles) {
    if (identifiers.has(profile.id)) {
      throw new InvalidProfileError(`Hay dos perfiles con el id ${profile.id}.`);
    }
    identifiers.add(profile.id);
  }
  return profiles;
}

function toRegExpList(value: unknown, path: string): RegExp[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new InvalidProfileError(`\`${path}\` debe ser un arreglo de patrones.`);
  }
  return value.map((pattern) => {
    if (typeof pattern !== 'string') {
      throw new InvalidProfileError(`\`${path}\` solo admite cadenas.`);
    }
    try {
      return new RegExp(pattern, 'i');
    } catch {
      throw new InvalidProfileError(
        `\`${path}\` contiene una expresión regular inválida: ${pattern}`,
      );
    }
  });
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new InvalidProfileError(`\`${path}\` debe ser una cadena.`);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new InvalidProfileError(`\`${path}\` debe ser booleano.`);
  }
  return value;
}

function optionalSeparator<T extends string>(
  value: unknown,
  id: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new InvalidProfileError(
      `El perfil ${id} usa un separador no admitido: ${JSON.stringify(value)}`,
    );
  }
  return value as T;
}

function optionalCeiling(value: unknown, id: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || value <= 0 || value > 1) {
    throw new InvalidProfileError(`El perfil ${id} necesita un \`confidenceCeiling\` entre 0 y 1.`);
  }
  return value;
}

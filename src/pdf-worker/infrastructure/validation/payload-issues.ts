/**
 * Traduce los problemas de Zod al vocabulario del §7: campo, problema, regla esperada y —sólo
 * cuando ayuda— el valor recibido.
 *
 * El mensaje por defecto de Zod es correcto y está en inglés («Too small: expected string to
 * have >=1 characters»). Quien recibe este error es un integrador leyendo un 422 a las tres de
 * la mañana; que le llegue en el idioma del resto de la plataforma no es cosmético, es la
 * diferencia entre corregir el payload y abrir una incidencia.
 *
 * El valor recibido se RECORTA y se resume. Un payload puede llevar el nombre y el documento
 * de identidad de una persona, y este texto acaba en un log y en una respuesta HTTP (§33).
 */
import type { $ZodIssue } from 'zod/v4/core';
import type { PayloadIssue } from '../../domain/errors/pdf-worker.errors';

const MAX_RECEIVED = 60;

const TYPE_NAMES: Readonly<Record<string, string>> = {
  string: 'texto',
  number: 'número',
  boolean: 'booleano',
  array: 'lista',
  object: 'objeto',
  date: 'fecha',
  bigint: 'entero grande',
  null: 'nulo',
  undefined: 'ausente',
};

function spanishType(name: string): string {
  return TYPE_NAMES[name] ?? name;
}

/** Representación breve y segura del valor que llegó. */
export function describeReceived(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'string') {
    const trimmed = value.length > MAX_RECEIVED ? `${value.slice(0, MAX_RECEIVED)}…` : value;
    return JSON.stringify(trimmed);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `lista de ${value.length} elemento(s)`;
  if (typeof value === 'object') return `objeto con ${Object.keys(value).length} clave(s)`;
  return typeof value;
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

function pathOf(issue: $ZodIssue): string {
  const path = issue.path ?? [];
  return path.length === 0 ? '(raíz)' : path.map((part) => String(part)).join('.');
}

/** Un problema de Zod, dicho en español y con la regla que se incumplió. */
export function toPayloadIssue(issue: $ZodIssue, root: unknown): PayloadIssue {
  const field = pathOf(issue);
  const received = describeReceived(valueAt(root, issue.path ?? []));

  switch (issue.code) {
    case 'invalid_type':
      return {
        field,
        problem: received === undefined ? 'campo obligatorio ausente' : 'el tipo no corresponde',
        expected: spanishType(String(issue.expected)),
        received,
      };
    case 'invalid_value':
      return {
        field,
        problem: 'valor fuera del conjunto admitido',
        expected: `uno de: ${(issue.values ?? []).map((value) => String(value)).join(', ')}`,
        received,
      };
    case 'too_small':
      return {
        field,
        problem: 'valor por debajo del mínimo',
        expected: `${issue.inclusive ? '≥' : '>'} ${String(issue.minimum)}`,
        received,
      };
    case 'too_big':
      return {
        field,
        problem: 'valor por encima del máximo',
        expected: `${issue.inclusive ? '≤' : '<'} ${String(issue.maximum)}`,
        received,
      };
    case 'invalid_format':
      return {
        field,
        problem: 'el formato no es válido',
        expected: String(issue.format),
        received,
      };
    case 'unrecognized_keys':
      return {
        field: field === '(raíz)' ? (issue.keys?.[0] ?? '(raíz)') : field,
        problem: 'campo no reconocido por el contrato',
        expected: `retire: ${(issue.keys ?? []).join(', ')}`,
      };
    case 'invalid_union':
      return { field, problem: 'no encaja con ninguna de las formas admitidas', received };
    default:
      return { field, problem: issue.message, received };
  }
}

export function toPayloadIssues(
  issues: readonly $ZodIssue[],
  root: unknown,
): readonly PayloadIssue[] {
  return issues.map((issue) => toPayloadIssue(issue, root));
}

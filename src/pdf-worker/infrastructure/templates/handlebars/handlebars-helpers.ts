/**
 * Juego CERRADO de ayudantes de plantilla.
 *
 * Cerrado en el sentido literal: el motor se compila con `knownHelpersOnly`, así que invocar
 * algo que no esté aquí es un error de compilación de la plantilla y no una llamada a lo
 * desconocido. Eso convierte una errata (`{{fmtNumer x}}`) en un fallo al arrancar en vez de
 * en un hueco silencioso dentro del PDF.
 *
 * Ninguno de estos ayudantes devuelve HTML sin escapar. Los que necesitan marcado —el badge de
 * estado— lo construyen con `Handlebars.SafeString` a partir de piezas que ellos mismos
 * fabrican, nunca concatenando el valor de entrada (§24).
 */
import Handlebars from 'handlebars';
import {
  DEFAULT_LOCALE,
  formatDate,
  formatDateTime,
  formatNumber,
} from '../../../application/services/formatting';

/** Palabras que la plataforma trata como estado, y el token de color al que van. */
const SEVERITY_BY_WORD: Readonly<Record<string, 'positive' | 'caution' | 'critical' | 'neutral'>> =
  {
    APPROVED: 'positive',
    APROBADO: 'positive',
    OK: 'positive',
    PASSED: 'positive',
    REVIEW: 'caution',
    REVISION: 'caution',
    PENDING: 'caution',
    WARNING: 'caution',
    REJECTED: 'critical',
    RECHAZADO: 'critical',
    FAILED: 'critical',
    ERROR: 'critical',
  };

/**
 * Contexto raíz que el compositor garantiza.
 *
 * Los tipos de Handlebars declaran `options.data` como `any`, así que sin este acotado cada
 * lectura sería un acceso sin comprobar. Se declara la forma MÍNIMA que se usa y se lee con
 * encadenamiento opcional: un ayudante invocado desde una plantilla suelta —en una prueba, por
 * ejemplo— no tiene por qué traer `meta`, y ahí el respaldo es la respuesta correcta.
 */
interface HelperRoot {
  readonly meta?: { readonly locale?: string; readonly timezone?: string };
}

function rootOf(options: Handlebars.HelperOptions): HelperRoot | undefined {
  const data = options.data as { root?: unknown } | undefined;
  const root = data?.root;
  return root !== null && typeof root === 'object' ? (root as HelperRoot) : undefined;
}

function localeOf(options: Handlebars.HelperOptions): string {
  return rootOf(options)?.meta?.locale ?? DEFAULT_LOCALE;
}

function timezoneOf(options: Handlebars.HelperOptions): string {
  return rootOf(options)?.meta?.timezone ?? 'UTC';
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

export const HELPER_NAMES = [
  'eq',
  'ne',
  'gt',
  'lt',
  'and',
  'or',
  'not',
  'inc',
  'cell',
  'join',
  'fallback',
  'fmtNumber',
  'fmtDate',
  'fmtDateTime',
  'fmtValue',
  'severity',
  'isEmpty',
] as const;

export function registerHelpers(env: typeof Handlebars): void {
  env.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  env.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  env.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  env.registerHelper('lt', (a: unknown, b: unknown) => Number(a) < Number(b));
  env.registerHelper('and', (a: unknown, b: unknown) => Boolean(a) && Boolean(b));
  env.registerHelper('or', (a: unknown, b: unknown) => Boolean(a) || Boolean(b));
  env.registerHelper('not', (a: unknown) => !a);
  env.registerHelper('inc', (a: unknown) => Number(a) + 1);
  env.registerHelper(
    'isEmpty',
    (a: unknown) => a === undefined || a === null || (Array.isArray(a) && a.length === 0),
  );

  /**
   * Celda de una tabla de columnas dinámicas.
   *
   * `{{cell row column.key}}` en vez de `{{lookup row column.key}}` porque además de buscar
   * hay que DECIDIR cómo se pinta un valor que puede ser texto, número, booleano o faltar. Sin
   * esto, un `false` se imprimía como vacío y un `null` como «null».
   */
  env.registerHelper(
    'cell',
    function cell(row: unknown, key: unknown, options: Handlebars.HelperOptions) {
      if (row === null || typeof row !== 'object' || typeof key !== 'string') return '—';
      // `Object.hasOwn` y no `row[key]`: impide que una clave como `constructor` o `__proto__`
      // alcance la cadena de prototipos desde datos que llegaron por la red.
      if (!Object.hasOwn(row as Record<string, unknown>, key)) return '—';
      return formatValue((row as Record<string, unknown>)[key], localeOf(options));
    },
  );

  env.registerHelper('fmtValue', (value: unknown, options: Handlebars.HelperOptions) =>
    formatValue(value, localeOf(options)),
  );

  env.registerHelper(
    'fmtNumber',
    (value: unknown, digits: unknown, options: Handlebars.HelperOptions) => {
      const resolved = typeof digits === 'number' ? digits : undefined;
      const opts = typeof digits === 'object' ? (digits as Handlebars.HelperOptions) : options;
      return formatNumber(Number(value), localeOf(opts), resolved);
    },
  );

  env.registerHelper('fmtDate', (value: unknown, options: Handlebars.HelperOptions) => {
    const date = toDate(value);
    return date ? formatDate(date, localeOf(options), timezoneOf(options)) : '—';
  });

  env.registerHelper('fmtDateTime', (value: unknown, options: Handlebars.HelperOptions) => {
    const date = toDate(value);
    return date ? formatDateTime(date, localeOf(options), timezoneOf(options)) : '—';
  });

  env.registerHelper('join', (value: unknown, separator: unknown) =>
    Array.isArray(value)
      ? value.map((item) => String(item)).join(typeof separator === 'string' ? separator : ', ')
      : '',
  );

  env.registerHelper('fallback', (value: unknown, alternative: unknown) =>
    value === undefined || value === null || value === '' ? alternative : value,
  );

  /** Devuelve el nombre del token de color; NO devuelve marcado. Lo aplica la hoja de estilo. */
  env.registerHelper('severity', (value: unknown) => {
    if (typeof value !== 'string') return 'neutral';
    return SEVERITY_BY_WORD[value.trim().toUpperCase()] ?? 'neutral';
  });
}

function formatValue(value: unknown, locale: string): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return formatNumber(value, locale);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') {
    // Un objeto anidado dentro de una celda es un error del payload, no algo que imprimir.
    // `[object Object]` dentro de un informe corporativo es peor que un guion.
    return '—';
  }
  return String(value);
}

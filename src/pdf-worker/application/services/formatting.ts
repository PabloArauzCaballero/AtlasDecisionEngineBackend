/**
 * Formato de fechas y números, con red de seguridad.
 *
 * `Intl` LANZA con un locale o una zona horaria inválidos, y esos dos valores llegan en la
 * petición. Sin este envoltorio, un `timezone: "Bolivia/LaPaz"` —que no existe— no produce
 * una fecha rara: tumba la generación entera con un `RangeError` en mitad del render, lejos
 * del sitio donde se puede explicar qué pasó. Aquí se degrada al valor por defecto y se sigue.
 *
 * El valor por defecto NO es la zona del proceso. Un contenedor corre en UTC y el mismo
 * informe fechado a las 03:00 confunde a quien lo lee en La Paz; declararlo explícitamente
 * hace que el defecto sea una decisión y no un accidente del despliegue.
 */
export const DEFAULT_LOCALE = 'es-BO';
export const DEFAULT_TIMEZONE = 'America/La_Paz';

function safeFormatter(locale: string, timezone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: timezone });
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, { ...options, timeZone: DEFAULT_TIMEZONE });
  }
}

export function formatDateTime(value: Date, locale: string, timezone: string): string {
  return safeFormatter(locale, timezone, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(value);
}

export function formatDate(value: Date, locale: string, timezone: string): string {
  return safeFormatter(locale, timezone, { dateStyle: 'long' }).format(value);
}

export function formatNumber(value: number, locale: string, fractionDigits?: number): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits ?? 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
  }
}

/** Normaliza lo que llegó en la petición; nunca devuelve algo que haga estallar a `Intl`. */
export function resolveLocale(candidate: string | undefined): string {
  if (!candidate || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(candidate)) return DEFAULT_LOCALE;
  try {
    return new Intl.Locale(candidate).toString();
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function resolveTimezone(candidate: string | undefined): string {
  if (!candidate || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(candidate)) {
    return DEFAULT_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

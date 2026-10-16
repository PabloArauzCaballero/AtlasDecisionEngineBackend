import type { Logger } from '@nestjs/common';
import { SqlConsoleQueryError } from './query-executor.types';

/** Traduce el error de la base a uno que la consola puede enseñar sin filtrar detalles. */
export function translateQueryError(
  error: unknown,
  timeoutMs: number,
  logger: Logger,
): SqlConsoleQueryError {
  if (error instanceof SqlConsoleQueryError) return error;
  const known = error as { code?: string; meta?: { code?: string; message?: string } };
  const pgCode = known.meta?.code ?? known.code ?? '';
  const message = known.meta?.message ?? (error instanceof Error ? error.message : '');

  // 42601 sintaxis · 42703 columna inexistente · 42P01 relación inexistente · 42883 función
  if (['42601', '42703', '42P01', '42883', '42804', '42P18'].includes(pgCode)) {
    return new SqlConsoleQueryError('SQL_INVALID', 'La consulta no es válida.', message);
  }
  if (pgCode === '57014' || /statement timeout|canceling statement/i.test(message)) {
    return new SqlConsoleQueryError(
      'SQL_TIMEOUT',
      `La consulta superó el límite de ${Math.round(timeoutMs / 1000)} segundos. ` +
        'Acota el rango de fechas o agrega antes de cruzar.',
    );
  }
  if (pgCode === '42501' || /permission denied/i.test(message)) {
    return new SqlConsoleQueryError(
      'SQL_FORBIDDEN',
      'La consulta intenta alcanzar datos que la consola no publica.',
    );
  }
  if (/ATLAS_SQL_TENANT_NOT_SET/.test(message)) {
    return new SqlConsoleQueryError(
      'SQL_TENANT_MISSING',
      'La sesión no tiene organización asociada; vuelve a entrar al portal.',
    );
  }
  logger.error(`Unexpected SQL console failure (${pgCode || 'sin código'})`, error);
  return new SqlConsoleQueryError('SQL_FAILED', 'La consulta no se pudo completar.');
}

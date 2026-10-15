/** Los valores que la búsqueda prueba para una variable: umbrales, vecinos y sondas numéricas. */

export const ABSENT = Symbol('ausente');
const NUMERIC_PROBES = [0, 1, 2, 5, 10, 50, 100, 1000, 10_000];

export function isInteger(dataType: string): boolean {
  return ['INTEGER', 'INT', 'LONG', 'BIGINT'].includes(dataType.trim().toUpperCase());
}

export function isNumeric(dataType: string): boolean {
  return (
    isInteger(dataType) ||
    ['DECIMAL', 'NUMBER', 'FLOAT', 'DOUBLE', 'MONEY', 'PERCENTAGE'].includes(
      dataType.trim().toUpperCase(),
    )
  );
}

export function isBoolean(dataType: string): boolean {
  return ['BOOLEAN', 'BOOL'].includes(dataType.trim().toUpperCase());
}

/** Un literal y sus vecinos: el umbral, justo por debajo y justo por encima. */
function around(literal: unknown, integer: boolean): unknown[] {
  if (typeof literal !== 'number' || !Number.isFinite(literal)) return [literal];
  const step = integer ? 1 : Math.max(Math.abs(literal) * 0.05, 0.01);
  const round = (value: number) =>
    integer ? Math.round(value) : Math.round(value * 10_000) / 10_000;
  return [literal, round(literal - step), round(literal + step)];
}

export function distinct(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value === ABSENT ? '\u0000ausente' : JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function candidateValues(
  dataType: string,
  literals: unknown[],
  extra: unknown[],
): unknown[] {
  const values: unknown[] = [...extra];
  for (const literal of literals) values.push(...around(literal, isInteger(dataType)));
  if (isBoolean(dataType)) values.push(true, false);
  // Un texto distinto de todos los que el grafo compara: el «ninguno de los anteriores».
  if (literals.some((literal) => typeof literal === 'string')) values.push('OTRO_VALOR');
  if (isNumeric(dataType)) values.push(...NUMERIC_PROBES);
  return values;
}

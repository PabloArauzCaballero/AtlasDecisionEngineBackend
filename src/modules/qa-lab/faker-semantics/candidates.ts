export function section(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const persona = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'persona')[key],
];
export const direccion = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'direccion')[key],
];
export const finanzas = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'perfilFinanciero')[key],
];
export const cuenta = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'cuentaBancaria')[key],
];
export const dispositivo = (key: string) => (record: Record<string, unknown>) => [
  section(record, 'dispositivo')[key],
];
export const snapshot = (key: string) => (record: Record<string, unknown>) => [
  section(section(record, 'dispositivo'), 'snapshot')[key],
];
export const comercio = (key: string) => (record: Record<string, unknown>) => [record[key]];

/** El teléfono admite dos formas: internacional (+591…) y los 8 dígitos nacionales. */
export function phoneCandidates(value: unknown): unknown[] {
  const text = String(value ?? '');
  const national = text.replace(/^\+591/, '');
  return [text, national];
}

/** El género se escribe de muchas maneras según quién diseñó el contrato. */
export function genderCandidates(value: unknown): unknown[] {
  if (value === 'F') return ['F', 'FEMENINO', 'Femenino', 'MUJER', 'FEMALE', 'female', 'f'];
  if (value === 'M') return ['M', 'MASCULINO', 'Masculino', 'HOMBRE', 'MALE', 'male', 'm'];
  return [value];
}

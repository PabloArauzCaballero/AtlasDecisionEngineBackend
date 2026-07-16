import type { ValidationIssue } from '../graph.types';

export function issue(
  code: string,
  message: string,
  entityType?: ValidationIssue['entityType'],
  entityKey?: string,
  severity: ValidationIssue['severity'] = 'ERROR',
): ValidationIssue {
  return { code, message, severity, entityType, entityKey };
}

export function reportDuplicates(
  values: string[],
  code: string,
  entityType: ValidationIssue['entityType'],
  errors: ValidationIssue[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  for (const value of duplicates) {
    errors.push(issue(code, `Duplicate ${entityType?.toLowerCase()} identifier ${value}`, entityType, value));
  }
}

export function duplicateValues(values: number[]): number[] {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  values.forEach((value) => (seen.has(value) ? duplicates.add(value) : seen.add(value)));
  return [...duplicates];
}

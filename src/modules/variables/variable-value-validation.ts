import { MetricsService } from '../../common/observability/metrics.service';
import { safeRegexTest } from '../../common/validation/safe-regex';
import {
  parseConstraints,
  validateAgainstConstraints,
} from '../../common/contracts/constraint-engine';
import type { ConstraintScope } from '../../common/contracts/constraints.types';
import type { VariableContractSnapshot } from '../graph/graph.types';

export function validateValue(
  metrics: MetricsService,
  contract: VariableContractSnapshot,
  value: unknown,
  siblings: Record<string, unknown>,
  scope: ConstraintScope | undefined,
): string[] {
  const errors: string[] = [];
  // Restricciones normalizadas (§1.1). `constraints` es la fuente autoritativa;
  // `validationSchema` se sigue leyendo para contratos anteriores a la migración.
  const constraints = parseConstraints(contract.constraints ?? contract.validationSchema);
  const violations = validateAgainstConstraints(contract.dataType, constraints, value, {
    ...scope,
    siblings,
  });
  for (const violation of violations) {
    // §12: qué restricción se incumple, no solo cuántas veces falla la variable.
    metrics.recordContractViolation('INPUT', violation.constraint);
    errors.push(
      contract.validationMessage
        ? `${contract.code}: ${contract.validationMessage}`
        : `${contract.code} ${violation.message}`,
    );
  }

  for (const rule of contract.validationRules) {
    const config = rule.config as Record<string, unknown>;
    switch (rule.ruleType.toUpperCase()) {
      case 'MIN':
        if (typeof value === 'number' && value < Number(config.value))
          errors.push(`${rule.errorCode}: below minimum`);
        break;
      case 'MAX':
        if (typeof value === 'number' && value > Number(config.value))
          errors.push(`${rule.errorCode}: above maximum`);
        break;
      case 'REGEX':
        if (typeof value === 'string' && !safeRegexTest(String(config.pattern), value).matched)
          errors.push(`${rule.errorCode}: pattern mismatch`);
        break;
      case 'ENUM':
        if (Array.isArray(config.values) && !config.values.includes(value))
          errors.push(`${rule.errorCode}: value not allowed`);
        break;
    }
  }
  return errors;
}

/**
 * Coherencia del contrato de ENTRADA antes de publicar (§1.2).
 *
 * El motor ya valida cada petición contra las restricciones en ejecución
 * (`variable-resolution.service`), pero eso descubre un contrato imposible en la
 * primera decisión real, no al publicarlo. Aquí se comprueba estáticamente lo que
 * se puede saber sin datos: que las restricciones declaradas admitan algún valor,
 * que el valor por defecto y los ejemplos las cumplan, y que no se declaren
 * restricciones que el tipo ignora en silencio.
 *
 * Todo lo que se afirma aquí se reevalúa igualmente en ejecución: esto adelanta el
 * fallo, nunca lo sustituye.
 */
import { checkConstraintCoherence } from '../../../common/contracts/constraint-coherence';
import {
  parseConstraints,
  validateAgainstConstraints,
} from '../../../common/contracts/constraint-engine';
import {
  NUMERIC_TYPES,
  TEXTUAL_TYPES,
  normalizeDataType,
  type DataType,
} from '../../../common/contracts/data-types';
import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import { issue } from './validation-issue';

export interface GraphInputContractResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Restricciones que sólo significan algo para ciertas familias de tipos. */
const NUMERIC_ONLY = ['min', 'max', 'exclusiveMin', 'exclusiveMax', 'precision', 'scale'] as const;
const TEXTUAL_ONLY = ['minLength', 'maxLength', 'pattern', 'format'] as const;
const LIST_ONLY = ['minItems', 'maxItems', 'unique', 'itemType'] as const;

export function validateInputContract(snapshot: ArtifactGraphSnapshot): GraphInputContractResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const inputs = snapshot.variables.filter(
    (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
  );

  for (const input of inputs) {
    const dataType = normalizeDataType(input.dataType);
    if (!dataType) {
      errors.push(
        issue(
          'INPUT_DATA_TYPE_UNKNOWN',
          `La entrada ${input.code} declara el tipo ${input.dataType}, que no está en el catálogo canónico`,
          'VARIABLE',
          input.code,
        ),
      );
      continue;
    }

    const constraints = parseConstraints(input.constraints ?? input.validationSchema);

    // 1. Restricciones imposibles: ningún valor podría satisfacerlas nunca.
    for (const problem of checkConstraintCoherence(constraints)) {
      errors.push(
        issue(
          `INPUT_${problem.code}`,
          `La entrada ${input.code} tiene restricciones incoherentes — ${problem.message}`,
          'VARIABLE',
          input.code,
        ),
      );
    }

    // 2. Restricciones que el tipo ignora: no rompen nada, pero prometen un
    //    control que el motor no aplicará. Aviso, no error.
    for (const name of inapplicable(dataType, constraints)) {
      warnings.push(
        issue(
          'INPUT_CONSTRAINT_NOT_APPLICABLE',
          `La entrada ${input.code} declara «${name}», que no aplica al tipo ${dataType} y no se comprobará`,
          'VARIABLE',
          input.code,
          'WARNING',
        ),
      );
    }

    // 3. El valor por defecto se inyecta cuando el dato no llega: si incumple el
    //    contrato, la política de respaldo metería un valor inválido en la decisión.
    if (input.defaultValue !== undefined && input.defaultValue !== null) {
      for (const violation of validateAgainstConstraints(
        dataType,
        constraints,
        input.defaultValue,
      )) {
        errors.push(
          issue(
            'INPUT_DEFAULT_VALUE_INVALID',
            `El valor por defecto de ${input.code} ${violation.message}`,
            'VARIABLE',
            input.code,
          ),
        );
      }
    }
    if (input.defaultValue === null && !input.nullable) {
      errors.push(
        issue(
          'INPUT_NULL_DEFAULT_ON_NON_NULLABLE',
          `El valor por defecto de ${input.code} es nulo pero la entrada no admite nulos`,
          'VARIABLE',
          input.code,
        ),
      );
    }

    // 4. Los ejemplos declarados deben hacer lo que prometen. Un ejemplo válido
    //    que el contrato rechaza documenta mal la entrada a quien la integra.
    if (input.exampleValid !== undefined && input.exampleValid !== null) {
      const violations = validateAgainstConstraints(dataType, constraints, input.exampleValid);
      if (violations.length) {
        warnings.push(
          issue(
            'INPUT_EXAMPLE_VALID_REJECTED',
            `El ejemplo válido de ${input.code} no cumple su propio contrato: ${violations
              .map((violation) => violation.message)
              .join('; ')}`,
            'VARIABLE',
            input.code,
            'WARNING',
          ),
        );
      }
    }
    if (input.exampleInvalid !== undefined && input.exampleInvalid !== null) {
      if (!validateAgainstConstraints(dataType, constraints, input.exampleInvalid).length) {
        warnings.push(
          issue(
            'INPUT_EXAMPLE_INVALID_ACCEPTED',
            `El ejemplo inválido de ${input.code} es aceptado por el contrato: no demuestra nada`,
            'VARIABLE',
            input.code,
            'WARNING',
          ),
        );
      }
    }
  }

  return { errors, warnings };
}

/** Nombres de restricciones declaradas que el tipo no llega a comprobar. */
function inapplicable(dataType: DataType, constraints: VariableConstraints): string[] {
  const isNumeric = NUMERIC_TYPES.has(dataType);
  const isTextual = TEXTUAL_TYPES.has(dataType);
  const isList = dataType === 'LIST';

  const declared = (names: readonly (keyof VariableConstraints)[]) =>
    names.filter((name) => constraints[name] !== undefined);

  const names: string[] = [];
  if (!isNumeric) names.push(...declared(NUMERIC_ONLY));
  if (!isTextual) names.push(...declared(TEXTUAL_ONLY));
  if (!isList) names.push(...declared(LIST_ONLY));
  return names;
}

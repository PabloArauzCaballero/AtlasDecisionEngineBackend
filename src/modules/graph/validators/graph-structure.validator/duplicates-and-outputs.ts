import { issue, reportDuplicates } from '../validation-issue';
import type { StructureContext } from './context';

export function checkDuplicates(context: StructureContext): void {
  const { snapshot, errors } = context;
  reportDuplicates(
    snapshot.nodes.map((node) => node.key),
    'DUPLICATE_NODE_KEY',
    'NODE',
    errors,
  );
  reportDuplicates(
    snapshot.edges.map((edge) => edge.key),
    'DUPLICATE_EDGE_KEY',
    'EDGE',
    errors,
  );
  reportDuplicates(
    snapshot.conditions.map((condition) => condition.code),
    'DUPLICATE_CONDITION_CODE',
    'CONDITION',
    errors,
  );
  reportDuplicates(
    snapshot.actions.map((action) => action.code),
    'DUPLICATE_ACTION_CODE',
    'ACTION',
    errors,
  );
  reportDuplicates(
    snapshot.variables.map((variable) => variable.code),
    'DUPLICATE_VARIABLE_CODE',
    'VARIABLE',
    errors,
  );
}

export function checkOutputs(context: StructureContext): void {
  const { errors, outputs } = context;
  const primaryOutputs = outputs.filter((variable) => variable.usageType === 'OUTPUT_PRIMARY');
  if (outputs.length && primaryOutputs.length !== 1) {
    errors.push(
      issue(
        'PRIMARY_OUTPUT_COUNT',
        `A graph with outputs requires exactly one OUTPUT_PRIMARY dependency; found ${primaryOutputs.length}`,
      ),
    );
  }
  for (const primary of primaryOutputs) {
    if (
      ![
        'STRING',
        'TEXT',
        'ENUM',
        'BOOLEAN',
        'BOOL',
        'INTEGER',
        'INT',
        'NUMBER',
        'DECIMAL',
        'FLOAT',
      ].includes(primary.dataType.toUpperCase())
    ) {
      errors.push(
        issue(
          'PRIMARY_OUTPUT_TYPE_INVALID',
          `Primary output ${primary.code} must be scalar`,
          'VARIABLE',
          primary.code,
        ),
      );
    }
  }
  for (const variable of outputs) {
    if (variable.dependencyPath !== `output.${variable.code}`) {
      errors.push(
        issue(
          'OUTPUT_PATH_INVALID',
          `Output ${variable.code} must use dependencyPath output.${variable.code}`,
          'VARIABLE',
          variable.code,
        ),
      );
    }
  }
}

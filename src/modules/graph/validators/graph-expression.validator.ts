import type { ExpressionEvaluator } from '../expression-evaluator';
import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import { extractTemplateReferences } from '../template-reference';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphExpressionResult {
  errors: ValidationIssue[];
}

/** Expression/template rules: every `{{ }}` placeholder and JSON-AST expression must reference a declared variable. */
export function validateGraphExpressions(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
  expressions: ExpressionEvaluator,
): GraphExpressionResult {
  const errors: ValidationIssue[] = [];

  const validateExpressionReferences = (
    expression: unknown,
    entityType: ValidationIssue['entityType'],
    entityKey: string,
    label: string,
  ): void => {
    try {
      const references = expressions.referencedVariables(expression);
      for (const variable of references) {
        const normalized = variable.startsWith('variables.')
          ? variable.slice('variables.'.length).split('.')[0]
          : variable.split('.')[0];
        if (normalized === 'decision') continue;
        if (!lookups.variableCodes.has(normalized)) {
          errors.push(
            issue(
              'UNDECLARED_VARIABLE_DEPENDENCY',
              `${label} references undeclared variable ${variable}`,
              entityType,
              entityKey,
            ),
          );
        }
      }
    } catch (error) {
      errors.push(
        issue(
          'INVALID_EXPRESSION',
          `${label} is invalid: ${error instanceof Error ? error.message : String(error)}`,
          entityType,
          entityKey,
        ),
      );
    }
  };

  const validateTemplateReferences = (
    value: unknown,
    entityType: ValidationIssue['entityType'],
    entityKey: string,
  ): void => {
    for (const path of extractTemplateReferences(value)) {
      if (path.startsWith('decision.')) continue;
      const code = path.startsWith('variables.')
        ? path.slice('variables.'.length).split('.')[0]
        : path.split('.')[0];
      if (!lookups.variableCodes.has(code)) {
        errors.push(
          issue(
            'UNDECLARED_TEMPLATE_VARIABLE',
            `Template references undeclared variable ${path}`,
            entityType,
            entityKey,
          ),
        );
      }
    }
  };

  for (const action of snapshot.actions) {
    if (action.payload.valueExpression !== undefined) {
      validateExpressionReferences(
        action.payload.valueExpression,
        'ACTION',
        action.code,
        `Action ${action.code}`,
      );
    }
    validateTemplateReferences(action.payload, 'ACTION', action.code);
    for (const reason of action.reasonCodes) {
      validateTemplateReferences(reason.publicMessage, 'ACTION', action.code);
      validateTemplateReferences(reason.internalMessage, 'ACTION', action.code);
    }
  }

  for (const node of snapshot.nodes.filter((candidate) => candidate.type === 'RESULT')) {
    const assignments = Array.isArray(node.config.assignments) ? node.config.assignments : [];
    for (const raw of assignments) {
      const assignment = raw as Record<string, unknown>;
      if (String(assignment.source ?? '').toUpperCase() === 'EXPRESSION') {
        validateExpressionReferences(
          assignment.expression ?? assignment.valueExpression,
          'NODE',
          node.key,
          `RESULT node ${node.key}`,
        );
      }
      if (String(assignment.source ?? '').toUpperCase() === 'TEMPLATE') {
        validateTemplateReferences(assignment.value, 'NODE', node.key);
      }
      if (String(assignment.source ?? '').toUpperCase() === 'VARIABLE') {
        validateExpressionReferences(
          { var: String(assignment.variablePath ?? assignment.path ?? '') },
          'NODE',
          node.key,
          `RESULT node ${node.key}`,
        );
      }
    }
  }

  for (const node of snapshot.nodes) {
    if (node.config.scoreExpression !== undefined) {
      validateExpressionReferences(
        node.config.scoreExpression,
        'NODE',
        node.key,
        `Node ${node.key} scoreExpression`,
      );
    }
    if (Array.isArray(node.config.components)) {
      for (const [index, rawComponent] of node.config.components.entries()) {
        const component = rawComponent as Record<string, unknown>;
        if (component.pointsExpression !== undefined) {
          validateExpressionReferences(
            component.pointsExpression,
            'NODE',
            node.key,
            `Node ${node.key} component ${index + 1}`,
          );
        }
        if (
          component.conditionCode &&
          !lookups.conditionCodes.has(String(component.conditionCode))
        ) {
          errors.push(
            issue(
              'SCORE_COMPONENT_CONDITION_MISSING',
              `Node ${node.key} references missing score condition ${String(component.conditionCode)}`,
              'NODE',
              node.key,
            ),
          );
        }
      }
    }
  }

  for (const condition of snapshot.conditions) {
    validateExpressionReferences(
      condition.expression,
      'CONDITION',
      condition.code,
      `Condition ${condition.code}`,
    );
  }

  return { errors };
}

import { duplicateValues, issue } from '../validation-issue';
import type { StructureContext } from './context';

const SUPPORTED_ACTION_TYPES = new Set([
  'SET_OUTCOME',
  'SET_SCORE',
  'ADD_SCORE',
  'SET_LIMIT',
  'SET_RISK_BAND',
  'SET_FIELD',
  'CREATE_MANUAL_REVIEW',
  'EMIT_REASON',
]);

export function checkStartAndTerminals(context: StructureContext): void {
  const { snapshot, lookups, errors } = context;
  const starts = snapshot.nodes.filter((node) => node.type === 'START');
  if (starts.length !== 1) {
    errors.push(
      issue('START_NODE_COUNT', `Exactly one START node is required; found ${starts.length}`),
    );
  }

  const terminals = snapshot.nodes.filter(lookups.isTerminalNode);
  if (!terminals.length)
    errors.push(issue('NO_TERMINAL_NODE', 'At least one terminal node is required'));
}

export function checkEdges(context: StructureContext): void {
  const { snapshot, lookups, errors } = context;
  for (const edge of snapshot.edges) {
    if (!lookups.nodeKeys.has(edge.from)) {
      errors.push(
        issue(
          'EDGE_FROM_NODE_MISSING',
          `Edge ${edge.key} references missing source node ${edge.from}`,
          'EDGE',
          edge.key,
        ),
      );
    }
    if (!lookups.nodeKeys.has(edge.to)) {
      errors.push(
        issue(
          'EDGE_TO_NODE_MISSING',
          `Edge ${edge.key} references missing target node ${edge.to}`,
          'EDGE',
          edge.key,
        ),
      );
    }
    for (const condition of edge.conditions) {
      if (!lookups.conditionCodes.has(condition.code)) {
        errors.push(
          issue(
            'EDGE_CONDITION_MISSING',
            `Edge ${edge.key} references missing condition ${condition.code}`,
            'EDGE',
            edge.key,
          ),
        );
      }
    }
    if (edge.default && edge.conditions.length) {
      errors.push(
        issue(
          'DEFAULT_EDGE_WITH_CONDITIONS',
          `Default edge ${edge.key} cannot have conditions`,
          'EDGE',
          edge.key,
        ),
      );
    }
    if (!edge.default && edge.conditions.length === 0) {
      errors.push(
        issue(
          'CONDITIONAL_EDGE_WITHOUT_CONDITION',
          `Non-default edge ${edge.key} must have at least one condition`,
          'EDGE',
          edge.key,
        ),
      );
    }
    const duplicateConditionOrders = duplicateValues(
      edge.conditions.map((condition) => condition.order),
    );
    if (duplicateConditionOrders.length) {
      errors.push(
        issue(
          'DUPLICATE_EDGE_CONDITION_ORDER',
          `Edge ${edge.key} has duplicate condition order values: ${duplicateConditionOrders.join(', ')}`,
          'EDGE',
          edge.key,
        ),
      );
    }
  }
}

export function checkActions(context: StructureContext): void {
  const { snapshot, errors } = context;
  for (const action of snapshot.actions) {
    if (!SUPPORTED_ACTION_TYPES.has(action.type.toUpperCase())) {
      errors.push(
        issue(
          'UNSUPPORTED_ACTION_TYPE',
          `Action ${action.code} uses unsupported type ${action.type}`,
          'ACTION',
          action.code,
        ),
      );
    }
  }
}

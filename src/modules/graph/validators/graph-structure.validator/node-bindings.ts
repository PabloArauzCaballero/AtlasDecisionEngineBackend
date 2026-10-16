import type { GraphNodeSnapshot } from '../../graph.types';
import { duplicateValues, issue } from '../validation-issue';
import type { StructureContext } from './context';

export function checkNodeBindings(node: GraphNodeSnapshot, context: StructureContext): void {
  const { snapshot, lookups, errors, warnings } = context;
  for (const condition of node.conditions) {
    if (!lookups.conditionCodes.has(condition.code)) {
      errors.push(
        issue(
          'NODE_CONDITION_MISSING',
          `Node ${node.key} references missing condition ${condition.code}`,
          'NODE',
          node.key,
        ),
      );
    }
  }
  for (const action of node.actions) {
    if (!lookups.actionCodes.has(action.code)) {
      errors.push(
        issue(
          'NODE_ACTION_MISSING',
          `Node ${node.key} references missing action ${action.code}`,
          'NODE',
          node.key,
        ),
      );
    }
  }

  const outgoing = snapshot.edges.filter((edge) => edge.from === node.key);
  const terminal = lookups.isTerminalNode(node);
  if (!terminal && !outgoing.length) {
    errors.push(
      issue(
        'NON_TERMINAL_WITHOUT_EDGE',
        `Non-terminal node ${node.key} has no outgoing edge`,
        'NODE',
        node.key,
      ),
    );
  }
  if (terminal && outgoing.length) {
    errors.push(
      issue(
        'TERMINAL_NODE_WITH_EDGE',
        `Terminal node ${node.key} cannot have outgoing edges`,
        'NODE',
        node.key,
      ),
    );
  }
  const defaultCount = outgoing.filter((edge) => edge.default).length;
  if (defaultCount > 1) {
    errors.push(
      issue(
        'AMBIGUOUS_DEFAULT_EDGE',
        `Node ${node.key} has more than one default edge`,
        'NODE',
        node.key,
      ),
    );
  }
  if (!terminal && outgoing.length && defaultCount === 0) {
    errors.push(
      issue(
        'MISSING_DEFAULT_EDGE',
        `Non-terminal node ${node.key} requires a fail-closed default edge`,
        'NODE',
        node.key,
      ),
    );
  }
  const duplicatePriorities = duplicateValues(
    outgoing.filter((edge) => !edge.default).map((edge) => edge.priority),
  );
  if (duplicatePriorities.length) {
    warnings.push(
      issue(
        'DUPLICATE_EDGE_PRIORITY',
        `Node ${node.key} has duplicate edge priorities: ${duplicatePriorities.join(', ')}`,
        'NODE',
        node.key,
        'WARNING',
      ),
    );
  }
  const duplicateActionOrders = duplicateValues(node.actions.map((action) => action.order));
  if (duplicateActionOrders.length) {
    errors.push(
      issue(
        'DUPLICATE_NODE_ACTION_ORDER',
        `Node ${node.key} has duplicate action order values: ${duplicateActionOrders.join(', ')}`,
        'NODE',
        node.key,
      ),
    );
  }
  if (node.conditions.length) {
    warnings.push(
      issue(
        'NODE_CONDITIONS_METADATA_ONLY',
        `Node ${node.key} contains node-level conditions; runtime routing is controlled by edge conditions`,
        'NODE',
        node.key,
        'WARNING',
      ),
    );
  }
}

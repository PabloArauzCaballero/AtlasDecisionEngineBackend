import type { ArtifactGraphSnapshot, ValidationIssue } from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { duplicateValues, issue, reportDuplicates } from './validation-issue';

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

export interface GraphStructureResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Wiring/shape rules: identifiers, references, terminal/default-edge shape. No expression evaluation. */
export function validateGraphStructure(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphStructureResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

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

  const outputs = snapshot.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
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

  const starts = snapshot.nodes.filter((node) => node.type === 'START');
  if (starts.length !== 1) {
    errors.push(
      issue('START_NODE_COUNT', `Exactly one START node is required; found ${starts.length}`),
    );
  }

  const terminals = snapshot.nodes.filter(lookups.isTerminalNode);
  if (!terminals.length)
    errors.push(issue('NO_TERMINAL_NODE', 'At least one terminal node is required'));

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

  for (const node of snapshot.nodes) {
    if (node.type === 'RESULT') {
      const mode = String(node.config.mode ?? 'MAPPING').toUpperCase();
      if (mode !== 'MAPPING' && mode !== 'SCRIPT' && mode !== 'REFERENCE') {
        errors.push(
          issue(
            'RESULT_MODE_INVALID',
            `RESULT node ${node.key} has invalid mode ${mode}`,
            'NODE',
            node.key,
          ),
        );
      }
      if (mode === 'MAPPING') {
        const assignments = Array.isArray(node.config.assignments) ? node.config.assignments : [];
        if (!assignments.length) {
          errors.push(
            issue(
              'RESULT_ASSIGNMENTS_EMPTY',
              `RESULT node ${node.key} has no assignments`,
              'NODE',
              node.key,
            ),
          );
        }
        const seen = new Set<string>();
        for (const raw of assignments) {
          const assignment = raw as Record<string, unknown>;
          const outputCode = String(assignment.outputCode ?? assignment.target ?? '');
          if (!outputs.some((output) => output.code === outputCode)) {
            errors.push(
              issue(
                'UNDECLARED_OUTPUT',
                `RESULT node ${node.key} assigns undeclared output ${outputCode}`,
                'NODE',
                node.key,
              ),
            );
          }
          if (seen.has(outputCode)) {
            errors.push(
              issue(
                'DUPLICATE_RESULT_ASSIGNMENT',
                `RESULT node ${node.key} assigns ${outputCode} more than once`,
                'NODE',
                node.key,
              ),
            );
          }
          seen.add(outputCode);
        }
      }
      if (mode === 'SCRIPT') {
        const script = (node.config.script ?? {}) as Record<string, unknown>;
        const language = String(script.language ?? '').toUpperCase();
        if (!['JAVASCRIPT', 'PYTHON'].includes(language)) {
          errors.push(
            issue(
              'RESULT_SCRIPT_LANGUAGE_INVALID',
              `RESULT node ${node.key} has invalid script language ${language}`,
              'NODE',
              node.key,
            ),
          );
        }
        if (!String(script.source ?? '').trim()) {
          errors.push(
            issue(
              'RESULT_SCRIPT_EMPTY',
              `RESULT node ${node.key} has no script source`,
              'NODE',
              node.key,
            ),
          );
        }
      }
      if (mode === 'REFERENCE') {
        // The referenced artifact/version/mapping itself lives in DecisionArtifactReference
        // (keyed by this node's key) and is validated by NestedTreeService at save time —
        // structural validation here only checks the shape the engine reads at runtime.
        const outputAssignments = Array.isArray(node.config.outputAssignments) ? node.config.outputAssignments : [];
        if (!outputAssignments.length) {
          errors.push(issue('REFERENCE_ASSIGNMENTS_EMPTY', `RESULT node ${node.key} has no output assignments for its nested reference`, 'NODE', node.key));
        }
        const seen = new Set<string>();
        for (const raw of outputAssignments) {
          const assignment = raw as Record<string, unknown>;
          const outputCode = String(assignment.outputCode ?? '');
          if (!outputs.some((output) => output.code === outputCode)) {
            errors.push(issue('UNDECLARED_OUTPUT', `RESULT node ${node.key} assigns undeclared output ${outputCode}`, 'NODE', node.key));
          }
          if (!String(assignment.childOutputCode ?? '').trim()) {
            errors.push(issue('REFERENCE_CHILD_OUTPUT_MISSING', `RESULT node ${node.key} has an output assignment with no childOutputCode`, 'NODE', node.key));
          }
          if (seen.has(outputCode)) {
            errors.push(issue('DUPLICATE_RESULT_ASSIGNMENT', `RESULT node ${node.key} assigns ${outputCode} more than once`, 'NODE', node.key));
          }
          seen.add(outputCode);
        }
      }
    }
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

  return { errors, warnings };
}

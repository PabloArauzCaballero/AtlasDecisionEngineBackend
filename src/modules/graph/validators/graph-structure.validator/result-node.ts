import type { GraphNodeSnapshot } from '../../graph.types';
import { issue } from '../validation-issue';
import type { StructureContext } from './context';

export function checkResultNode(node: GraphNodeSnapshot, context: StructureContext): void {
  const { errors, outputs } = context;
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
    const outputAssignments = Array.isArray(node.config.outputAssignments)
      ? node.config.outputAssignments
      : [];
    if (!outputAssignments.length) {
      errors.push(
        issue(
          'REFERENCE_ASSIGNMENTS_EMPTY',
          `RESULT node ${node.key} has no output assignments for its nested reference`,
          'NODE',
          node.key,
        ),
      );
    }
    const seen = new Set<string>();
    for (const raw of outputAssignments) {
      const assignment = raw as Record<string, unknown>;
      const outputCode = String(assignment.outputCode ?? '');
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
      if (!String(assignment.childOutputCode ?? '').trim()) {
        errors.push(
          issue(
            'REFERENCE_CHILD_OUTPUT_MISSING',
            `RESULT node ${node.key} has an output assignment with no childOutputCode`,
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
}

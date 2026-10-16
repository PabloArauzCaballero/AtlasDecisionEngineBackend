import type { ArtifactGraphSnapshot, ValidationIssue } from '../../graph.types';
import type { GraphLookups } from '../graph-lookups';
import type { StructureContext } from './context';
import { checkDuplicates, checkOutputs } from './duplicates-and-outputs';
import { checkNodeBindings } from './node-bindings';
import { checkResultNode } from './result-node';
import { checkActions, checkEdges, checkStartAndTerminals } from './wiring';

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
  const outputs = snapshot.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
  const context: StructureContext = { snapshot, lookups, errors, warnings, outputs };

  checkDuplicates(context);
  checkOutputs(context);
  checkStartAndTerminals(context);
  checkEdges(context);
  checkActions(context);
  for (const node of snapshot.nodes) {
    if (node.type === 'RESULT') checkResultNode(node, context);
    checkNodeBindings(node, context);
  }

  return { errors, warnings };
}

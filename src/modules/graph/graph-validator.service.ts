import { Injectable } from '@nestjs/common';
import { HashService } from '../../common/crypto/hash.service';
import { ExpressionEvaluator } from './expression-evaluator';
import type { ArtifactGraphSnapshot, GraphValidationReport } from './graph.types';
import { buildGraphLookups } from './validators/graph-lookups';
import { validateGraphStructure } from './validators/graph-structure.validator';
import { validateGraphExpressions } from './validators/graph-expression.validator';
import { validateGraphDeterminism } from './validators/graph-determinism.validator';
import { validateGraphIntermediates } from './validators/graph-intermediate.validator';
import { validateOutputContract } from './validators/graph-output-contract.validator';
import { validateGraphCalculatedFields } from './validators/graph-calculated-field.validator';

@Injectable()
export class GraphValidatorService {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly hashes: HashService,
  ) {}

  validate(snapshot: ArtifactGraphSnapshot): GraphValidationReport {
    const lookups = buildGraphLookups(snapshot);
    const structure = validateGraphStructure(snapshot, lookups);
    const expressions = validateGraphExpressions(snapshot, lookups, this.expressions);
    const determinism = validateGraphDeterminism(snapshot, lookups);
    const intermediates = validateGraphIntermediates(snapshot, lookups);
    const outputContract = validateOutputContract(snapshot, lookups);
    const calculatedFields = validateGraphCalculatedFields(snapshot, lookups);

    const errors = [
      ...structure.errors,
      ...expressions.errors,
      ...determinism.errors,
      ...intermediates.errors,
      ...outputContract.errors,
      ...calculatedFields.errors,
    ];
    const canonicalAst = this.canonicalSnapshot(snapshot);
    const checksum = this.hashes.sha256(canonicalAst);

    return {
      valid: errors.length === 0,
      errors,
      warnings: [
        ...structure.warnings,
        ...intermediates.warnings,
        ...outputContract.warnings,
        ...calculatedFields.warnings,
      ],
      metrics: {
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        reachableNodeCount: determinism.metrics.reachableNodeCount,
        terminalNodeCount: snapshot.nodes.filter(lookups.isTerminalNode).length,
        terminalPathCount: determinism.metrics.terminalPathCount,
      },
      canonicalAst,
      checksum,
    };
  }

  /**
   * `status` and `checksum` are workflow state that mutates as a *side effect* of
   * validating (DRAFT -> VALIDATED, checksum gets stored) — not part of the graph's
   * structure. Hashing them would feed each validation's own side effects into the
   * next computation, so two validate() calls in a row would never agree.
   */
  private canonicalSnapshot(snapshot: ArtifactGraphSnapshot): ArtifactGraphSnapshot {
    return {
      ...snapshot,
      version: { ...snapshot.version, status: 'STRUCTURAL', checksum: null },
      variables: [...snapshot.variables].sort((a, b) => a.code.localeCompare(b.code)),
      intermediates: [...snapshot.intermediates].sort((a, b) => a.code.localeCompare(b.code)),
      outputContract: [...snapshot.outputContract].sort((a, b) => a.code.localeCompare(b.code)),
      conditions: [...snapshot.conditions].sort((a, b) => a.code.localeCompare(b.code)),
      actions: [...snapshot.actions]
        .map((action) => ({
          ...action,
          reasonCodes: [...action.reasonCodes].sort(
            (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
          ),
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      nodes: [...snapshot.nodes]
        .map((node) => ({
          ...node,
          conditions: [...node.conditions].sort(
            (a, b) => a.order - b.order || a.code.localeCompare(b.code),
          ),
          actions: [...node.actions].sort(
            (a, b) => a.order - b.order || a.code.localeCompare(b.code),
          ),
        }))
        .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key)),
      edges: [...snapshot.edges]
        .map((edge) => ({
          ...edge,
          conditions: [...edge.conditions].sort(
            (a, b) => a.order - b.order || a.code.localeCompare(b.code),
          ),
        }))
        .sort(
          (a, b) =>
            a.from.localeCompare(b.from) || a.priority - b.priority || a.key.localeCompare(b.key),
        ),
    };
  }
}

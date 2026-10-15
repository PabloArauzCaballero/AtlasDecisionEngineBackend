import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { ExpressionEvaluator } from '../expression-evaluator';
import type {
  ArtifactReferenceResolver,
  GraphNodeSnapshot,
  NestedExecutionTraceEntry,
  NestedReferenceCursor,
} from '../graph.types';
import { ScriptNodeRunnerService, type ScriptLanguage } from '../script-node-runner.service';
import { assignmentValueOf } from './assignment-value';
import { evaluationContext, type NodeScope } from './execution-state';
import { OutputContractService } from './output-contract.service';

/** Con qué se resuelven las referencias a artefactos anidados de un nodo `RESULT`. */
export interface NestedExecutionScope {
  referenceResolver: ArtifactReferenceResolver | undefined;
  cursor: NestedReferenceCursor;
  nestedExecutions: NestedExecutionTraceEntry[];
}

/** Evalúa los nodos `RESULT` (y el mapeo de salidas de `MANUAL_REVIEW`): script, referencia o mapeo. */
@Injectable()
export class ResultNodeExecutor {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly scripts: ScriptNodeRunnerService,
    private readonly outputs: OutputContractService,
  ) {}

  async execute(
    node: GraphNodeSnapshot,
    { compiled, variables, state, evaluation }: NodeScope,
    { referenceResolver, cursor, nestedExecutions }: NestedExecutionScope,
  ): Promise<void> {
    const mode = String(node.config.mode ?? 'MAPPING').toUpperCase();
    const values: Record<string, unknown> = {};
    if (mode === 'SCRIPT') {
      const script = (node.config.script ?? {}) as Record<string, unknown>;
      const language = String(script.language ?? '').toUpperCase() as ScriptLanguage;
      if (language !== 'JAVASCRIPT' && language !== 'PYTHON') {
        throw new DomainException(
          'RESULT_SCRIPT_LANGUAGE_INVALID',
          // `String(...)`: el `as ScriptLanguage` de arriba hace creer al compilador que
          // aquí ya no queda ningún valor posible. Esta guarda es justamente la que
          // comprueba que el aserto era cierto.
          `Unsupported RESULT script language ${String(language)}`,
        );
      }
      Object.assign(
        values,
        await this.scripts.execute(
          language,
          String(script.source ?? ''),
          evaluationContext(variables, state),
        ),
      );
    } else if (mode === 'REFERENCE') {
      if (!referenceResolver) {
        throw new DomainException(
          'NESTED_REFERENCE_NOT_CONFIGURED',
          `RESULT node ${node.key} invokes a nested artifact reference, but no reference resolver was supplied to this execution`,
        );
      }
      const resolution = await referenceResolver.resolve(
        compiled.version.id,
        node.key,
        evaluationContext(variables, state),
        cursor,
      );
      nestedExecutions.push(...resolution.trace);
      const outputAssignments = Array.isArray(node.config.outputAssignments)
        ? node.config.outputAssignments
        : [];
      for (const raw of outputAssignments) {
        const assignment = raw as Record<string, unknown>;
        const outputCode = String(assignment.outputCode ?? '');
        const childOutputCode = String(assignment.childOutputCode ?? '');
        values[outputCode] = resolution.output[childOutputCode];
      }
      evaluation.reference = { nodeKey: node.key, outputCount: outputAssignments.length };
    } else if (mode === 'MAPPING') {
      const assignments = Array.isArray(node.config.assignments) ? node.config.assignments : [];
      for (const raw of assignments) {
        const assignment = raw as Record<string, unknown>;
        const outputCode = String(assignment.outputCode ?? assignment.target ?? '');
        values[outputCode] = assignmentValueOf(
          this.expressions,
          assignment,
          evaluationContext(variables, state),
        );
      }
    } else {
      throw new DomainException('RESULT_MODE_INVALID', `Unsupported RESULT mode ${mode}`);
    }

    for (const [code, value] of Object.entries(values)) {
      this.outputs.setOutputValue(compiled, state, code, value);
    }
    evaluation.resultMode = mode;
    evaluation.outputs = Object.keys(values).sort();
  }
}

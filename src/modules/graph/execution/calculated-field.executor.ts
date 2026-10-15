import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { MetricsService } from '../../../common/observability/metrics.service';
import {
  executeCalculatedField,
  type ExecutableCalculatedField,
} from '../../calculated-fields/calculated-field-runtime';
import { ExpressionEvaluator } from '../expression-evaluator';
import type {
  CalculatedFieldCallSnapshot,
  CompiledDecisionArtifact,
  GraphNodeSnapshot,
} from '../graph.types';
import { ScriptNodeRunnerService } from '../script-node-runner.service';
import { evaluationContext, type MutableExecutionState, type NodeScope } from './execution-state';
import { OutputContractService } from './output-contract.service';

/** Ejecuta los campos calculados que invoca un nodo y deja cada resultado en su destino. */
@Injectable()
export class CalculatedFieldExecutor {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly scripts: ScriptNodeRunnerService,
    private readonly metrics: MetricsService,
    private readonly outputs: OutputContractService,
  ) {}

  /**
   * Ejecuta los campos calculados que el nodo invoca (§5.1) y deja cada resultado en su
   * destino declarado.
   *
   * La definición viaja EMBEBIDA en el artefacto compilado, así que no se consulta la
   * base de datos durante una decisión: la versión del campo quedó fijada al compilar y
   * la ejecución sigue siendo reproducible aunque el campo se deprecie después.
   */
  async apply(
    node: GraphNodeSnapshot,
    { compiled, variables, state, evaluation }: NodeScope,
  ): Promise<void> {
    const calls = node.calculatedFieldCalls ?? [];
    if (!calls.length) return;

    for (const call of calls) {
      const started = Date.now();
      try {
        const inputs = this.resolveCalculatedFieldInputs(call, variables, state);
        const result = await executeCalculatedField(
          this.toExecutableField(call),
          inputs,
          this.scripts,
        );
        this.storeCalculatedFieldResult(call, compiled, state, result.value);
        state.calculatedFieldCalls.push({
          nodeKey: node.key,
          callKey: call.callKey,
          fieldCode: call.fieldCode,
          versionNumber: call.versionNumber,
          target: `${call.target.kind.toLowerCase()}.${call.target.code}`,
          outcome: result.outcome,
          durationMs: result.durationMs,
          value: result.value,
        });
        this.metrics.recordCalculatedField(call.fieldCode, 'SUCCESS', result.durationMs);
      } catch (error) {
        const errorCode = error instanceof DomainException ? error.code : 'CALCULATED_FIELD_FAILED';
        state.calculatedFieldCalls.push({
          nodeKey: node.key,
          callKey: call.callKey,
          fieldCode: call.fieldCode,
          versionNumber: call.versionNumber,
          target: `${call.target.kind.toLowerCase()}.${call.target.code}`,
          outcome: 'ERROR',
          durationMs: Date.now() - started,
          errorCode,
        });
        this.metrics.recordCalculatedField(call.fieldCode, 'ERROR', Date.now() - started);
        throw error;
      }
    }
    evaluation.calculatedFields = calls.map((call) => call.fieldCode).sort();
  }

  /** Alimenta cada entrada del campo calculado desde el contexto del grafo. */
  private resolveCalculatedFieldInputs(
    call: CalculatedFieldCallSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const [inputId, entry] of Object.entries(call.inputMapping ?? {})) {
      if (entry.source === 'LITERAL') {
        inputs[inputId] = entry.value;
        continue;
      }
      if (entry.source === 'EXPRESSION') {
        inputs[inputId] = this.expressions.evaluate(
          entry.expression,
          evaluationContext(variables, state),
        );
        continue;
      }
      const path =
        entry.source === 'INTERMEDIATE' ? `intermediate.${entry.path ?? ''}` : (entry.path ?? '');
      inputs[inputId] = this.expressions.evaluate(
        { var: path },
        evaluationContext(variables, state),
      );
    }
    return inputs;
  }

  /** Guarda el resultado en la intermedia o en la salida declarada como destino. */
  private storeCalculatedFieldResult(
    call: CalculatedFieldCallSnapshot,
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    value: unknown,
  ): void {
    if (call.target.kind === 'INTERMEDIATE') {
      // Pasa por el mismo ámbito que cualquier otra escritura, así que hereda las
      // comprobaciones de autorización, tipo y política de actualización de §2.3.
      state.intermediates.write(call.target.code, state.currentNodeKey, value);
      return;
    }
    this.outputs.setOutputValue(compiled, state, call.target.code, value);
  }

  private toExecutableField(call: CalculatedFieldCallSnapshot): ExecutableCalculatedField {
    return {
      fieldCode: call.fieldCode,
      versionNumber: call.versionNumber,
      implementationKind: call.definition.implementationKind,
      contract: call.definition.contract as ExecutableCalculatedField['contract'],
      operation: call.definition.operation as ExecutableCalculatedField['operation'],
      sourceCode: call.definition.sourceCode,
      libraryPackages: call.definition.libraryPackages ?? [],
      defaultValue: call.definition.defaultValue,
      timeoutMs: call.definition.timeoutMs,
    };
  }
}

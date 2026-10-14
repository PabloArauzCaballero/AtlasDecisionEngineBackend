import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { MetricsService } from '../../../common/observability/metrics.service';
import { ExpressionEvaluator } from '../expression-evaluator';
import type {
  GraphNodeSnapshot,
  WorkerCallSnapshot,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../graph.types';
import { renderTemplate } from '../template-reference';
import { requireWorkerCall } from '../worker-call';
import { evaluationContext, type MutableExecutionState, type NodeScope } from './execution-state';

/** Ejecuta los nodos `WORKER`: la llamada a un servicio de worker proyectada a intermedias. */
@Injectable()
export class WorkerNodeExecutor {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Ejecuta la llamada a servicio que declara un nodo `WORKER`.
   *
   * El nodo no devuelve nada al contrato público: lo que trae el servicio se proyecta a
   * variables intermedias, que es lo que después leen las condiciones, los scores y las
   * expresiones. Así un dato de un worker entra al motor por la misma puerta —con su tipo,
   * su autorización de escritura y su política de traza— que cualquier valor calculado.
   */
  async execute(
    node: GraphNodeSnapshot,
    { variables, state, evaluation }: NodeScope,
    invoker: WorkerServiceInvoker | undefined,
  ): Promise<void> {
    const call = requireWorkerCall(node);
    if (!invoker) {
      throw new DomainException(
        'WORKER_SERVICE_NOT_CONFIGURED',
        `El nodo ${node.key} llama al servicio ${call.service}, pero esta ejecución no recibió un invocador de servicios`,
      );
    }

    const started = Date.now();
    let outcome: WorkerServiceOutcome;
    try {
      outcome = await invoker.invoke({
        service: call.service,
        operation: call.operation,
        nodeKey: node.key,
        arguments: this.resolveWorkerArguments(call, variables, state),
        timeoutMs: call.timeoutMs,
      });
    } catch (error) {
      const errorCode = error instanceof DomainException ? error.code : 'WORKER_SERVICE_FAILED';
      const durationMs = Date.now() - started;
      if (call.onError === 'FAIL') {
        state.workerCalls.push({
          nodeKey: node.key,
          service: call.service,
          operation: call.operation,
          status: 'FAILED',
          durationMs,
          outputs: [],
          warnings: [],
          errorCode,
        });
        this.metrics.recordWorkerCall(call.service, call.operation, 'ERROR', durationMs);
        throw error;
      }
      // `CONTINUE`: el algoritmo sigue con lo que el autor declaró como valor por defecto,
      // y `call.status` deja el fallo a la vista para que una rama pueda desviarse por él.
      const written = this.applyWorkerOutputs(
        call,
        { result: {}, call: { status: 'FAILED', errorCode, durationMs, warningCount: 0 } },
        node,
        variables,
        state,
      );
      state.workerCalls.push({
        nodeKey: node.key,
        service: call.service,
        operation: call.operation,
        status: 'FAILED',
        durationMs,
        outputs: written,
        warnings: [],
        errorCode,
      });
      this.metrics.recordWorkerCall(call.service, call.operation, 'ERROR', durationMs);
      evaluation.worker = {
        service: call.service,
        operation: call.operation,
        status: 'FAILED',
        errorCode,
        outputs: written,
      };
      return;
    }

    const written = this.applyWorkerOutputs(
      call,
      {
        result: outcome.result,
        call: {
          status: outcome.status,
          errorCode: null,
          durationMs: outcome.durationMs,
          warningCount: outcome.warnings.length,
        },
      },
      node,
      variables,
      state,
    );
    state.workerCalls.push({
      nodeKey: node.key,
      service: call.service,
      operation: call.operation,
      status: outcome.status,
      durationMs: outcome.durationMs,
      outputs: written,
      warnings: outcome.warnings,
    });
    this.metrics.recordWorkerCall(call.service, call.operation, outcome.status, outcome.durationMs);
    evaluation.worker = {
      service: call.service,
      operation: call.operation,
      status: outcome.status,
      durationMs: outcome.durationMs,
      warnings: outcome.warnings,
      outputs: written,
      ...(outcome.evidenceRequestId ? { evidenceRequestId: outcome.evidenceRequestId } : {}),
    };
  }

  /** Alimenta cada argumento del servicio desde el contexto del grafo. */
  private resolveWorkerArguments(
    call: WorkerCallSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [name, binding] of Object.entries(call.arguments)) {
      const context = evaluationContext(variables, state);
      switch (binding.source) {
        case 'LITERAL':
          resolved[name] = binding.value;
          break;
        case 'EXPRESSION':
          resolved[name] = this.expressions.evaluate(binding.expression, context);
          break;
        case 'TEMPLATE':
          resolved[name] = renderTemplate(binding.value, context);
          break;
        case 'INTERMEDIATE':
          resolved[name] = this.expressions.evaluate(
            { var: `intermediate.${binding.path ?? ''}` },
            context,
          );
          break;
        default:
          resolved[name] = this.expressions.evaluate({ var: binding.path ?? '' }, context);
      }
    }
    return resolved;
  }

  /**
   * Proyecta la respuesta del servicio sobre las intermedias declaradas.
   *
   * Las rutas se resuelven contra `{ result, call }` y no contra la respuesta pelada: así
   * un servicio que devuelva su propio campo `status` no tapa el estado de la llamada, que
   * es justo el dato del que suele colgar la rama de contingencia.
   */
  private applyWorkerOutputs(
    call: WorkerCallSnapshot,
    envelope: { result: Record<string, unknown>; call: Record<string, unknown> },
    node: GraphNodeSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): string[] {
    const context = { ...evaluationContext(variables, state), ...envelope };
    const written: string[] = [];
    for (const output of call.outputs) {
      const raw =
        output.source === 'EXPRESSION'
          ? this.expressions.evaluate(output.expression, context)
          : this.expressions.evaluate({ var: output.path ?? '' }, context);
      const value = raw === undefined || raw === null ? (output.defaultValue ?? null) : raw;
      state.intermediates.write(output.intermediateCode, node.key, value);
      written.push(output.intermediateCode);
    }
    return written.sort();
  }
}

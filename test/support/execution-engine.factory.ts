import type { ConfigService } from '@nestjs/config';
import type { MetricsService } from '../../src/common/observability/metrics.service';
import { ActionNodeExecutor } from '../../src/modules/graph/execution/action-node.executor';
import { CalculatedFieldExecutor } from '../../src/modules/graph/execution/calculated-field.executor';
import { EdgeSelector } from '../../src/modules/graph/execution/edge-selector';
import { IntermediateVariablesService } from '../../src/modules/graph/execution/intermediate-variables.service';
import { OutputContractService } from '../../src/modules/graph/execution/output-contract.service';
import { ResultNodeExecutor } from '../../src/modules/graph/execution/result-node.executor';
import { ScoreNodeExecutor } from '../../src/modules/graph/execution/score-node.executor';
import { WorkerNodeExecutor } from '../../src/modules/graph/execution/worker-node.executor';
import { ExecutionEngineService } from '../../src/modules/graph/execution-engine.service';
import type { ExpressionEvaluator } from '../../src/modules/graph/expression-evaluator';
import type { ScriptNodeRunnerService } from '../../src/modules/graph/script-node-runner.service';

/** Arma el motor de ejecución con sus ejecutores de nodo reales, como lo hace Nest. */
export function buildExecutionEngine(
  expressions: ExpressionEvaluator,
  config: ConfigService,
  scripts: ScriptNodeRunnerService,
  metrics: MetricsService,
): ExecutionEngineService {
  const outputs = new OutputContractService(metrics);
  return new ExecutionEngineService(
    config,
    new ScoreNodeExecutor(expressions, outputs),
    new ActionNodeExecutor(expressions, outputs),
    new WorkerNodeExecutor(expressions, metrics),
    new ResultNodeExecutor(expressions, scripts, outputs),
    new EdgeSelector(expressions),
    new CalculatedFieldExecutor(expressions, scripts, metrics, outputs),
    new IntermediateVariablesService(expressions, metrics),
    outputs,
  );
}

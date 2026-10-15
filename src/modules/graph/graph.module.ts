/** Exports the pure validator/compiler/evaluator/engine stack to authoring and runtime domains. */
import { Module } from '@nestjs/common';
import { ExpressionEvaluator } from './expression-evaluator';
import { GraphValidatorService } from './graph-validator.service';
import { CompilerService } from './compiler.service';
import { ExecutionEngineService } from './execution-engine.service';
import { ActionNodeExecutor } from './execution/action-node.executor';
import { CalculatedFieldExecutor } from './execution/calculated-field.executor';
import { EdgeSelector } from './execution/edge-selector';
import { IntermediateVariablesService } from './execution/intermediate-variables.service';
import { OutputContractService } from './execution/output-contract.service';
import { ResultNodeExecutor } from './execution/result-node.executor';
import { ScoreNodeExecutor } from './execution/score-node.executor';
import { WorkerNodeExecutor } from './execution/worker-node.executor';
import { ScriptNodeRunnerService } from './script-node-runner.service';

@Module({
  providers: [
    ExpressionEvaluator,
    ScriptNodeRunnerService,
    GraphValidatorService,
    CompilerService,
    OutputContractService,
    ScoreNodeExecutor,
    ActionNodeExecutor,
    WorkerNodeExecutor,
    ResultNodeExecutor,
    EdgeSelector,
    CalculatedFieldExecutor,
    IntermediateVariablesService,
    ExecutionEngineService,
  ],
  exports: [
    ExpressionEvaluator,
    ScriptNodeRunnerService,
    GraphValidatorService,
    CompilerService,
    ExecutionEngineService,
  ],
})
export class GraphModule {}

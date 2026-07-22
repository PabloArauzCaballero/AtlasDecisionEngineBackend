import { Module } from '@nestjs/common';
import { ExpressionEvaluator } from './expression-evaluator';
import { GraphValidatorService } from './graph-validator.service';
import { CompilerService } from './compiler.service';
import { ExecutionEngineService } from './execution-engine.service';
import { ScriptNodeRunnerService } from './script-node-runner.service';

@Module({
  providers: [
    ExpressionEvaluator,
    ScriptNodeRunnerService,
    GraphValidatorService,
    CompilerService,
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

import { Controller, HttpStatus, MessageEvent, Query, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { DomainException } from '../../common/errors/domain-exception';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { LiveStepEvent } from '../graph/graph.types';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { LiveExecutionStreamQueryDto } from './live-execution.dto';

/**
 * Fase 8 — live execution. Streams node-by-node progress (pending/running/
 * completed/error, path taken, discarded branches, nested-tree calls) over
 * Server-Sent Events while the decision actually executes.
 *
 * Not wired to Rebanada 1's event bus (src/common/events/**), which is still
 * in progress on a separate branch and out of scope here to edit — see
 * docs/live-execution.md for the documented "pending R1 merge" integration:
 * once that bus exists, this stream can additionally publish a
 * `live_execution.step` event for other consumers, but the live view itself
 * does not depend on it — it drives the engine directly, over its own SSE
 * connection.
 */
@ApiTags('Live Execution')
@Controller('v1/live-executions')
export class LiveExecutionController {
  constructor(
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly nestedTrees: NestedTreeExecutionService,
  ) {}

  @Sse('stream')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  stream(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: LiveExecutionStreamQueryDto,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      void this.run(tenantId, principal, query, subscriber);
    });
  }

  private async run(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    query: LiveExecutionStreamQueryDto,
    subscriber: { next: (event: MessageEvent) => void; complete: () => void },
  ): Promise<void> {
    try {
      if (query.environmentCode === 'PROD') {
        // Same policy as SimulationService: this is a dry-run preview tool (no
        // idempotency/audit persistence, see below), and must never be aimed at
        // production traffic patterns.
        throw new DomainException('LIVE_EXECUTION_PROD_FORBIDDEN', 'Production decisions cannot be executed through live execution', HttpStatus.FORBIDDEN);
      }
      let inputVariables: Record<string, unknown>;
      try {
        inputVariables = JSON.parse(query.variables) as Record<string, unknown>;
      } catch {
        throw new DomainException('LIVE_EXECUTION_VARIABLES_INVALID', 'variables must be a JSON object', HttpStatus.BAD_REQUEST);
      }

      const deployment = await this.deployments.resolve(tenantId, query.artifactCode, query.environmentCode);
      const inputContracts = deployment.compiled.variables.filter(
        (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
      );
      const resolution = await this.variables.resolve(inputContracts, inputVariables, {
        tenantId,
        artifactCode: query.artifactCode,
        requestId: query.requestId,
        allowExternal: true,
      });
      if (!resolution.valid) {
        subscriber.next({
          type: 'execution_failed',
          data: { errors: resolution.errors },
        });
        subscriber.complete();
        return;
      }

      const onStep = (event: LiveStepEvent) => {
        subscriber.next({ type: 'node_step', data: event });
      };
      const result = await this.engine.execute(
        deployment.compiled,
        resolution.values,
        this.nestedTrees.bind(tenantId, principal),
        undefined,
        onStep,
      );
      subscriber.next({
        type: 'execution_completed',
        data: {
          status: result.status,
          outcome: result.outcome,
          output: result.output,
          reasons: result.reasons,
          nestedExecutions: result.nestedExecutions,
        },
      });
      subscriber.complete();
    } catch (error) {
      subscriber.next({
        type: 'execution_failed',
        data: {
          code: error instanceof DomainException ? error.code : 'LIVE_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      subscriber.complete();
    }
  }
}

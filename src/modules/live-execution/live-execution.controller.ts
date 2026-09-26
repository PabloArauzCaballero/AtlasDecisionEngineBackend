import { Controller, HttpStatus, Logger, MessageEvent, Query, Sse } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable, type Subscriber } from 'rxjs';
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
 * The stream is deliberately request-scoped rather than outbox-backed: node
 * progress is transient UI telemetry, while the transactional event bus is for
 * durable domain facts. This avoids filling the outbox with high-cardinality
 * per-node events and keeps execution latency independent from consumers.
 */
@ApiTags('Live Execution')
@Controller('v1/live-executions')
export class LiveExecutionController {
  private readonly logger = new Logger(LiveExecutionController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly nestedTrees: NestedTreeExecutionService,
  ) {}

  @Sse('stream')
  @ApiOperation({ summary: 'Stream an opt-in non-production decision preview node by node' })
  /*
   * El cuerpo se declara aunque `@Sse` no lo infiera. Sin esto, la única
   * operación del motor sin esquema de respuesta era ésta, y un consumidor no
   * puede tipar lo que no está descrito: tenía que leer `LiveStepEvent` en el
   * código del motor para saber qué llega por el canal. Se describe como el
   * flujo que es —`text/event-stream`, una línea `data:` por evento— y no como
   * un objeto, porque lo que se recibe no es un cuerpo único.
   */
  @ApiOkResponse({
    description:
      'Flujo de eventos SSE. Cada mensaje es un `LiveStepEvent` serializado en el campo `data:`.',
    content: { 'text/event-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  stream(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Query() query: LiveExecutionStreamQueryDto,
  ): Observable<MessageEvent> {
    if (!(this.config.get<boolean>('LIVE_EXECUTION_STREAM_ENABLED') ?? false)) {
      throw new DomainException(
        'LIVE_EXECUTION_DISABLED',
        'Live execution is disabled for this environment',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return new Observable<MessageEvent>((subscriber) => {
      // A comment frame is not observable through Nest's @Sse serializer, so use a
      // named heartbeat event. Besides detecting dead clients, each emission resets
      // the global RxJS request timeout while a long nested decision is still alive.
      const heartbeat = setInterval(
        () => {
          subscriber.next({ type: 'heartbeat', data: { at: new Date().toISOString() } });
        },
        this.config.get<number>('LIVE_EXECUTION_STREAM_HEARTBEAT_MS') ?? 15_000,
      );
      heartbeat.unref();
      void this.run(tenantId, principal, query, subscriber).finally(() => clearInterval(heartbeat));
      return () => clearInterval(heartbeat);
    });
  }

  private async run(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    query: LiveExecutionStreamQueryDto,
    subscriber: Subscriber<MessageEvent>,
  ): Promise<void> {
    try {
      if (query.environmentCode === 'PROD') {
        // Same policy as SimulationService: this is a dry-run preview tool (no
        // idempotency/audit persistence, see below), and must never be aimed at
        // production traffic patterns.
        throw new DomainException(
          'LIVE_EXECUTION_PROD_FORBIDDEN',
          'Production decisions cannot be executed through live execution',
          HttpStatus.FORBIDDEN,
        );
      }
      let parsedVariables: unknown;
      try {
        parsedVariables = JSON.parse(query.variables);
      } catch {
        throw new DomainException(
          'LIVE_EXECUTION_VARIABLES_INVALID',
          'variables must be a JSON object',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (
        !parsedVariables ||
        typeof parsedVariables !== 'object' ||
        Array.isArray(parsedVariables)
      ) {
        throw new DomainException(
          'LIVE_EXECUTION_VARIABLES_INVALID',
          'variables must be a JSON object',
          HttpStatus.BAD_REQUEST,
        );
      }
      const inputVariables = parsedVariables as Record<string, unknown>;

      const deployment = await this.deployments.resolve(
        tenantId,
        query.artifactCode,
        query.environmentCode,
      );
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
      if (!(error instanceof DomainException)) {
        // SSE has already committed HTTP 200, so the global exception filter cannot
        // redact this failure. Keep implementation details in structured server logs
        // and send the client a stable, non-sensitive message.
        this.logger.error(
          {
            event: 'LIVE_EXECUTION_FAILED',
            artifactCode: query.artifactCode,
            requestId: query.requestId,
          },
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      subscriber.next({
        type: 'execution_failed',
        data: {
          code: error instanceof DomainException ? error.code : 'LIVE_EXECUTION_FAILED',
          message:
            error instanceof DomainException ? error.message : 'Live execution failed unexpectedly',
        },
      });
      subscriber.complete();
    }
  }
}

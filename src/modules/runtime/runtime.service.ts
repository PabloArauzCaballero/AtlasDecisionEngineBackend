import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { ExecuteDecisionDto } from './runtime.dto';
import { IdempotencyService } from './idempotency.service';
import { ExecutionWriterService } from './execution-writer.service';

/** HTTP status and serializable response produced by the decision runtime. */
export interface RuntimeHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/**
 * Orchestrates the online decision path from idempotency through persisted evidence.
 *
 * The compiled graph engine remains transport-agnostic; this service supplies deployment,
 * variable resolution, audit, metrics and HTTP response semantics.
 */
@Injectable()
export class RuntimeService {
  private readonly logger = new Logger(RuntimeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly idempotency: IdempotencyService,
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly writer: ExecutionWriterService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly nestedTrees: NestedTreeExecutionService,
  ) {}

  /**
   * Executes or replays one decision request.
   *
   * Transient infrastructure failures release the idempotency reservation. Deterministic
   * business failures remain cached so retries receive the same response.
   */
  async execute(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
  ): Promise<RuntimeHttpResult> {
    const environmentCode =
      dto.environmentCode ?? this.config.get<string>('DEFAULT_ENVIRONMENT') ?? 'PROD';
    const requestHash = this.hashes.sha256({
      tenantId: tenantId.toString(),
      artifactCode,
      // The environment is part of the request identity: the same key and payload aimed at
      // a different environment must not replay a decision computed for another one.
      environmentCode,
      requestId: dto.requestId,
      subjectReference: dto.subjectReference,
      variables: dto.variables,
      context: dto.context,
    });
    const reservation = await this.idempotency.reserve(
      tenantId,
      artifactCode,
      dto.idempotencyKey,
      requestHash,
    );
    if (reservation.kind === 'completed') {
      const body = (reservation.response ?? {}) as Record<string, unknown>;
      return {
        httpStatus: Number(body.httpStatus ?? (reservation.status === 'FAILED' ? 422 : 200)),
        body: (body.body ?? body) as Record<string, unknown>,
      };
    }

    const started = performance.now();
    try {
      const deployment = await this.deployments.resolve(tenantId, artifactCode, environmentCode);
      // Output contracts are produced by RESULT nodes and must never be requested
      // from the caller as if they were input dependencies.
      const inputContracts = deployment.compiled.variables.filter(
        (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
      );
      const resolution = await this.variables.resolve(inputContracts, dto.variables, {
        tenantId,
        artifactCode,
        requestId: dto.requestId,
        allowExternal: true,
      });
      const inputSnapshot = Object.fromEntries(
        resolution.snapshots.map((item) => [
          item.code,
          item.sensitive ? { valueHash: item.valueHash, source: item.sourceCode } : item.value,
        ]),
      );

      if (!resolution.valid) {
        const durationMs = Math.max(0, Math.round(performance.now() - started));
        // Same unit of work as the decision path: a NO_DECISION is still a recorded outcome,
        // so its evidence, idempotency result and audit event must commit together.
        const body = await this.prisma.$transaction(async (tx) => {
          const execution = await this.writer.write(
            {
              tenantId,
              deployment,
              requestId: dto.requestId,
              correlationId: dto.correlationId,
              idempotencyKey: dto.idempotencyKey,
              subjectReference: dto.subjectReference,
              inputSnapshot,
              durationMs,
              variableSnapshots: resolution.snapshots,
              errors: resolution.errors.map((error) => ({
                code: error.code,
                type: 'VARIABLE_RESOLUTION',
                message: error.message,
                retryable: false,
                details: { variable: error.variable },
              })),
            },
            tx,
          );
          const responseBody = {
            requestId: dto.requestId,
            executionId: execution.id.toString(),
            status: 'NO_DECISION',
            outcome: 'NO_DECISION',
            reasonCodes: ['VARIABLE_MISSING_OR_INVALID'],
            errors: resolution.errors,
            artifact: {
              code: artifactCode,
              versionId: deployment.artifactVersionId.toString(),
              deploymentId: deployment.deploymentId.toString(),
              checksum: deployment.compiledChecksum,
            },
          };
          await this.idempotency.fail(reservation.id, { httpStatus: 422, body: responseBody }, tx);
          await this.audit.append(
            {
              tenantId,
              eventType: 'DECISION_NO_DECISION_VARIABLES',
              aggregateType: 'DecisionExecution',
              aggregateId: execution.id.toString(),
              actorId: principal.id,
              requestId: principal.requestId,
              payload: { artifactCode, errors: resolution.errors },
            },
            tx,
          );
          return responseBody;
        });
        this.metrics.recordDecision('NO_DECISION', 'NO_DECISION');
        return { httpStatus: 422, body };
      }

      const result = await this.engine.execute(
        deployment.compiled,
        resolution.values,
        this.nestedTrees.bind(tenantId, principal),
      );
      const durationMs = Math.max(0, Math.round(performance.now() - started));

      // The execution and its evidence, the idempotency outcome and the audit event commit
      // together or not at all. Variable resolution and
      // engine execution stayed outside deliberately — they perform network I/O, which must
      // never hold a database transaction open.
      const body = await this.prisma.$transaction(async (tx) => {
        const execution = await this.writer.write(
          {
            tenantId,
            deployment,
            requestId: dto.requestId,
            correlationId: dto.correlationId,
            idempotencyKey: dto.idempotencyKey,
            subjectReference: dto.subjectReference,
            inputSnapshot,
            durationMs,
            variableSnapshots: resolution.snapshots,
            result,
          },
          tx,
        );
        const responseBody = this.buildBody(dto, artifactCode, deployment, execution, result);
        await this.idempotency.complete(
          reservation.id,
          { httpStatus: 200, body: responseBody },
          tx,
        );
        await this.audit.append(
          {
            tenantId,
            eventType: 'DECISION_EXECUTED',
            aggregateType: 'DecisionExecution',
            aggregateId: execution.id.toString(),
            actorId: principal.id,
            requestId: principal.requestId,
            payload: {
              artifactCode,
              versionId: deployment.artifactVersionId.toString(),
              outcome: result.outcome,
              durationMs,
              reasonCodes: result.reasons.map((reason) => reason.code),
            },
          },
          tx,
        );
        return responseBody;
      });

      this.metrics.recordDecision(String(result.outcome), String(result.status));
      return { httpStatus: 200, body };
    } catch (error) {
      // A transient failure (DB timeout, variable backend down, script runner unavailable)
      // must not be cached as a terminal FAILED: doing so would trap the idempotency key and
      // force the caller to invent a new one to retry. Release the reservation so an
      // identical retry can re-claim it. Only deterministic business failures are cached.
      if (this.isRetryable(error)) {
        await this.idempotency.release(reservation.id);
        this.metrics.recordDecision('FAILED', 'FAILED');
        throw error;
      }
      const errorCode = error instanceof DomainException ? error.code : 'RUNTIME_EXECUTION_FAILED';
      const body = {
        requestId: dto.requestId,
        status: 'FAILED',
        error: {
          code: errorCode,
          message: error instanceof Error ? error.message : String(error),
        },
      };
      await this.recordDeterministicFailure(
        tenantId,
        artifactCode,
        dto,
        principal,
        reservation.id,
        {
          httpStatus: this.statusForError(error),
          body,
          errorCode,
        },
      );
      this.metrics.recordDecision('FAILED', 'FAILED');
      throw error;
    }
  }

  /**
   * Persists the terminal FAILED outcome and its audit evidence in one transaction.
   *
   * A deterministic failure is a decision the platform actually took — the caller is told
   * "no", and every retry with the same key replays that same "no". The success and
   * NO_DECISION paths both leave an audit event; without this one, the only outcome with no
   * entry in the hash chain was the refusal, which is precisely the one a regulator asks
   * about. Persistence is best-effort on purpose: if the database is what broke, the caller
   * must still receive the original error rather than a masking one.
   */
  private async recordDeterministicFailure(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
    reservationId: bigint,
    outcome: { httpStatus: number; body: Record<string, unknown>; errorCode: string },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.idempotency.fail(
          reservationId,
          { httpStatus: outcome.httpStatus, body: outcome.body },
          tx,
        );
        await this.audit.append(
          {
            tenantId,
            eventType: 'DECISION_FAILED',
            aggregateType: 'RuntimeIdempotency',
            aggregateId: reservationId.toString(),
            actorId: principal.id,
            requestId: principal.requestId,
            payload: {
              artifactCode,
              requestId: dto.requestId,
              correlationId: dto.correlationId ?? null,
              errorCode: outcome.errorCode,
              httpStatus: outcome.httpStatus,
            },
          },
          tx,
        );
      });
    } catch (persistenceError) {
      this.logger.error(
        `Could not persist the FAILED outcome for idempotency reservation ${reservationId.toString()}: ${
          persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
        }`,
      );
    }
  }

  private buildBody(
    dto: ExecuteDecisionDto,
    artifactCode: string,
    deployment: ResolvedDeployment,
    execution: { id: bigint },
    result: EngineExecutionResult,
  ): Record<string, unknown> {
    return {
      requestId: dto.requestId,
      correlationId: dto.correlationId,
      executionId: execution.id.toString(),
      status: result.status,
      outcome: result.outcome,
      score: result.score,
      riskBand: result.riskBand,
      limit: result.limit,
      output: result.output,
      primaryResult: result.primaryResult,
      reasonCodes: result.reasons.map((reason) => ({
        code: reason.code,
        category: reason.category,
        message: reason.message,
        adverseAction: reason.adverseAction,
        priority: reason.priority,
      })),
      artifact: {
        code: artifactCode,
        versionId: deployment.artifactVersionId.toString(),
        deploymentId: deployment.deploymentId.toString(),
        environment: deployment.environmentCode,
        checksum: deployment.compiledChecksum,
      },
      traceReference: execution.id.toString(),
    };
  }

  private statusForError(error: unknown): number {
    if (error instanceof DomainException) return error.status;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * A failure is transient when it is not a modelled business error: infrastructure
   * errors (which never reach us as a DomainException) and 5xx domain errors — timeouts,
   * unavailable dependencies — are retryable. A 4xx DomainException is a deterministic
   * business outcome and is safe to cache.
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof DomainException) return error.status >= 500;
    return true;
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { ExecuteDecisionDto } from './runtime.dto';
import { IdempotencyService } from './idempotency.service';
import { ExecutionWriterService } from './execution-writer.service';

export interface RuntimeHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

@Injectable()
export class RuntimeService {
  constructor(
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly idempotency: IdempotencyService,
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly writer: ExecutionWriterService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  async execute(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
  ): Promise<RuntimeHttpResult> {
    const requestHash = this.hashes.sha256({
      tenantId: tenantId.toString(),
      artifactCode,
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
      const environmentCode = dto.environmentCode ?? this.config.get<string>('DEFAULT_ENVIRONMENT') ?? 'PROD';
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
        const execution = await this.writer.write({
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
        });
        const body = {
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
        await this.idempotency.fail(reservation.id, { httpStatus: 422, body });
        await this.audit.append({
          tenantId,
          eventType: 'DECISION_NO_DECISION_VARIABLES',
          aggregateType: 'DecisionExecution',
          aggregateId: execution.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { artifactCode, errors: resolution.errors },
        });
        this.metrics.recordDecision('NO_DECISION', 'NO_DECISION');
        return { httpStatus: 422, body };
      }

      const result = await this.engine.execute(deployment.compiled, resolution.values);
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const execution = await this.writer.write({
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
      });
      const body = {
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
      await this.idempotency.complete(reservation.id, { httpStatus: 200, body });
      await this.audit.append({
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
      });
      this.metrics.recordDecision(String(result.outcome), String(result.status));
      return { httpStatus: 200, body };
    } catch (error) {
      const body = {
        requestId: dto.requestId,
        status: 'FAILED',
        error: {
          code: error instanceof DomainException ? error.code : 'RUNTIME_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      };
      await this.idempotency.fail(reservation.id, { httpStatus: this.statusForError(error), body });
      this.metrics.recordDecision('FAILED', 'FAILED');
      throw error;
    }
  }

  private statusForError(error: unknown): number {
    if (error instanceof DomainException) return error.status;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

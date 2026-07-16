import { HttpStatus, Injectable } from '@nestjs/common';
import { ExecutionStatus, Prisma } from '@prisma/client';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import type { ResolvedVariableSnapshot } from '../variables/variable-resolution.service';

export interface WriteExecutionInput {
  tenantId: bigint;
  deployment: ResolvedDeployment;
  requestId: string;
  correlationId?: string;
  idempotencyKey: string;
  subjectReference?: string;
  inputSnapshot: Record<string, unknown>;
  durationMs: number;
  variableSnapshots: ResolvedVariableSnapshot[];
  result?: EngineExecutionResult;
  errors?: Array<{
    code: string;
    type: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  }>;
}

@Injectable()
export class ExecutionWriterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
  ) {}

  async write(input: WriteExecutionInput) {
    const result = input.result;
    try {
      return await this.prisma.$transaction(async (tx) => {
      const execution = await tx.decisionExecution.create({
        data: {
          tenantId: input.tenantId,
          deploymentId: input.deployment.deploymentId,
          artifactVersionId: input.deployment.artifactVersionId,
          environmentId: input.deployment.environmentId,
          requestId: input.requestId,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          subjectReferenceHash: input.subjectReference
            ? this.hashes.hmac(input.subjectReference)
            : undefined,
          inputSnapshotJson: input.inputSnapshot as Prisma.InputJsonValue,
          outputJson: result?.output as Prisma.InputJsonValue | undefined,
          decisionStatus: this.executionStatus(result, input.errors),
          businessOutcome: result?.outcome,
          durationMs: input.durationMs,
        },
      });

      if (input.variableSnapshots.length) {
        await tx.decisionExecutionVariable.createMany({
          data: input.variableSnapshots.map((variable) => ({
            executionId: execution.id,
            variableVersionId: BigInt(variable.variableVersionId),
            valueJson: variable.storedValue as Prisma.InputJsonValue | undefined,
            valueHash: variable.valueHash,
            sourceCode: variable.sourceCode,
            resolutionStatus: variable.resolutionStatus,
            wasDefaulted: variable.wasDefaulted,
          })),
        });
      }

      if (result) {
        for (let index = 0; index < result.trace.length; index += 1) {
          const step = result.trace[index];
          if (!step.nodeId) continue;
          await tx.decisionExecutionStep.create({
            data: {
              executionId: execution.id,
              nodeId: BigInt(step.nodeId),
              stepOrder: index + 1,
              evaluationResultJson: step.evaluation as Prisma.InputJsonValue,
              branchTaken: step.branchTaken,
              durationUs: BigInt(step.durationUs),
            },
          });
        }
        for (const reason of result.reasons) {
          if (!reason.reasonCodeId || !reason.sourceActionId) continue;
          await tx.decisionExecutionReason.create({
            data: {
              executionId: execution.id,
              reasonCodeId: BigInt(reason.reasonCodeId),
              sourceActionId: BigInt(reason.sourceActionId),
              priority: reason.priority,
              renderedMessage: reason.message,
            },
          });
        }
        if (result.manualReview) {
          await tx.decisionManualReviewCase.create({
            data: {
              executionId: execution.id,
              tenantId: input.tenantId,
              caseCode: `MR-${execution.id.toString().padStart(10, '0')}`,
              queueCode: result.manualReview.queueCode,
              priority: result.manualReview.priority,
              dueAt: new Date(Date.now() + result.manualReview.slaMinutes * 60_000),
              evidenceJson: result.manualReview.evidence as Prisma.InputJsonValue,
            },
          });
        }
      }

      for (const error of input.errors ?? []) {
        await tx.decisionExecutionError.create({
          data: {
            executionId: execution.id,
            errorCode: error.code,
            errorType: error.type,
            errorMessage: error.message,
            retryable: error.retryable,
            detailsJson: error.details as Prisma.InputJsonValue | undefined,
          },
        });
      }
        return execution;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DomainException(
          'EXECUTION_PERSISTENCE_CONFLICT',
          'The request or execution evidence already exists',
          HttpStatus.CONFLICT,
          { target: error.meta?.target },
        );
      }
      throw error;
    }
  }

  private executionStatus(
    result?: EngineExecutionResult,
    errors?: WriteExecutionInput['errors'],
  ): ExecutionStatus {
    if (errors?.length && !result) return ExecutionStatus.NO_DECISION;
    if (!result) return ExecutionStatus.FAILED;
    if (result.status === 'NO_DECISION') return ExecutionStatus.NO_DECISION;
    if (result.status === 'FAILED') return ExecutionStatus.FAILED;
    return ExecutionStatus.SUCCEEDED;
  }
}

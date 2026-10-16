import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, Prisma } from '@prisma/client';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { manualReviewCaseCode } from './manual-review-case-code';
import { resolveSubject } from './execution-subject';
import { assertManualReviewConsistency, executionStatus } from './execution-write.rules';
import { persistedStepEvaluation, type WriteExecutionInput } from './execution-write.types';
import { scheduleOutcomeWindows } from './outcome-window-writer';
export type { WriteExecutionInput } from './execution-write.types';
export { persistedStepEvaluation } from './execution-write.types';

/**
 * Persists a decision execution, variable snapshots, trace, reasons and review evidence.
 */
@Injectable()
export class ExecutionWriterService {
  private readonly logger = new Logger(ExecutionWriterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly config: ConfigService,
  ) {}

  /**
   * @param transaction The caller's transaction. Passing it lets the execution, the
   *   idempotency outcome and the audit event commit as one unit instead of
   *   as three independent writes that can partially succeed.
   */
  async write(input: WriteExecutionInput, transaction?: Prisma.TransactionClient) {
    try {
      return transaction
        ? await this.writeWithin(transaction, input)
        : await this.prisma.$transaction((tx) => this.writeWithin(tx, input));
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

  private async writeWithin(tx: Prisma.TransactionClient, input: WriteExecutionInput) {
    const result = input.result;
    assertManualReviewConsistency(result, input.statusOverride);
    const subjectReferenceHash = input.subjectReference
      ? this.hashes.hmac(input.subjectReference)
      : undefined;
    const subjectId = subjectReferenceHash
      ? await resolveSubject(tx, input.tenantId, subjectReferenceHash)
      : null;
    const execution = await tx.decisionExecution.create({
      data: {
        tenantId: input.tenantId,
        deploymentId: input.deployment.deploymentId,
        artifactVersionId: input.deployment.artifactVersionId,
        environmentId: input.deployment.environmentId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        subjectReferenceHash,
        subjectId,
        subjectAbsenceReason: input.subjectAbsenceReason ?? undefined,
        inputSnapshotJson: input.inputSnapshot as Prisma.InputJsonValue,
        outputJson: result?.output as Prisma.InputJsonValue | undefined,
        // Una decision tomada con datos viejos sigue siendo valida; lo que no vale es que no se
        // pueda distinguir de una tomada con datos frescos.
        degradedInputs: input.variableSnapshots.some((variable) => variable.freshness?.degraded),
        decisionStatus: input.statusOverride ?? executionStatus(result, input.errors),
        businessOutcome: result?.outcome,
        durationMs: input.durationMs,
      },
    });

    // Sólo una decisión TOMADA tiene desenlace que observar. Una ventana colgada de un
    // `NO_DECISION` (base ausente, salida inválida, variables que faltan) nunca se puede cerrar:
    // no hay crédito que la cierre, y engorda la cola de pendientes hasta que se ignora entera.
    if (subjectId && execution.decisionStatus === ExecutionStatus.SUCCEEDED) {
      await scheduleOutcomeWindows(
        tx,
        input,
        execution.id,
        this.config.get<string>('OUTCOME_WINDOW_DAYS'),
      );
    }

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
          // El sello temporal del dato. Sin el, la traza guardaba el valor y callaba de cuando
          // era: reentrenar sobre ella mete informacion del futuro, y defender la decision dos
          // anos despues es reconstruir de memoria.
          observedAt: variable.freshness?.observedAt ?? undefined,
          fetchedAt: variable.freshness?.fetchedAt ?? undefined,
          sourceVersion: variable.freshness?.sourceVersion ?? undefined,
          ageSeconds: variable.freshness?.ageSeconds ?? undefined,
          staleAccepted: variable.freshness?.degraded ?? false,
        })),
      });
    }

    if (result) {
      for (let index = 0; index < result.trace.length; index += 1) {
        const step = result.trace[index];
        if (!step.nodeId) {
          // A traced step with no compiled node id would silently vanish from the decision's
          // audit trail — an evidence gap in a regulated system. It must never be silent:
          // a compiled artifact is expected to give every node an id, so this signals a
          // compiler defect that needs investigating, not a routine skip.
          this.logger.error(
            `Execution ${execution.id} trace step ${index + 1} has no nodeId and cannot be persisted`,
          );
          continue;
        }
        await tx.decisionExecutionStep.create({
          data: {
            executionId: execution.id,
            nodeId: BigInt(step.nodeId),
            stepOrder: index + 1,
            evaluationResultJson: persistedStepEvaluation(step),
            branchTaken: step.branchTaken,
            durationUs: BigInt(step.durationUs),
          },
        });
      }
      for (const reason of result.reasons) {
        if (!reason.reasonCodeId || !reason.sourceActionId) {
          this.logger.error(
            `Execution ${execution.id} reason "${reason.code}" is missing reasonCodeId/sourceActionId and cannot be persisted`,
          );
          continue;
        }
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
      if (result.nestedExecutions.length) {
        // Nested calls run fully in-memory during engine execution (no child
        // DecisionExecution row per level — see graph.types.ts), so every row shares
        // this one root/parent execution id; `sequence`/`parentSequence` reconstruct
        // the actual nested-call tree (Fase 7 distributed-execution traceability).
        await tx.decisionExecutionTreeLink.createMany({
          data: result.nestedExecutions.map((entry) => ({
            tenantId: input.tenantId,
            rootExecutionId: execution.id,
            parentExecutionId: execution.id,
            sequence: entry.sequence,
            parentSequence: entry.parentSequence,
            nodeKey: entry.nodeKey,
            childArtifactVersionId: entry.childArtifactVersionId
              ? BigInt(entry.childArtifactVersionId)
              : undefined,
            depth: entry.depth,
            status: entry.status,
            durationMs: entry.durationMs,
            outputJson: entry.output as Prisma.InputJsonValue | undefined,
            errorJson: entry.error as Prisma.InputJsonValue | undefined,
          })),
        });
      }
      if (result.manualReview) {
        await tx.decisionManualReviewCase.create({
          data: {
            executionId: execution.id,
            tenantId: input.tenantId,
            caseCode: manualReviewCaseCode(execution.id),
            queueCode: result.manualReview.queueCode,
            priority: result.manualReview.priority,
            dueAt: new Date(
              (input.decidedAt ?? new Date()).getTime() + result.manualReview.slaMinutes * 60_000,
            ),
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
  }
}

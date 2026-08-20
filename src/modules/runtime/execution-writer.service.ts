import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, Prisma, SubjectReferencePolicy } from '@prisma/client';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import type { ResolvedVariableSnapshot } from '../variables/variable-resolution.service';
import { outcomeWindowsFor, windowDueAt } from './outcome-windows';

/** Complete persistence payload for one decision execution and its evidence. */
export interface WriteExecutionInput {
  tenantId: bigint;
  deployment: ResolvedDeployment;
  requestId: string;
  correlationId?: string;
  idempotencyKey: string;
  subjectReference?: string;
  /** Por qué no hay sujeto, cuando no lo hay. Lo decide `subject-policy.ts`. */
  subjectAbsenceReason?: SubjectReferencePolicy | null;
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
    const subjectReferenceHash = input.subjectReference
      ? this.hashes.hmac(input.subjectReference)
      : undefined;
    const subjectId = subjectReferenceHash
      ? await this.resolveSubject(tx, input.tenantId, subjectReferenceHash)
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
        decisionStatus: this.executionStatus(result, input.errors),
        businessOutcome: result?.outcome,
        durationMs: input.durationMs,
      },
    });

    if (subjectId) await this.scheduleOutcomeWindows(tx, input, execution.id);

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
            evaluationResultJson: step.evaluation as Prisma.InputJsonValue,
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
  }

  /**
   * Devuelve el id del sujeto, creándolo si es su primera decisión.
   *
   * `INSERT … ON CONFLICT DO UPDATE … RETURNING` y no `prisma.upsert` por una razón que sólo
   * se ve bajo carga: dos decisiones simultáneas del mismo solicitante —un reintento del
   * integrador, una doble pulsación— compiten por la misma clave única. El `upsert` de Prisma
   * son dos sentencias, así que la perdedora recibe P2002 y ABORTA LA TRANSACCIÓN entera,
   * tirando una decisión ya calculada por un choque de contabilidad. `ON CONFLICT` lo resuelve
   * dentro de la misma sentencia y las dos decisiones sobreviven.
   *
   * El `DO UPDATE` no es decorativo: además de devolver la fila existente, adelanta
   * `last_seen_at` y suma al contador, que es justo lo que hace útil la tabla para ordenar por
   * actividad sin recorrer las ejecuciones.
   */
  private async resolveSubject(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    subjectReferenceHash: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO "decision_subject" ("tenant_id", "subject_reference_hash", "decision_count")
      VALUES (${tenantId}, ${subjectReferenceHash}, 1)
      ON CONFLICT ("tenant_id", "subject_reference_hash") DO UPDATE
        SET "last_seen_at" = now(),
            "decision_count" = "decision_subject"."decision_count" + 1
      RETURNING "id"
    `;
    return rows[0].id;
  }

  /**
   * Materializa las ventanas de observación de una decisión que origina crédito.
   *
   * Se hace aquí, en la misma transacción que la ejecución, y no en un barrido posterior: un
   * barrido que deja de correr produce exactamente el silencio que todo esto viene a eliminar
   * —cero ventanas pendientes leído como «todo observado»—, mientras que una ventana escrita
   * junto a su decisión existe siempre que la decisión exista.
   *
   * Sólo se programan con sujeto. Sin él no hay a quién atribuir el desenlace, así que la
   * ventana nacería imposible de cerrar y llenaría la cola de trabajo que nadie puede hacer.
   */
  private async scheduleOutcomeWindows(
    tx: Prisma.TransactionClient,
    input: WriteExecutionInput,
    executionId: bigint,
  ): Promise<void> {
    const windows = outcomeWindowsFor(
      input.deployment.riskDomain,
      this.config.get<string>('OUTCOME_WINDOW_DAYS'),
    );
    if (!windows.length) return;
    const decidedAt = new Date();
    await tx.outcomeWindowSchedule.createMany({
      data: windows.map((windowDays) => ({
        tenantId: input.tenantId,
        executionId,
        windowDays,
        dueAt: windowDueAt(decidedAt, windowDays),
      })),
      skipDuplicates: true,
    });
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

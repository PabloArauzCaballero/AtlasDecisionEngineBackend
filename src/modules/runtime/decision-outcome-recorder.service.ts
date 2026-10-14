import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { GuardVerdict } from '../risk-governance/decision-guard.service';
import {
  errorCodeOfFailure,
  httpStatusOfFailure,
  isRetryableFailure,
} from './decision-failure-policy';
import type {
  AdmittedDecision,
  DecisionRequest,
  IdempotencyReservation,
  RuntimeHttpResult,
} from './decision-request';
import { decisionValidUntil, executedDecisionBody } from './decision-response';
import { appendDecisionAudit, executionInputOf, type ExecutionEvidence } from './decision-evidence';
import { ExecutionWriterService } from './execution-writer.service';
import { IdempotencyService } from './idempotency.service';

/**
 * Cierra cada decisión con su evidencia: la ejecución, el resultado de idempotencia y el evento
 * de auditoría se confirman juntos o no se confirma ninguno. Las llamadas de red (variables,
 * motor) quedan fuera a propósito: nunca deben mantener abierta una transacción de base de datos.
 */
@Injectable()
export class DecisionOutcomeRecorderService {
  private readonly logger = new Logger(DecisionOutcomeRecorderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly writer: ExecutionWriterService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /** Decisión ejecutada: 200. */
  async recordExecuted(
    admitted: AdmittedDecision,
    evidence: ExecutionEvidence & { guard: GuardVerdict },
  ): Promise<RuntimeHttpResult> {
    const { request, deployment, reservation } = admitted;
    const { result, durationMs } = evidence;
    const body = await this.prisma.$transaction(async (tx) => {
      const execution = await this.writer.write(
        executionInputOf(admitted, evidence, { result }),
        tx,
      );
      const responseBody = executedDecisionBody(request, {
        deployment,
        executionId: execution.id,
        result,
        guard: evidence.guard,
        snapshots: evidence.variableSnapshots,
        validUntil: decisionValidUntil(admitted.now, this.config.get('DECISION_VALIDITY_SECONDS')),
      });
      await this.idempotency.complete(
        reservation.id,
        reservation.lease,
        { httpStatus: 200, body: responseBody },
        tx,
      );
      await appendDecisionAudit(
        this.audit,
        request,
        {
          eventType: 'DECISION_EXECUTED',
          aggregateType: 'DecisionExecution',
          aggregateId: execution.id,
        },
        tx,
        {
          artifactCode: request.artifactCode,
          versionId: deployment.artifactVersionId.toString(),
          outcome: result.outcome,
          durationMs,
          reasonCodes: result.reasons.map((reason) => reason.code),
        },
      );
      return responseBody;
    });
    this.metrics.recordDecision(String(result.outcome), String(result.status));
    return { httpStatus: 200, body };
  }

  /**
   * Cierra la reserva tras un fallo.
   *
   * A transient failure (DB timeout, variable backend down, script runner unavailable) must not
   * be cached as a terminal FAILED: doing so would trap the idempotency key and force the caller
   * to invent a new one to retry. Release the reservation so an identical retry can re-claim it.
   * Only deterministic business failures are cached.
   */
  async recordFailure(
    request: DecisionRequest,
    reservation: IdempotencyReservation,
    error: unknown,
  ): Promise<void> {
    if (!isRetryableFailure(error)) {
      await this.recordDeterministicFailure(request, reservation, error);
    } else {
      await this.idempotency.release(reservation.id, reservation.lease);
    }
    this.metrics.recordDecision('FAILED', 'FAILED');
  }

  /**
   * Persists the terminal FAILED outcome and its audit evidence in one transaction.
   *
   * A deterministic failure is a decision the platform actually took — the caller is told
   * "no", and every retry with the same key replays that same "no". Persistence is best-effort
   * on purpose: if the database is what broke, the caller must still receive the original error
   * rather than a masking one.
   */
  private async recordDeterministicFailure(
    request: DecisionRequest,
    reservation: IdempotencyReservation,
    error: unknown,
  ): Promise<void> {
    const errorCode = errorCodeOfFailure(error);
    const httpStatus = httpStatusOfFailure(error);
    const body = {
      requestId: request.dto.requestId,
      status: 'FAILED',
      error: {
        code: errorCode,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.idempotency.fail(reservation.id, reservation.lease, { httpStatus, body }, tx);
        await appendDecisionAudit(
          this.audit,
          request,
          {
            eventType: 'DECISION_FAILED',
            aggregateType: 'RuntimeIdempotency',
            aggregateId: reservation.id,
          },
          tx,
          {
            artifactCode: request.artifactCode,
            requestId: request.dto.requestId,
            correlationId: request.dto.correlationId ?? null,
            errorCode,
            httpStatus,
          },
        );
      });
    } catch (persistenceError) {
      this.logger.error(
        `Could not persist the FAILED outcome for idempotency reservation ${reservation.id.toString()}: ${
          persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
        }`,
      );
    }
  }
}

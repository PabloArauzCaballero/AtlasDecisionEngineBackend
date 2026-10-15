import { Injectable } from '@nestjs/common';
import { ExecutionStatus } from '@prisma/client';
import { AuditService, type AppendAuditEventInput } from '../../common/audit/audit.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { GuardVerdict } from '../risk-governance/decision-guard.service';
import type { RoleViolation } from '../risk-governance/semantic-outputs';
import type { VariableResolutionResult } from '../variables/variable-resolution.service';
import { appendDecisionAudit, executionInputOf, type ExecutionEvidence } from './decision-evidence';
import type { AdmittedDecision, RuntimeHttpResult } from './decision-request';
import {
  enablingBasisReviewBody,
  invalidEconomicOutputBody,
  missingVariablesBody,
} from './decision-response';
import { ExecutionWriterService, type WriteExecutionInput } from './execution-writer.service';
import { IdempotencyService } from './idempotency.service';

/**
 * Guarda las negativas con evidencia (NO_DECISION, 422): la ejecución, el resultado de
 * idempotencia fallido y el evento de auditoría se confirman juntos o no se confirma ninguno.
 */
@Injectable()
export class DecisionRefusalRecorderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: ExecutionWriterService,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /** Variables de entrada ausentes o inválidas: NO_DECISION, 422. */
  async recordMissingVariables(
    admitted: AdmittedDecision,
    evidence: {
      inputSnapshot: Record<string, unknown>;
      resolution: VariableResolutionResult;
      durationMs: number;
    },
  ): Promise<RuntimeHttpResult> {
    const { request, deployment } = admitted;
    const { resolution } = evidence;
    const body = await this.recordRefusal(admitted, {
      writeInput: executionInputOf(
        admitted,
        {
          inputSnapshot: evidence.inputSnapshot,
          variableSnapshots: resolution.snapshots,
          durationMs: evidence.durationMs,
        },
        {
          errors: resolution.errors.map((error) => ({
            code: error.code,
            type: 'VARIABLE_RESOLUTION',
            message: error.message,
            retryable: false,
            details: { variable: error.variable },
          })),
        },
      ),
      buildBody: (executionId) =>
        missingVariablesBody(request, deployment, executionId, resolution.errors),
      eventType: 'DECISION_NO_DECISION_VARIABLES',
      auditPayload: () => ({ artifactCode: request.artifactCode, errors: resolution.errors }),
    });
    return { httpStatus: 422, body };
  }

  /**
   * Falta la base habilitante y la politica manda a revision: NO se ejecuta el grafo.
   *
   * Queda una ejecucion NO_DECISION con los motivos por finalidad —sin las variables de entrada:
   * la evidencia es la negativa y su porque, no el dato—.
   */
  async recordBasisReview(
    admitted: AdmittedDecision,
    verdict: GuardVerdict,
    durationMs: number,
  ): Promise<RuntimeHttpResult> {
    const { request, deployment } = admitted;
    const failures = verdict.basis.failures;
    const body = await this.recordRefusal(admitted, {
      writeInput: executionInputOf(
        admitted,
        { inputSnapshot: {}, variableSnapshots: [], durationMs },
        {
          errors: failures.map((failure) => ({
            code: `ENABLING_BASIS_${failure.reason}`,
            type: 'ENABLING_BASIS',
            message: `Finalidad ${failure.purpose}: ${failure.reason}`,
            retryable: false,
            details: { purpose: failure.purpose, policySource: verdict.basis.policy.source },
          })),
        },
      ),
      buildBody: (executionId) =>
        enablingBasisReviewBody(request, deployment, executionId, verdict),
      eventType: 'DECISION_NO_DECISION_ENABLING_BASIS',
      auditPayload: () => ({
        artifactCode: request.artifactCode,
        policySource: verdict.basis.policy.source,
        failures: failures.map((failure) => ({
          purpose: failure.purpose,
          reason: failure.reason,
        })),
      }),
    });
    return { httpStatus: 422, body };
  }

  /**
   * El grafo termino pero una salida economica no vale: se guarda TODO y no se autoriza nada.
   *
   * La ejecucion conserva salida, traza y motivos del grafo —es el expediente del defecto— con
   * estado NO_DECISION y un error por salida. No se abre caso de revision manual aunque el grafo
   * lo pidiera: la respuesta no lo anuncia, y un caso que nadie conoce es una bandeja fantasma.
   */
  async recordInvalidOutput(
    admitted: AdmittedDecision,
    evidence: ExecutionEvidence & { violations: RoleViolation[] },
  ): Promise<RuntimeHttpResult> {
    const { request, deployment } = admitted;
    const { result, violations } = evidence;
    const body = await this.recordRefusal(admitted, {
      writeInput: executionInputOf(admitted, evidence, {
        result: { ...result, manualReview: undefined },
        statusOverride: ExecutionStatus.NO_DECISION,
        errors: violations.map((violation) => ({
          code: violation.code,
          type: 'ECONOMIC_OUTPUT',
          message: violation.message,
          retryable: false,
          details: { field: violation.fieldCode, role: violation.role },
        })),
      }),
      buildBody: (executionId) =>
        invalidEconomicOutputBody(request, deployment, executionId, violations),
      eventType: 'DECISION_NO_DECISION_ECONOMIC_OUTPUT',
      auditPayload: () => ({
        artifactCode: request.artifactCode,
        versionId: deployment.artifactVersionId.toString(),
        graphOutcome: result.outcome ?? null,
        violations: violations.map((violation) => ({
          code: violation.code,
          field: violation.fieldCode,
        })),
      }),
    });
    return { httpStatus: 422, body };
  }

  /**
   * Una negativa con evidencia (422): ejecución, resultado de idempotencia fallido y auditoría en
   * la misma unidad de trabajo. Un NO_DECISION sigue siendo un resultado registrado.
   */
  private async recordRefusal(
    admitted: AdmittedDecision,
    refusal: {
      writeInput: WriteExecutionInput;
      buildBody: (executionId: bigint) => Record<string, unknown>;
      eventType: string;
      auditPayload: () => AppendAuditEventInput['payload'];
    },
  ): Promise<Record<string, unknown>> {
    const { request, reservation } = admitted;
    const body = await this.prisma.$transaction(async (tx) => {
      const execution = await this.writer.write(refusal.writeInput, tx);
      const responseBody = refusal.buildBody(execution.id);
      await this.idempotency.fail(
        reservation.id,
        reservation.lease,
        { httpStatus: 422, body: responseBody },
        tx,
      );
      await appendDecisionAudit(
        this.audit,
        request,
        {
          eventType: refusal.eventType,
          aggregateType: 'DecisionExecution',
          aggregateId: execution.id,
        },
        tx,
        refusal.auditPayload(),
      );
      return responseBody;
    });
    this.metrics.recordDecision('NO_DECISION', 'NO_DECISION');
    return body;
  }
}

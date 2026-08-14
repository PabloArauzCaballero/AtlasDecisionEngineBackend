import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/audit/audit.service';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import {
  APP_ATTRIBUTES,
  DECISION_ATTRIBUTES,
  SPAN_NAMES,
} from '../../common/observability/telemetry.constants';
import { TracingService } from '../../common/observability/tracing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { WorkerServiceInvokerService } from '../workers/worker-service-invoker.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { DecisionGuardService } from '../risk-governance/decision-guard.service';
import { ExecuteDecisionDto } from './runtime.dto';
import { applySubjectPolicy } from './subject-policy';
import { IdempotencyService } from './idempotency.service';
import { ExecutionWriterService } from './execution-writer.service';

/**
 * Cuanto pide esta solicitud, para proyectar la exposicion.
 *
 * Se busca entre unos pocos nombres corrientes y se devuelve 0 si no aparece ninguno. Un 0 hace
 * que el limite se compruebe contra la exposicion ACTUAL, que sigue siendo una comprobacion util:
 * el que ya esta por encima del techo no recibe mas. Inventar un importe seria peor.
 */
const AMOUNT_FIELDS = ['requested_amount', 'requestedAmount', 'monto_solicitado', 'loan_amount'];

function requestedAmountOf(variables: Record<string, unknown>): number {
  for (const field of AMOUNT_FIELDS) {
    const value = variables[field];
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

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
    /**
     * Puente hacia los servicios de los workers (nodos `WORKER`). Se ata al tenant y al
     * principal de la petición y se entrega al motor como argumento de llamada.
     */
    private readonly workerServices: WorkerServiceInvokerService,
    private readonly tracing: TracingService,
    /**
     * Las condiciones que no dependen del solicitante ni del grafo: apetito de cartera y
     * licitud vigente. Vivian como reglas puras que no llamaba nadie.
     */
    private readonly guard: DecisionGuardService,
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
    return this.tracing.runInSpan(
      SPAN_NAMES.decisionExecute,
      {
        [APP_ATTRIBUTES.module]: 'runtime',
        [APP_ATTRIBUTES.operation]: 'execute',
        [APP_ATTRIBUTES.tenantId]: tenantId.toString(),
        [APP_ATTRIBUTES.entityType]: 'DecisionExecution',
        // El CÓDIGO del artefacto, que es un catálogo acotado. Ni las variables de entrada ni
        // la referencia del solicitante entran aquí: son exactamente los datos financieros
        // personales que el sistema de trazas no debe custodiar.
        [DECISION_ATTRIBUTES.artifactCode]: artifactCode,
      },
      async (span) => {
        const result = await this.runDecision(tenantId, artifactCode, dto, principal);
        // Un único punto de salida para el resultado: `runDecision` retorna por media docena
        // de caminos (réplica idempotente, variables inválidas, decisión, fallo de negocio) y
        // anotar cada uno habría dejado alguno sin atributo a la primera modificación.
        const outcome = (result.body as { outcome?: unknown }).outcome;
        if (typeof outcome === 'string') span.setAttribute(DECISION_ATTRIBUTES.outcome, outcome);
        span.setAttribute('http.response.status_code', result.httpStatus);
        return result;
      },
    );
  }

  private async runDecision(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
  ): Promise<RuntimeHttpResult> {
    const environmentCode =
      dto.environmentCode ?? this.config.get<string>('DEFAULT_ENVIRONMENT') ?? 'PROD';
    this.tracing.setAttribute(DECISION_ATTRIBUTES.environment, environmentCode);
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
      /*
       * La exigencia de sujeto se comprueba ANTES de resolver variables y de ejecutar.
       *
       * No es una optimización: es el único punto en el que el sistema puede todavía negarse a
       * crear evidencia irreparable. Pasado aquí, la ejecución se escribe, la referencia se
       * guarda como HMAC de una vía, y ya no hay forma de decir a quién pertenecía esa
       * decisión — ni de darle un desenlace, ni de atenderle un derecho de acceso.
       */
      const subject = applySubjectPolicy(deployment.subjectPolicy, dto.subjectReference);
      /*
       * Apetito de cartera y licitud vigente, ANTES de resolver variables y de ejecutar.
       *
       * Las dos pueden decir «no», y ese «no» no es una negativa de riesgo sobre el solicitante:
       * es presupuesto agotado o un permiso vencido. Comprobarlo aqui evita gastar la ejecucion
       * -y, con ella, las llamadas a proveedores- en una decision que no se va a poder conceder.
       *
       * Sin sujeto no comprueba nada: los dos controles son sobre una persona concreta. Que sea
       * asi es un motivo mas para exigir sujeto, no una excusa para no exigirlo.
       */
      await this.guard.assertCanDecide(
        tenantId,
        await this.subjectIdOf(tenantId, subject.subjectReference),
        requestedAmountOf(dto.variables),
      );
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
        metadata: dto.variableMetadata,
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
              subjectReference: subject.subjectReference,
              subjectAbsenceReason: subject.absenceReason,
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
          await this.idempotency.fail(
            reservation.id,
            reservation.lease,
            { httpStatus: 422, body: responseBody },
            tx,
          );
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

      // Hitos dentro del span de la decisión, no spans propios: la resolución de variables y
      // el recorrido del grafo son fases de UNA operación, y partirlas en spans hermanos sólo
      // añadiría profundidad a la traza sin decir nada que estos dos eventos no digan ya.
      this.tracing.addEvent('variables.resolved', {
        'decision.variables.count': resolution.snapshots.length,
      });
      const result = await this.engine.execute(
        deployment.compiled,
        resolution.values,
        this.nestedTrees.bind(tenantId, principal),
        undefined,
        undefined,
        this.workerServices.bind(tenantId, principal),
      );
      this.tracing.addEvent('engine.completed', {
        [DECISION_ATTRIBUTES.steps]: result.trace.length,
      });
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      /*
       * El rango de las salidas economicas se comprueba AQUI y no al compilar: el valor lo produce
       * un script en tiempo de ejecucion, y al compilar solo existe la promesa. No lanza -tirar
       * una decision ya calculada castigaria al solicitante por un defecto del artefacto- pero
       * deja constancia, y el gate del contrato economico impide que un artefacto asi llegue a
       * produccion.
       */
      await this.guard.reviewOutputs(
        tenantId,
        deployment.artifactVersionId,
        result.output as Record<string, unknown> | undefined,
      );

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
            subjectReference: subject.subjectReference,
            subjectAbsenceReason: subject.absenceReason,
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
          reservation.lease,
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
        await this.idempotency.release(reservation.id, reservation.lease);
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
        reservation.lease,
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
    reservationLease: Date,
    outcome: { httpStatus: number; body: Record<string, unknown>; errorCode: string },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.idempotency.fail(
          reservationId,
          reservationLease,
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

  /**
   * El sujeto ya resuelto, si esta decision lleva solicitante y ya se le decidio antes.
   *
   * Devuelve `null` la primera vez que se ve a alguien, y eso es correcto: sin historial no hay
   * exposicion acumulada que comprobar ni permisos que hayan podido vencer.
   */
  private async subjectIdOf(tenantId: bigint, subjectReference?: string): Promise<bigint | null> {
    if (!subjectReference) return null;
    const subject = await this.prisma.decisionSubject.findFirst({
      where: { tenantId, subjectReferenceHash: this.hashes.hmac(subjectReference) },
      select: { id: true },
    });
    return subject?.id ?? null;
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

import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus } from '@prisma/client';
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
import { DECISION_CLOCK, systemClock, type Clock } from '../../common/time/clock';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { WorkerServiceInvokerService } from '../workers/worker-service-invoker.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { DecisionGuardService, type GuardVerdict } from '../risk-governance/decision-guard.service';
import {
  EnablingBasisPolicyError,
  parseUndeclaredBasisMode,
  resolveEnablingBasisPolicy,
  type EnablingBasisPolicy,
} from '../risk-governance/enabling-basis';
import type { RoleViolation } from '../risk-governance/semantic-outputs';
import type { ResolvedVariableSnapshot } from '../variables/variable-resolution.service';
import { ExecuteDecisionDto } from './runtime.dto';
import { applySubjectPolicy } from './subject-policy';
import { IdempotencyService } from './idempotency.service';
import { ExecutionWriterService } from './execution-writer.service';
import { manualReviewCaseCode } from './manual-review-case-code';

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

/**
 * Cuánto vale una decisión aprobada para conceder, si nadie lo configura: una hora.
 *
 * El motor no reserva exposición (lee los créditos ya registrados), así que dos decisiones
 * simultáneas del mismo solicitante pueden pasar las dos. Quien concede tiene que revalidar, y
 * una decisión que no caduca le permitiría conceder mañana con la exposición de hoy.
 */
const DEFAULT_DECISION_VALIDITY_SECONDS = 259_200;

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
    /**
     * El reloj de la decisión. UN instante por petición para la vigencia de la base, la frescura
     * de las variables, el vencimiento de la decisión y las ventanas de observación.
     */
    @Optional() @Inject(DECISION_CLOCK) private readonly clock: Clock = systemClock,
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
    const now = this.clock();
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
       * Apetito de cartera y base habilitante, ANTES de resolver variables y de ejecutar.
       *
       * Pueden decir «no», y ese «no» no es una negativa de riesgo sobre el solicitante: es
       * presupuesto agotado o falta de base para tratar sus datos. Comprobarlo aqui evita gastar
       * la ejecucion -y, con ella, las llamadas a proveedores- en una decision que no se va a
       * poder conceder, y evita TRATAR los datos de alguien sin base para hacerlo.
       *
       * Un sujeto todavia no materializado (primer solicitante) ya no elude nada: exposicion cero
       * pero comparada, y sin bases registradas. Sin referencia de sujeto, una politica que exige
       * base no se puede satisfacer.
       */
      const guardVerdict = await this.guard.checkBeforeDecision({
        tenantId,
        subjectId: await this.subjectIdOf(tenantId, subject.subjectReference),
        subjectReferencePresent: Boolean(subject.subjectReference),
        requestedAmount: requestedAmountOf(dto.variables),
        basisPolicy: this.basisPolicyFor(deployment),
        now,
      });
      if (!guardVerdict.basis.satisfied) {
        return await this.recordBasisReview(
          tenantId,
          artifactCode,
          dto,
          principal,
          deployment,
          subject,
          guardVerdict,
          reservation,
          started,
          now,
        );
      }
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
        now,
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
              decidedAt: now,
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
       * un script en tiempo de ejecucion, y al compilar solo existe la promesa.
       *
       * Y la lista SE USA. Antes se registraba y la decision salia igual, con una PD de 4,2 o un
       * limite negativo dentro de una respuesta SUCCEEDED que el llamante podia leer como una
       * autorizacion. Ahora la ejecucion se guarda entera como evidencia y la respuesta es
       * NO_DECISION con motivo TECNICO: un defecto del artefacto no es una negativa sobre el
       * solicitante, y tampoco puede ser una concesion.
       */
      const violations = await this.guard.reviewOutputs(
        tenantId,
        deployment.artifactVersionId,
        result.output as Record<string, unknown> | undefined,
        { limit: result.limit },
      );
      if (violations.length) {
        return await this.recordInvalidOutput(
          tenantId,
          artifactCode,
          dto,
          principal,
          deployment,
          subject,
          {
            inputSnapshot,
            variableSnapshots: resolution.snapshots,
            result,
            violations,
            durationMs,
          },
          reservation,
          now,
        );
      }

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
            decidedAt: now,
            variableSnapshots: resolution.snapshots,
            result,
          },
          tx,
        );
        const responseBody = this.buildBody(dto, artifactCode, deployment, execution, result, {
          guard: guardVerdict,
          snapshots: resolution.snapshots,
          now,
        });
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
    context: { guard: GuardVerdict; snapshots: ResolvedVariableSnapshot[]; now: Date },
  ): Record<string, unknown> {
    const succeeded = String(result.status) === ExecutionStatus.SUCCEEDED;
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
      /*
       * Si esta ejecucion abrio un caso de revision manual, y en que cola.
       *
       * Lo pide quien nos llama, no nosotros: AtlasBackend abria SU propio caso para el mismo
       * cliente cada vez que el desenlace no era un «sigue adelante», y su portal lo dejaba
       * resolver con otro formulario. Dos bandejas para la misma persona, dos bitacoras que no se
       * hablan y ninguna respuesta a «quien aprobo».
       *
       * Ahora Atlas delega en nosotros SOLO cuando aqui hay de verdad un caso que atender. Sin este
       * campo tendria que adivinarlo por el desenlace, y se equivocaria: un REJECT no abre caso, y
       * el analista acabaria en una ejecucion sin bandeja mientras la unica cola posible —la suya—
       * estaba cerrada por nosotros.
       *
       * `null` cuando el grafo no paso por un nodo de revision manual. El caso se crea en la misma
       * transaccion que la ejecucion (`ExecutionWriterService`), asi que anunciarlo aqui no puede
       * mentir: o estan los dos o no esta ninguno.
       */
      manualReview: result.manualReview
        ? {
            caseCode: manualReviewCaseCode(execution.id),
            queueCode: result.manualReview.queueCode,
            priority: result.manualReview.priority,
          }
        : null,
      traceReference: execution.id.toString(),
      /*
       * Lo que quien CONCEDE necesita para revalidar (campos aditivos, P-11).
       *
       * El motor decide y el core concede. El motor lee la exposicion de los creditos ya
       * registrados y NO reserva: `exposure` publica cuanto quedaba y cuanto queda si se concede
       * lo pedido, y `decisionValidUntil` pone fecha de caducidad a la decision. El core reserva
       * contra su libro de forma atomica y no concede despues de esa fecha ni por encima de
       * `exposure.remainingAfterDecision`. Nulo cuando la decision no termino en SUCCEEDED.
       */
      decisionValidUntil: succeeded ? this.validUntil(context.now).toISOString() : null,
      exposure: context.guard.exposure,
      enablingBasis: {
        policySource: context.guard.basis.policy.source,
        purposes: context.guard.basis.policy.requirements.map((requirement) => requirement.purpose),
      },
      /*
       * Frescura (P-10). `degradedInputs` = alguna variable entro vieja, con sello dudoso o con
       * frescura desconocida; `freshnessUnknown` = las CRITICAS cuya frescura no se pudo
       * comprobar. El core no debe originar con datos criticos desconocidos.
       */
      degradedInputs: context.snapshots.some((snapshot) => snapshot.freshness?.degraded),
      freshnessUnknown: context.snapshots
        .filter((snapshot) => snapshot.freshness?.unknown)
        .map((snapshot) => snapshot.code),
    };
  }

  private validUntil(now: Date): Date {
    const configured = Number(this.config.get('DECISION_VALIDITY_SECONDS'));
    const seconds =
      Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_DECISION_VALIDITY_SECONDS;
    return new Date(now.getTime() + seconds * 1_000);
  }

  /**
   * La politica de base habilitante de este despliegue.
   *
   * Una politica declarada que no se puede interpretar falla CERRADO y de forma determinista: es
   * un defecto de la version, no una razon para decidir sin control.
   */
  private basisPolicyFor(deployment: ResolvedDeployment): EnablingBasisPolicy {
    try {
      return resolveEnablingBasisPolicy({
        declared: deployment.enablingBasisPolicy,
        legalBasis: deployment.legalBasis,
        riskDomain: deployment.riskDomain,
        isProductionEnvironment: deployment.isProductionEnvironment,
        undeclaredMode: parseUndeclaredBasisMode(
          this.config.get<string>('ENABLING_BASIS_UNDECLARED_ORIGINATION'),
        ),
      });
    } catch (error) {
      if (error instanceof EnablingBasisPolicyError) {
        throw new DomainException(
          'ENABLING_BASIS_POLICY_INVALID',
          error.message,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * Falta la base habilitante y la politica manda a revision: NO se ejecuta el grafo.
   *
   * Ejecutarlo seria tratar los datos del solicitante sin base para hacerlo, que es justo lo que
   * este control impide. Queda una ejecucion NO_DECISION con los motivos por finalidad —sin las
   * variables de entrada: la evidencia es la negativa y su porque, no el dato— y la respuesta es
   * un 422 con la misma forma que el NO_DECISION por variables. El core la lee como revision,
   * nunca como aprobacion ni como rechazo crediticio.
   */
  private async recordBasisReview(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
    deployment: ResolvedDeployment,
    subject: ReturnType<typeof applySubjectPolicy>,
    verdict: GuardVerdict,
    reservation: { id: bigint; lease: Date },
    started: number,
    now: Date,
  ): Promise<RuntimeHttpResult> {
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const failures = verdict.basis.failures;
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
          inputSnapshot: {},
          durationMs,
          decidedAt: now,
          variableSnapshots: [],
          errors: failures.map((failure) => ({
            code: `ENABLING_BASIS_${failure.reason}`,
            type: 'ENABLING_BASIS',
            message: `Finalidad ${failure.purpose}: ${failure.reason}`,
            retryable: false,
            details: { purpose: failure.purpose, policySource: verdict.basis.policy.source },
          })),
        },
        tx,
      );
      const responseBody = {
        requestId: dto.requestId,
        correlationId: dto.correlationId,
        executionId: execution.id.toString(),
        status: ExecutionStatus.NO_DECISION,
        outcome: ExecutionStatus.NO_DECISION,
        reasonCodes: [
          {
            code: 'ENABLING_BASIS_MISSING',
            category: 'COMPLIANCE',
            message:
              'Falta una base habilitante vigente para tratar los datos del solicitante con esta ' +
              'finalidad. No es una negativa de riesgo: la solicitud va a revision.',
            adverseAction: false,
          },
        ],
        errors: failures.map((failure) => ({
          code: `ENABLING_BASIS_${failure.reason}`,
          purpose: failure.purpose,
        })),
        enablingBasis: { policySource: verdict.basis.policy.source, failures },
        decisionValidUntil: null,
        artifact: this.artifactRef(artifactCode, deployment),
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
          eventType: 'DECISION_NO_DECISION_ENABLING_BASIS',
          aggregateType: 'DecisionExecution',
          aggregateId: execution.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            artifactCode,
            policySource: verdict.basis.policy.source,
            failures: failures.map((failure) => ({
              purpose: failure.purpose,
              reason: failure.reason,
            })),
          },
        },
        tx,
      );
      return responseBody;
    });
    this.metrics.recordDecision('NO_DECISION', 'NO_DECISION');
    return { httpStatus: 422, body };
  }

  /**
   * El grafo termino pero una salida economica no vale: se guarda TODO y no se autoriza nada.
   *
   * La ejecucion conserva salida, traza y motivos del grafo —es el expediente del defecto— con
   * estado NO_DECISION y un error por salida. No se abre caso de revision manual aunque el grafo
   * lo pidiera: la respuesta no lo anuncia, y un caso que nadie conoce es una bandeja fantasma.
   */
  private async recordInvalidOutput(
    tenantId: bigint,
    artifactCode: string,
    dto: ExecuteDecisionDto,
    principal: AuthenticatedPrincipal,
    deployment: ResolvedDeployment,
    subject: ReturnType<typeof applySubjectPolicy>,
    evidence: {
      inputSnapshot: Record<string, unknown>;
      variableSnapshots: ResolvedVariableSnapshot[];
      result: EngineExecutionResult;
      violations: RoleViolation[];
      durationMs: number;
    },
    reservation: { id: bigint; lease: Date },
    now: Date,
  ): Promise<RuntimeHttpResult> {
    const { result, violations } = evidence;
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
          inputSnapshot: evidence.inputSnapshot,
          durationMs: evidence.durationMs,
          decidedAt: now,
          variableSnapshots: evidence.variableSnapshots,
          result: { ...result, manualReview: undefined },
          statusOverride: ExecutionStatus.NO_DECISION,
          errors: violations.map((violation) => ({
            code: violation.code,
            type: 'ECONOMIC_OUTPUT',
            message: violation.message,
            retryable: false,
            details: { field: violation.fieldCode, role: violation.role },
          })),
        },
        tx,
      );
      const responseBody = {
        requestId: dto.requestId,
        correlationId: dto.correlationId,
        executionId: execution.id.toString(),
        status: ExecutionStatus.NO_DECISION,
        outcome: ExecutionStatus.NO_DECISION,
        reasonCodes: [
          {
            code: 'ECONOMIC_OUTPUT_INVALID',
            category: 'TECHNICAL',
            message:
              'La politica produjo una salida economica fuera de rango. Es un defecto del ' +
              'artefacto, no una negativa sobre el solicitante: la solicitud va a revision.',
            adverseAction: false,
          },
        ],
        errors: violations.map((violation) => ({
          code: violation.code,
          field: violation.fieldCode,
          message: violation.message,
        })),
        decisionValidUntil: null,
        artifact: this.artifactRef(artifactCode, deployment),
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
          eventType: 'DECISION_NO_DECISION_ECONOMIC_OUTPUT',
          aggregateType: 'DecisionExecution',
          aggregateId: execution.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            artifactCode,
            versionId: deployment.artifactVersionId.toString(),
            graphOutcome: result.outcome ?? null,
            violations: violations.map((violation) => ({
              code: violation.code,
              field: violation.fieldCode,
            })),
          },
        },
        tx,
      );
      return responseBody;
    });
    this.metrics.recordDecision('NO_DECISION', 'NO_DECISION');
    return { httpStatus: 422, body };
  }

  private artifactRef(artifactCode: string, deployment: ResolvedDeployment) {
    return {
      code: artifactCode,
      versionId: deployment.artifactVersionId.toString(),
      deploymentId: deployment.deploymentId.toString(),
      environment: deployment.environmentCode,
      checksum: deployment.compiledChecksum,
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

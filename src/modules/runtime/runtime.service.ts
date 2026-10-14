import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../../common/crypto/hash.service';
import {
  APP_ATTRIBUTES,
  DECISION_ATTRIBUTES,
  SPAN_NAMES,
} from '../../common/observability/telemetry.constants';
import { TracingService } from '../../common/observability/tracing.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { DECISION_CLOCK, systemClock, type Clock } from '../../common/time/clock';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { WorkerServiceInvokerService } from '../workers/worker-service-invoker.service';
import { DecisionOutcomeRecorderService } from './decision-outcome-recorder.service';
import type { AdmittedDecision, DecisionRequest, RuntimeHttpResult } from './decision-request';
import { DecisionRefusalRecorderService } from './decision-refusal-recorder.service';
import { DecisionSafeguardsService } from './decision-safeguards.service';
import { IdempotencyService } from './idempotency.service';
import { ExecuteDecisionDto } from './runtime.dto';
import { applySubjectPolicy } from './subject-policy';

export type { RuntimeHttpResult } from './decision-request';

/**
 * Orchestrates the online decision path from idempotency through persisted evidence.
 *
 * The compiled graph engine remains transport-agnostic; this service supplies deployment and
 * variable resolution. Guards live in `DecisionSafeguardsService`; evidence, audit, metrics and
 * the HTTP body of each outcome live in `DecisionOutcomeRecorderService`.
 */
@Injectable()
export class RuntimeService {
  constructor(
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly idempotency: IdempotencyService,
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly nestedTrees: NestedTreeExecutionService,
    /**
     * Puente hacia los servicios de los workers (nodos `WORKER`). Se ata al tenant y al
     * principal de la petición y se entrega al motor como argumento de llamada.
     */
    private readonly workerServices: WorkerServiceInvokerService,
    private readonly tracing: TracingService,
    private readonly safeguards: DecisionSafeguardsService,
    private readonly recorder: DecisionOutcomeRecorderService,
    private readonly refusals: DecisionRefusalRecorderService,
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
        const result = await this.runDecision({ tenantId, artifactCode, dto, principal });
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

  private async runDecision(request: DecisionRequest): Promise<RuntimeHttpResult> {
    const { tenantId, artifactCode, dto } = request;
    const environmentCode =
      dto.environmentCode ?? this.config.get<string>('DEFAULT_ENVIRONMENT') ?? 'PROD';
    this.tracing.setAttribute(DECISION_ATTRIBUTES.environment, environmentCode);
    const reservation = await this.idempotency.reserve(
      tenantId,
      artifactCode,
      dto.idempotencyKey,
      this.requestHashOf(request, environmentCode),
    );
    if (reservation.kind === 'completed') return replayOf(reservation);

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
      const admitted: AdmittedDecision = { request, deployment, subject, reservation, now };
      return await this.decide(admitted, started);
    } catch (error) {
      await this.recorder.recordFailure(request, reservation, error);
      throw error;
    }
  }

  private async decide(admitted: AdmittedDecision, started: number): Promise<RuntimeHttpResult> {
    const { request, deployment, subject, now } = admitted;
    const { tenantId, artifactCode, dto, principal } = request;
    /*
     * Apetito de cartera y base habilitante, ANTES de resolver variables y de ejecutar.
     *
     * Pueden decir «no», y ese «no» no es una negativa de riesgo sobre el solicitante: es
     * presupuesto agotado o falta de base para tratar sus datos. Comprobarlo aqui evita gastar
     * la ejecucion -y, con ella, las llamadas a proveedores- en una decision que no se va a
     * poder conceder, y evita TRATAR los datos de alguien sin base para hacerlo.
     */
    const guard = await this.safeguards.checkBeforeDecision({
      tenantId,
      deployment,
      subject,
      variables: dto.variables,
      now,
    });
    if (!guard.basis.satisfied) {
      return this.refusals.recordBasisReview(admitted, guard, elapsedMsSince(started));
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
      return this.refusals.recordMissingVariables(admitted, {
        inputSnapshot,
        resolution,
        durationMs: elapsedMsSince(started),
      });
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
      // El `context` de la petición llega a los nodos WORKER por aquí (hoy: el origen
      // de la captura del carnet). Ver `WorkerServiceInvokerService.bind`.
      this.workerServices.bind(tenantId, principal, dto.context),
    );
    this.tracing.addEvent('engine.completed', {
      [DECISION_ATTRIBUTES.steps]: result.trace.length,
    });
    const evidence = {
      inputSnapshot,
      variableSnapshots: resolution.snapshots,
      result,
      durationMs: elapsedMsSince(started),
    };
    /*
     * Una salida economica fuera de rango NO se autoriza: la ejecucion se guarda entera como
     * evidencia y la respuesta es NO_DECISION con motivo TECNICO. Un defecto del artefacto no es
     * una negativa sobre el solicitante, y tampoco puede ser una concesion.
     */
    const violations = await this.safeguards.reviewOutputs(tenantId, deployment, result);
    if (violations.length) {
      return this.refusals.recordInvalidOutput(admitted, { ...evidence, violations });
    }
    return this.recorder.recordExecuted(admitted, { ...evidence, guard });
  }

  /** The environment is part of the request identity: the same key and payload aimed at a
   * different environment must not replay a decision computed for another one. */
  private requestHashOf(
    { tenantId, artifactCode, dto }: DecisionRequest,
    environmentCode: string,
  ): string {
    return this.hashes.sha256({
      tenantId: tenantId.toString(),
      artifactCode,
      environmentCode,
      requestId: dto.requestId,
      subjectReference: dto.subjectReference,
      variables: dto.variables,
      context: dto.context,
    });
  }
}

function elapsedMsSince(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

/** La respuesta ya guardada de una petición idéntica anterior. */
function replayOf(reservation: { response?: unknown; status?: string }): RuntimeHttpResult {
  const body = (reservation.response ?? {}) as Record<string, unknown>;
  return {
    httpStatus: Number(body.httpStatus ?? (reservation.status === 'FAILED' ? 422 : 200)),
    body: (body.body ?? body) as Record<string, unknown>,
  };
}

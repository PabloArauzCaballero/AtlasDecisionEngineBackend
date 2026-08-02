import { HttpStatus, Injectable } from '@nestjs/common';
import { canonicalize } from '../../common/crypto/canonical-json';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import { NestedTreeExecutionService } from '../nested-trees/nested-tree-execution.service';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { SimulateDecisionDto } from './simulation.dto';

/** Executes a deterministic dry-run without decision, idempotency or audit persistence. */
@Injectable()
export class SimulationService {
  constructor(
    private readonly deployments: DeploymentResolverService,
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
    private readonly nestedTrees: NestedTreeExecutionService,
    private readonly metrics: MetricsService,
  ) {}

  async simulate(
    tenantId: bigint,
    artifactCode: string,
    dto: SimulateDecisionDto,
    principal: AuthenticatedPrincipal,
  ): Promise<Record<string, unknown>> {
    const environmentCode = dto.environmentCode.toUpperCase();
    if (environmentCode === 'PROD') {
      throw new DomainException(
        'SIMULATION_PROD_FORBIDDEN',
        'Production decisions cannot be executed through the simulator',
        HttpStatus.FORBIDDEN,
      );
    }

    const started = performance.now();
    const deployment = await this.deployments.resolve(tenantId, artifactCode, environmentCode);
    const inputContracts = deployment.compiled.variables.filter(
      (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
    );
    const resolution = await this.variables.resolve(inputContracts, dto.variables, {
      tenantId,
      artifactCode,
      requestId: dto.requestId,
      // A dry-run must not call external variable providers. Operators must provide
      // every required value explicitly so the simulation remains reproducible.
      allowExternal: false,
    });
    const artifact = {
      code: artifactCode,
      versionId: deployment.artifactVersionId.toString(),
      deploymentId: deployment.deploymentId.toString(),
      environment: deployment.environmentCode,
      checksum: deployment.compiledChecksum,
    };

    if (!resolution.valid) {
      return {
        simulation: true,
        persisted: false,
        requestId: dto.requestId,
        status: 'NO_DECISION',
        outcome: 'NO_DECISION',
        output: {},
        reasonCodes: [
          {
            code: 'VARIABLE_MISSING_OR_INVALID',
            category: 'VALIDATION',
            message: 'One or more required variables are missing or invalid',
            adverseAction: false,
            priority: 1,
          },
        ],
        errors: resolution.errors,
        artifact,
        trace: { nodes: [], edges: [], terminal: null },
        durationMs: Math.max(0, Math.round(performance.now() - started)),
      };
    }

    const result = await this.engine.execute(
      deployment.compiled,
      resolution.values,
      this.nestedTrees.bind(tenantId, principal),
    );
    const productionComparison = dto.compareWithProduction
      ? await this.compareWithProduction(tenantId, artifactCode, principal, resolution.values, {
          outcome: result.outcome,
          output: result.output,
          reasonCodes: result.reasons.map((reason) => reason.code),
        })
      : undefined;
    return {
      simulation: true,
      ...(productionComparison ? { productionComparison } : {}),
      persisted: false,
      requestId: dto.requestId,
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
      artifact,
      trace: {
        nodes: result.visitedNodeKeys,
        edges: result.traversedEdgeKeys,
        terminal: result.terminalNodeKey,
        nested: result.nestedExecutions,
      },
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  /**
   * Ejecuta el artefacto activo en PROD con las MISMAS entradas ya resueltas y compara (§12).
   *
   * **Qué se compara y por qué así.** «Dos ejecuciones equivalentes entre ambientes» solo
   * está bien definido si se fija todo menos el ambiente. Por eso se reutilizan los valores
   * ya resueltos en vez de resolverlos otra vez: si cada lado resolviera los suyos, una
   * diferencia podría venir de un valor por defecto o de un proveedor, y la métrica dejaría
   * de medir lo que dice medir. Fijadas las entradas y siendo el motor determinista, lo único
   * que varía es el artefacto compilado que cada ambiente tiene desplegado — que es
   * exactamente la desviación que §12 quiere ver.
   *
   * Sigue sin persistir nada: es una segunda pasada del mismo motor en memoria.
   *
   * Que PROD no tenga despliegue **no** es un fallo de la simulación: se informa y la
   * simulación devuelve su resultado igual. Lo contrario haría que una herramienta de
   * diagnóstico dejara de funcionar justo en el artefacto que aún no ha salido a producción.
   */
  private async compareWithProduction(
    tenantId: bigint,
    artifactCode: string,
    principal: AuthenticatedPrincipal,
    values: Record<string, unknown>,
    simulated: { outcome: string; output: Record<string, unknown>; reasonCodes: string[] },
  ): Promise<Record<string, unknown>> {
    let production;
    try {
      production = await this.deployments.resolve(tenantId, artifactCode, 'PROD');
    } catch {
      this.metrics.recordDevProdDiff(artifactCode, 'PRODUCTION_NOT_DEPLOYED');
      return { compared: false, reason: 'PRODUCTION_NOT_DEPLOYED' };
    }

    const productionResult = await this.engine.execute(
      production.compiled,
      values,
      this.nestedTrees.bind(tenantId, principal),
    );
    const productionReasonCodes = productionResult.reasons.map((reason) => reason.code);
    const differences: string[] = [];
    if (productionResult.outcome !== simulated.outcome) differences.push('OUTCOME');
    // Canónico: dos salidas iguales con las claves en otro orden no son una divergencia.
    if (canonicalize(productionResult.output) !== canonicalize(simulated.output)) {
      differences.push('OUTPUT');
    }
    if (canonicalize(productionReasonCodes) !== canonicalize(simulated.reasonCodes)) {
      differences.push('REASON_CODES');
    }

    // Contar también las coincidencias da denominador a la tasa de divergencia.
    for (const difference of differences.length ? differences : ['NONE']) {
      this.metrics.recordDevProdDiff(artifactCode, difference);
    }
    return {
      compared: true,
      differs: differences.length > 0,
      differences,
      production: {
        versionId: production.artifactVersionId.toString(),
        deploymentId: production.deploymentId.toString(),
        checksum: production.compiledChecksum,
        outcome: productionResult.outcome,
        output: productionResult.output,
        reasonCodes: productionReasonCodes,
      },
    };
  }
}

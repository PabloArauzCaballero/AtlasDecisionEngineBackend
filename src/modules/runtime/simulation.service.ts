import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
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
    return {
      simulation: true,
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
}

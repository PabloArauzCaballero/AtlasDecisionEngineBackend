import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import {
  checkProperties,
  type ExecutionObservation,
  type PropertyViolation,
} from './qa-properties';
import { inputContractSnapshotsOf } from './qa-contract';

/** Ejecuta casos dentro del proceso, sin persistir nada, y comprueba las propiedades del QA Lab. */
@Injectable()
export class QaCaseObserverService {
  constructor(
    private readonly variables: VariableResolutionService,
    private readonly engine: ExecutionEngineService,
  ) {}

  /** Ejecuta un caso sin persistir nada y resume el resultado observable. */
  async observe(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    input: Record<string, unknown>,
  ): Promise<ExecutionObservation> {
    const resolution = await this.variables.resolve(inputContractSnapshotsOf(compiled), input, {
      tenantId,
      artifactCode: compiled.artifact.code,
      requestId: 'qa-lab',
      allowExternal: false,
    });
    if (!resolution.valid) {
      return {
        inputAccepted: false,
        output: {},
        status: 'NO_DECISION',
        signature: `REJECTED:${resolution.errors
          .map((error) => error.variable)
          .sort()
          .join(',')}`,
        errorCode: resolution.errors[0]?.code,
      };
    }
    try {
      const result = await this.engine.execute(compiled, resolution.values);
      return {
        inputAccepted: true,
        output: result.output,
        status: result.status,
        signature: JSON.stringify({ status: result.status, output: sortedKeys(result.output) }),
      };
    } catch (error) {
      const code = error instanceof DomainException ? error.code : 'UNEXPECTED_ENGINE_ERROR';
      return {
        inputAccepted: true,
        output: {},
        status: 'FAILED',
        signature: `FAILED:${code}`,
        errorCode: code,
      };
    }
  }

  /** Violaciones de un caso; con `determinism` lo ejecuta dos veces y compara. */
  async violationsOf(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    kind: string,
    input: Record<string, unknown>,
    determinism: boolean,
  ): Promise<PropertyViolation[]> {
    const observation = await this.observe(tenantId, compiled, input);
    const repeat = determinism
      ? (await this.observe(tenantId, compiled, input)).signature
      : undefined;
    return checkProperties({ compiled, kind, input }, observation, repeat);
  }

  async repeatedSignatures(
    tenantId: bigint,
    compiled: CompiledDecisionArtifact,
    input: Record<string, unknown>,
    times: number,
  ): Promise<string[]> {
    const signatures: string[] = [];
    for (let attempt = 0; attempt < times; attempt += 1) {
      signatures.push((await this.observe(tenantId, compiled, input)).signature);
    }
    return signatures;
  }
}

function sortedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

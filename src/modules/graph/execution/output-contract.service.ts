import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { MetricsService } from '../../../common/observability/metrics.service';
import type { CompiledDecisionArtifact } from '../graph.types';
import { outputContractsOf, type MutableExecutionState } from './execution-state';

/** Todo lo que se escribe en la salida pasa por el contrato de salida del artefacto, si lo hay. */
@Injectable()
export class OutputContractService {
  constructor(private readonly metrics: MetricsService) {}

  setOutputValue(
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    code: string,
    value: unknown,
  ): void {
    const contract = outputContractsOf(compiled).find((candidate) => candidate.code === code);
    if (!contract) {
      throw new DomainException('UNDECLARED_OUTPUT', `RESULT node wrote undeclared output ${code}`);
    }
    this.assertOutputType(code, contract.dataType, value, contract.nullable);
    state.output[code] = value;
    if (code === 'score' && value !== null) state.score = Number(value);
    if (code === 'riskBand' && value !== null) state.riskBand = String(value);
    if (code === 'limit' && value !== null) state.limit = Number(value);
    if (contract.usageType === 'OUTPUT_PRIMARY') {
      const legacyOutcome = value === null || value === undefined ? 'NO_DECISION' : String(value);
      if (legacyOutcome.length > 80) {
        throw new DomainException(
          'PRIMARY_OUTPUT_TOO_LONG',
          `Primary output ${code} exceeds 80 characters`,
        );
      }
      state.primaryResult = { code, value };
      state.outcome = legacyOutcome;
    }
  }

  /**
   * Escribe una salida desde fuera de un nodo RESULT (acción SET_FIELD, score de un nodo
   * SCORE) respetando el contrato cuando lo hay.
   *
   * Un artefacto que declara contrato de salida espera que TODO lo que se publica pase por
   * él: si solo lo aplicáramos en los nodos RESULT, una acción podría publicar un campo no
   * declarado, o el tipo equivocado en uno declarado, y la respuesta saldría igualmente.
   * Los artefactos 1.0 —sin contrato declarado— conservan la escritura libre de siempre.
   *
   * @param requireDeclared `false` para los campos heredados que el motor publica siempre
   *   (`score`): ahí el contrato se valida si el campo está declarado, pero no declararlo
   *   no puede convertirse de golpe en un error para artefactos que ya funcionaban.
   */
  publishOutput(
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    code: string,
    value: unknown,
    requireDeclared = true,
  ): void {
    const contracts = outputContractsOf(compiled);
    const declared = contracts.some((contract) => contract.code === code);
    if (!contracts.length || (!declared && !requireDeclared)) {
      state.output[code] = value;
      return;
    }
    this.setOutputValue(compiled, state, code, value);
  }

  finalizeOutputContract(compiled: CompiledDecisionArtifact, state: MutableExecutionState): void {
    for (const contract of outputContractsOf(compiled)) {
      if (state.output[contract.code] === undefined && contract.defaultValue !== undefined) {
        this.setOutputValue(compiled, state, contract.code, contract.defaultValue);
      }
      if (state.output[contract.code] === undefined && contract.required && !contract.nullable) {
        this.metrics.recordMissingRequiredOutput(compiled.artifact.code);
        throw new DomainException(
          'REQUIRED_OUTPUT_MISSING',
          `Execution finished without required output ${contract.code}`,
        );
      }
    }
  }

  private assertOutputType(
    code: string,
    dataType: string,
    value: unknown,
    nullable: boolean,
  ): void {
    if (value === null || value === undefined) {
      if (nullable) return;
      throw new DomainException('OUTPUT_TYPE_INVALID', `Output ${code} cannot be null`);
    }
    const type = dataType.toUpperCase();
    const valid =
      (['INTEGER', 'INT', 'NUMBER', 'DECIMAL', 'FLOAT'].includes(type) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (!['INTEGER', 'INT'].includes(type) || Number.isInteger(value))) ||
      (['STRING', 'TEXT', 'ENUM', 'DATE', 'DATETIME'].includes(type) &&
        typeof value === 'string') ||
      (['BOOLEAN', 'BOOL'].includes(type) && typeof value === 'boolean') ||
      (['OBJECT', 'JSON'].includes(type) && typeof value === 'object' && !Array.isArray(value)) ||
      (['ARRAY', 'LIST'].includes(type) && Array.isArray(value));
    if (!valid) {
      throw new DomainException('OUTPUT_TYPE_INVALID', `Output ${code} must match ${dataType}`);
    }
  }
}

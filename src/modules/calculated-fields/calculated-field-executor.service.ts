/**
 * Cola con infraestructura para ejecutar un campo calculado: sandbox y métricas.
 *
 * Las reglas del contrato (§5.3) viven en `calculated-field-runtime.ts`, que es puro y
 * lo comparte el motor de grafo. Aquí solo queda lo que necesita Nest.
 */
import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../common/observability/metrics.service';
import { normalizeDataTypeOrString } from '../../common/contracts/data-types';
import { ScriptNodeRunnerService } from '../graph/script-node-runner.service';
import { executeCalculatedField, type ExecutableCalculatedField } from './calculated-field-runtime';
import type {
  CalculatedFieldContract,
  CalculatedFieldExecutionResult,
} from './calculated-field.types';

export type { ExecutableCalculatedField };

@Injectable()
export class CalculatedFieldExecutorService {
  constructor(
    private readonly scripts: ScriptNodeRunnerService,
    private readonly metrics: MetricsService,
  ) {}

  async execute(
    field: ExecutableCalculatedField,
    rawInputs: Record<string, unknown>,
  ): Promise<CalculatedFieldExecutionResult> {
    const started = Date.now();
    try {
      const result = await executeCalculatedField(field, rawInputs, this.scripts);
      this.metrics.recordCalculatedField(field.fieldCode, 'SUCCESS', Date.now() - started);
      return result;
    } catch (error) {
      this.metrics.recordCalculatedField(field.fieldCode, 'ERROR', Date.now() - started);
      throw error;
    }
  }
}

/** Normaliza el tipo declarado antes de persistirlo, para no guardar alias. */
export function canonicalReturnType(contract: CalculatedFieldContract): string {
  return normalizeDataTypeOrString(String(contract.returns.dataType));
}

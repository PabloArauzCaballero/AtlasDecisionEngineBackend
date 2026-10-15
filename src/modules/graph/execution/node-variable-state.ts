import { sanitize, type IntermediateScope } from '../intermediate-scope';
import type {
  CompiledDecisionArtifact,
  EngineExecutionResult,
  GraphNodeSnapshot,
} from '../graph.types';
import type { MutableExecutionState } from './execution-state';

/**
 * Estado de los valores que este nodo procesó (§3.1). Distingue explícitamente lo
 * recibido, lo intermedio y lo publicado: sin esa separación el editor mostraba
 * cualquier valor calculado como si fuera una salida pública del artefacto.
 */
export function nodeVariableState(
  node: GraphNodeSnapshot,
  compiled: CompiledDecisionArtifact,
  variables: Record<string, unknown>,
  state: MutableExecutionState,
  intermediatesBefore: ReturnType<IntermediateScope['snapshot']>,
  outcome: { durationUs: number; error?: { code: string; message: string } } = { durationUs: 0 },
): NonNullable<EngineExecutionResult['trace'][number]['variableState']> {
  const inputs = compiled.variables
    .filter((variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'))
    .map((variable) => ({
      code: variable.code,
      dataType: variable.dataType,
      state:
        variables[variable.code] === undefined ? ('NOT_AVAILABLE' as const) : ('VALID' as const),
      value: variable.sensitive ? null : variables[variable.code],
      sensitivityClass: variable.sensitivityClass ?? (variable.sensitive ? 'PII' : 'INTERNAL'),
      origin: variable.expectedOrigin ?? 'REQUEST',
    }));

  const outputs = compiled.variables
    .filter((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'))
    .map((variable) => {
      const field = (compiled.outputContract ?? []).find(
        (candidate) => candidate.code === variable.code,
      );
      const produced = state.output[variable.code] !== undefined;
      return {
        code: variable.code,
        dataType: variable.dataType,
        state: produced ? ('COMPUTED' as const) : ('NOT_AVAILABLE' as const),
        value: sanitize(state.output[variable.code], field?.tracePolicy ?? 'FULL'),
        sensitivityClass: variable.sensitivityClass ?? (variable.sensitive ? 'PII' : 'INTERNAL'),
        // El contrato de salida dice quién produce el campo; sin él, solo sabemos que
        // lo escribió algún nodo.
        origin: field?.sourceKind ?? 'NODE',
      };
    });

  const before = new Map(intermediatesBefore.map((entry) => [entry.code, entry]));
  const after = state.intermediates.snapshot();
  return {
    nodeKey: node.key,
    status: outcome.error ? ('ERROR' as const) : ('COMPLETED' as const),
    durationUs: outcome.durationUs,
    errors: outcome.error ? [outcome.error] : [],
    // Una intermedia disponible que ningún nodo ha leído todavía suele ser lógica
    // muerta; se avisa aquí para que se vea en el nodo, no solo en una métrica.
    warnings: after
      .filter((entry) => entry.state !== 'NOT_AVAILABLE' && !entry.consumedByNodeKeys.length)
      .map((entry) => `La variable intermedia ${entry.code} aún no la ha consumido ningún nodo`),
    inputs,
    intermediatesBefore,
    intermediatesAfter: after,
    intermediatesCreated: after
      .filter(
        (entry) =>
          before.get(entry.code)?.state === 'NOT_AVAILABLE' && entry.state !== 'NOT_AVAILABLE',
      )
      .map((entry) => entry.code),
    intermediatesUpdated: after
      .filter(
        (entry) =>
          before.get(entry.code)?.state !== 'NOT_AVAILABLE' && entry.writtenByNodeKey === node.key,
      )
      .map((entry) => entry.code),
    outputs,
  };
}

import type { CompiledDecisionArtifact } from '../graph/graph.types';
import type { GeneratorContractVariable } from './contract-generator';

/** Las variables de entrada del artefacto compilado, tal como las declara el compilador. */
export function inputContractSnapshotsOf(compiled: CompiledDecisionArtifact) {
  return compiled.variables.filter(
    (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
  );
}

/** El contrato de entrada en la forma que consume el generador de casos. */
export function inputContractOf(compiled: CompiledDecisionArtifact): GeneratorContractVariable[] {
  return inputContractSnapshotsOf(compiled).map((variable) => ({
    code: variable.code,
    dataType: variable.dataType,
    required: variable.required,
    nullable: variable.nullable,
    defaultValue: variable.defaultValue,
    constraints: variable.constraints ?? variable.validationSchema,
  }));
}

/** Las variables de salida del artefacto compilado. */
export function outputContractOf(compiled: CompiledDecisionArtifact) {
  return compiled.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
}

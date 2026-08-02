/**
 * Propiedades que toda ejecución debe cumplir, y reducción de contraejemplos (§10.2, §10.5).
 *
 * Una propiedad no es un caso de prueba: es una afirmación que debe valer para CUALQUIER
 * entrada. Cuando una falla, lo que se archiva no es la entrada aleatoria de 20 campos
 * que la destapó, sino el contraejemplo mínimo que sigue fallando: es lo único que
 * alguien puede depurar mañana.
 */
import { normalizeDataTypeOrString, checkTypeShape } from '../../common/contracts/data-types';
import type { CompiledDecisionArtifact } from '../graph/graph.types';

export const QA_PROPERTIES = [
  'INPUT_CONTRACT_ENFORCED',
  'OUTPUT_CONTRACT_RESPECTED',
  'OUTPUT_TYPES_MATCH_CONTRACT',
  'NO_INTERMEDIATE_LEAK',
  'NO_SENSITIVE_LEAK',
  'DETERMINISM',
] as const;

export type QaProperty = (typeof QA_PROPERTIES)[number];

export interface PropertyViolation {
  property: QaProperty;
  failureCode: string;
  failureMessage: string;
  observed?: unknown;
}

export interface ExecutionObservation {
  /** ¿Pasó la validación de entrada? */
  inputAccepted: boolean;
  /** Salida pública producida (vacía si no se ejecutó). */
  output: Record<string, unknown>;
  status: string;
  /** Firma estable del resultado, para comparar dos ejecuciones idénticas. */
  signature: string;
  errorCode?: string;
}

export interface PropertyContext {
  compiled: CompiledDecisionArtifact;
  /** VALID | BOUNDARY | INVALID */
  kind: string;
  input: Record<string, unknown>;
}

/** Evalúa todas las propiedades sobre una observación concreta. */
export function checkProperties(
  context: PropertyContext,
  observation: ExecutionObservation,
  repeatSignature?: string,
): PropertyViolation[] {
  const violations: PropertyViolation[] = [];
  const outputs = context.compiled.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );

  // Un caso deliberadamente inválido que el motor ACEPTA es un fallo de contrato:
  // significa que una restricción declarada no se está imponiendo.
  if (context.kind === 'INVALID' && observation.inputAccepted) {
    violations.push({
      property: 'INPUT_CONTRACT_ENFORCED',
      failureCode: 'INVALID_INPUT_ACCEPTED',
      failureMessage: 'Una entrada que incumple el contrato fue aceptada por el motor',
      observed: observation.output,
    });
  }
  // Y un caso válido rechazado significa que el contrato es más estricto de lo que declara.
  if (context.kind !== 'INVALID' && !observation.inputAccepted) {
    violations.push({
      property: 'INPUT_CONTRACT_ENFORCED',
      failureCode: 'VALID_INPUT_REJECTED',
      failureMessage: `Una entrada que cumple el contrato fue rechazada (${observation.errorCode ?? 'sin código'})`,
      observed: observation.errorCode,
    });
  }

  if (observation.inputAccepted && observation.status === 'SUCCEEDED') {
    for (const output of outputs) {
      const value = observation.output[output.code];
      if (output.required && value === undefined) {
        violations.push({
          property: 'OUTPUT_CONTRACT_RESPECTED',
          failureCode: 'REQUIRED_OUTPUT_MISSING',
          failureMessage: `La ejecución terminó sin producir la salida obligatoria ${output.code}`,
        });
        continue;
      }
      if (value === undefined || value === null) continue;
      const type = normalizeDataTypeOrString(output.dataType);
      const shape = checkTypeShape(type, value);
      if (!shape.ok) {
        violations.push({
          property: 'OUTPUT_TYPES_MATCH_CONTRACT',
          failureCode: 'OUTPUT_TYPE_MISMATCH',
          failureMessage: `La salida ${output.code} debía ser ${type} (${shape.reason})`,
          observed: value,
        });
      }
    }

    // Las intermedias son internas por definición: verlas en la respuesta pública es
    // exactamente la fuga que §2.1 prohíbe.
    for (const intermediate of context.compiled.intermediates ?? []) {
      if (Object.prototype.hasOwnProperty.call(observation.output, intermediate.code)) {
        violations.push({
          property: 'NO_INTERMEDIATE_LEAK',
          failureCode: 'INTERMEDIATE_EXPOSED',
          failureMessage: `La variable intermedia ${intermediate.code} apareció en la salida pública`,
        });
      }
    }

    const leaked = findSensitiveLeak(context, observation.output);
    if (leaked) {
      violations.push({
        property: 'NO_SENSITIVE_LEAK',
        failureCode: 'SENSITIVE_VALUE_IN_OUTPUT',
        failureMessage: `El valor sensible de ${leaked} se devolvió tal cual en la salida`,
      });
    }
  }

  if (repeatSignature !== undefined && repeatSignature !== observation.signature) {
    violations.push({
      property: 'DETERMINISM',
      failureCode: 'NON_DETERMINISTIC_RESULT',
      failureMessage: 'La misma entrada y versión produjeron dos resultados distintos',
      observed: { first: observation.signature, second: repeatSignature },
    });
  }

  return violations;
}

/** ¿Se filtró el valor de alguna entrada sensible dentro de la salida pública? */
function findSensitiveLeak(
  context: PropertyContext,
  output: Record<string, unknown>,
): string | null {
  const sensitive = context.compiled.variables.filter(
    (variable) => variable.sensitive && !String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
  if (!sensitive.length) return null;
  const serialized = JSON.stringify(output);
  for (const variable of sensitive) {
    const value = context.input[variable.code];
    // Solo tiene sentido para valores con suficiente entropía: un booleano o un entero
    // pequeño coincidirían por casualidad y generarían un falso positivo constante.
    if (typeof value !== 'string' || value.length < 6) continue;
    if (serialized.includes(value)) return variable.code;
  }
  return null;
}

/**
 * Reducción del contraejemplo (§10.5): quita campos opcionales y acerca los números a
 * cero mientras el fallo siga reproduciéndose. Es delta-debugging sencillo, suficiente
 * para dejar un caso que quepa en una pantalla.
 */
export async function shrinkCounterexample(
  input: Record<string, unknown>,
  stillFails: (candidate: Record<string, unknown>) => Promise<boolean>,
  maxSteps = 60,
): Promise<Record<string, unknown>> {
  let current = { ...input };
  let steps = 0;

  for (const key of Object.keys(input)) {
    if (steps++ > maxSteps) break;
    const withoutKey = { ...current };
    delete withoutKey[key];
    if (await stillFails(withoutKey)) current = withoutKey;
  }

  for (const [key, value] of Object.entries({ ...current })) {
    if (steps++ > maxSteps) break;
    for (const candidateValue of simplerValues(value)) {
      const candidate = { ...current, [key]: candidateValue };
      if (await stillFails(candidate)) {
        current = candidate;
        break;
      }
    }
  }
  return current;
}

/** Valores progresivamente más simples que uno dado, del más simple al menos. */
function simplerValues(value: unknown): unknown[] {
  if (typeof value === 'number') {
    const candidates = [0, 1, Math.trunc(value)];
    return [...new Set(candidates)].filter((candidate) => candidate !== value);
  }
  if (typeof value === 'string') {
    return value.length > 1 ? ['', 'a'] : [];
  }
  if (Array.isArray(value)) {
    return value.length ? [[], value.slice(0, 1)] : [];
  }
  return [];
}

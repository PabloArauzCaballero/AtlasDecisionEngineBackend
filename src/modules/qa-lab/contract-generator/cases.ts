import {
  buildValidValue,
  type DistributionMap,
  type GeneratorContractVariable,
} from '../contract-value-factory';
import type { SeededRandom } from '../seeded-random';
import { generateBoundaryValue } from './boundary';
import { generateInvalidValue } from './invalid';
import { CaseKind, GeneratedCase, GenerationMix } from './types';

/** Construye un lote determinista de casos a partir del contrato de entradas. */
export function generateCases(
  variables: GeneratorContractVariable[],
  random: SeededRandom,
  total: number,
  mix: GenerationMix,
  distributions: DistributionMap = {},
): GeneratedCase[] {
  return generateCasesOfKinds(variables, random, distribute(total, mix), distributions);
}

/**
 * El mismo generador, con las clases ya decididas por quien llama.
 *
 * Existe porque el reparto por DESENLACE sustituye a la porción válida de la mezcla: esos
 * casos los construye el planificador del grafo y el resto —frontera e inválidos— sigue
 * saliendo de aquí. Sin esta puerta habría que generar los válidos sólo para tirarlos.
 */
export function generateCasesOfKinds(
  variables: GeneratorContractVariable[],
  random: SeededRandom,
  kinds: CaseKind[],
  distributions: DistributionMap = {},
): GeneratedCase[] {
  const inputs = variables.filter((variable) => variable.code);
  return kinds.map((kind, index) => {
    const input: Record<string, unknown> = {};
    const unsatisfiable: string[] = [];
    for (const variable of inputs) {
      // Una entrada opcional se omite de vez en cuando: probar solo payloads completos
      // deja sin cubrir justo la rama de valores por defecto.
      if (!variable.required && random.bool(0.25)) continue;
      const generated = buildValidValue(variable, random, distributions[variable.code]);
      input[variable.code] = generated.value;
      if (!generated.satisfied) unsatisfiable.push(variable.code);
    }
    const notes = unsatisfiable.length ? { unsatisfiable } : {};
    if (kind === 'VALID' || !inputs.length) return { index, kind, input, ...notes };

    const target = random.pick(inputs);
    const mutated =
      kind === 'BOUNDARY'
        ? generateBoundaryValue(target, random)
        : generateInvalidValue(target, random);
    // Sin borde ni valor rechazable, este contrato no admite la clase pedida: se entrega
    // como VÁLIDO en vez de fingir una mutación que no ocurrió.
    if (!mutated) return { index, kind: 'VALID', input, ...notes };
    input[target.code] = mutated.value;
    return { index, kind, mutation: `${target.code}: ${mutated.mutation}`, input, ...notes };
  });
}

/** Reparte `total` casos según la mezcla configurada, sin perder ni inventar casos. */
export function distribute(total: number, mix: GenerationMix): CaseKind[] {
  const weights = [
    Math.max(0, mix.validPercent),
    Math.max(0, mix.boundaryPercent),
    Math.max(0, mix.invalidPercent),
  ];
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map((weight) => Math.floor((weight / sum) * total));
  // El reparto entero puede dejar casos sin asignar; van a la clase mayoritaria para
  // que el total pedido siempre coincida con el total ejecutado.
  let remainder = total - counts.reduce((a, b) => a + b, 0);
  const dominant = counts.indexOf(Math.max(...counts));
  counts[dominant] += remainder > 0 ? remainder : 0;
  remainder = total - counts.reduce((a, b) => a + b, 0);
  if (remainder > 0) counts[0] += remainder;

  const kinds: CaseKind[] = [];
  const order: CaseKind[] = ['VALID', 'BOUNDARY', 'INVALID'];
  counts.forEach((count, position) => {
    for (let index = 0; index < count; index += 1) kinds.push(order[position]);
  });
  return kinds.slice(0, total);
}

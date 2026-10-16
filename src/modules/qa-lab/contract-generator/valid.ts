import {
  buildValidValue,
  type GeneratorContractVariable,
  type VariableDistribution,
} from '../contract-value-factory';
import type { SeededRandom } from '../seeded-random';

/** Un valor válido para la variable, respetando todas sus restricciones. */
export function generateValidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
  distribution?: VariableDistribution,
): unknown {
  return buildValidValue(variable, random, distribution).value;
}

/**
 * Construcción de un valor VÁLIDO a partir del contrato de una variable (§10.3).
 *
 * Separado de `contract-generator.ts` porque son dos responsabilidades distintas: aquí se
 * responde «qué valor satisface ESTE contrato», allí «cómo se reparte un lote entre
 * válidos, frontera e inválidos». Mezclarlas era lo que hacía que las restricciones menos
 * frecuentes —`pattern`, `format`, `precision`, `itemType`— se quedaran sin cubrir dentro
 * de un `switch` por tipo que ya no cabía en la cabeza.
 *
 * ## La regla que gobierna este fichero
 *
 * Un valor VÁLIDO tiene que pasar `validateAgainstConstraints`, que es el mismo juez que
 * rechazará la ejecución después. Por eso todo valor se comprueba antes de devolverse y,
 * si no pasa, se repara con un valor derivado del propio contrato. Cuando ni así se
 * consigue, el contrato es contradictorio (`format: EMAIL` con `maxLength: 4`, `min`
 * mayor que `max`) y se dice explícitamente con `satisfied: false` en vez de entregar un
 * valor que miente.
 */
export type {
  DistributionMap,
  GeneratorContractVariable,
  ValidValueResult,
  VariableDistribution,
} from './types';
export { buildValidValue, resolvedConstraintsOf, satisfiesContract } from './valid-value';

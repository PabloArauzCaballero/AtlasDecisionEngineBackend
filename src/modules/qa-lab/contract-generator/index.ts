/**
 * Generación de casos guiada por el contrato (§10.3).
 *
 * El generador LEE el contrato de variables y produce por sí solo valores válidos, no
 * válidos y de frontera. No hay listas de casos escritas a mano: si mañana alguien
 * añade una restricción `maxLength`, los casos "justo por encima del máximo" aparecen
 * solos. Esa es la diferencia entre un banco de pruebas que envejece y uno que sigue
 * al contrato.
 *
 * ## Los tres tipos de caso tienen que ser verdad
 *
 * Un VÁLIDO que el contrato rechaza, o un FRONTERA que se sale del rango, llenan el
 * informe de fallos que no son fallos y queman la confianza en el QA Lab. Por eso los
 * candidatos de frontera y de inválido se CRIBAN con el mismo juez que ejecutará después
 * (`validateAgainstConstraints`): sobrevive el que de verdad es lo que dice ser. Antes se
 * elegían a ciegas y, por ejemplo, un porcentaje acotado a 20–80 recibía el «límite» 0.
 *
 * La construcción de un valor válido vive en `contract-value-factory.ts`.
 */
export { generateBoundaryValue } from './boundary';
export { distribute, generateCases, generateCasesOfKinds } from './cases';
export { generateInvalidValue } from './invalid';
export type { CaseKind, GeneratedCase, GenerationMix } from './types';
export { generateValidValue } from './valid';
export type {
  DistributionMap,
  GeneratorContractVariable,
  VariableDistribution,
} from '../contract-value-factory';

/**
 * Un lote de valores de prueba: entradas generadas del contrato, sin ejecutar nada.
 *
 * Vive aquí, y no dentro de un servicio, porque lo usan dos caminos con orígenes de
 * contrato distintos —el simulador lo toma del despliegue del ambiente, el QA Lab de una
 * versión compilada— y lo único que deben compartir es QUÉ es un lote de valores. Si cada
 * uno lo construyera por su cuenta, «los valores del simulador» y «los valores de la
 * suite» acabarían divergiendo en la forma sin que nadie lo notara.
 */
import {
  generateCases,
  type GenerationMix,
  type GeneratorContractVariable,
} from './contract-generator';
import { GENERATOR_VERSION, SeededRandom, generateSeed } from './seeded-random';

export type SampleKind = 'VALID' | 'BOUNDARY' | 'INVALID';

/** Cada clase pedida se genera pura: quien pide «frontera» no quiere casos válidos. */
const MIX_BY_KIND: Record<SampleKind, GenerationMix> = {
  VALID: { validPercent: 100, invalidPercent: 0, boundaryPercent: 0 },
  BOUNDARY: { validPercent: 0, invalidPercent: 0, boundaryPercent: 100 },
  INVALID: { validPercent: 0, invalidPercent: 100, boundaryPercent: 0 },
};

export interface SampleBatch {
  kind: SampleKind;
  /** Devolverla es lo que hace reproducible el botón: repetirla da los mismos valores. */
  seed: string;
  generatorVersion: string;
  cases: {
    index: number;
    kind: string;
    mutation?: string;
    input: Record<string, unknown>;
    /** Códigos cuyo contrato no admite ningún valor válido; ver `GeneratedCase`. */
    unsatisfiable?: string[];
  }[];
}

export interface SampleRequest {
  kind?: SampleKind;
  count?: number;
  seed?: string;
}

export function buildSampleBatch(
  inputs: GeneratorContractVariable[],
  request: SampleRequest,
  freshSeed: () => string,
): SampleBatch {
  const kind = request.kind ?? 'VALID';
  const seed = request.seed?.trim() || freshSeed();
  return {
    kind,
    seed,
    generatorVersion: GENERATOR_VERSION,
    cases: generateCases(inputs, new SeededRandom(seed), request.count ?? 1, MIX_BY_KIND[kind]),
  };
}

/**
 * Semillas distintas en pulsaciones sucesivas. `generateSeed` es una función pura de su
 * texto, así que sin el contador y la hora el botón devolvería siempre lo mismo y no
 * serviría para explorar el espacio de entradas.
 */
export function seedSequence(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return generateSeed(`${prefix}:${Date.now()}:${sequence}`);
  };
}

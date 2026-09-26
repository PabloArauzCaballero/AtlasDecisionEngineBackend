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
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { planOutcomeCases } from './outcome-coverage';
import { GENERATOR_VERSION, SeededRandom, generateSeed } from './seeded-random';

/**
 * `OUTCOMES` no habla de la entrada como las otras tres, sino del FINAL: un caso por
 * cada desenlace del grafo. Es la clase que responde «¿he probado todas las decisiones
 * que este algoritmo puede tomar?», que ninguna de las otras contesta.
 */
export type SampleKind = 'VALID' | 'BOUNDARY' | 'INVALID' | 'OUTCOMES';

/** Cada clase pedida se genera pura: quien pide «frontera» no quiere casos válidos. */
const MIX_BY_KIND: Record<string, GenerationMix> = {
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
    /** Sólo en `OUTCOMES`: el desenlace que persigue el caso y cómo llega. */
    outcome?: string;
    nodeKey?: string;
    path?: string[];
    /** Condiciones del camino que no se pueden gobernar desde la entrada. */
    unresolved?: string[];
  }[];
  /** Sólo en `OUTCOMES`: cuántos desenlaces tiene el grafo, se hayan generado o no. */
  totalOutcomes?: number;
}

/** Tope de cordura para un grafo con muchísimas ramas; se informa al devolver el lote. */
const MAX_OUTCOME_CASES = 50;

export interface SampleRequest {
  kind?: SampleKind;
  count?: number;
  seed?: string;
}

export function buildSampleBatch(
  inputs: GeneratorContractVariable[],
  request: SampleRequest,
  freshSeed: () => string,
  compiled?: CompiledDecisionArtifact,
): SampleBatch {
  const kind = request.kind ?? 'VALID';
  const seed = request.seed?.trim() || freshSeed();
  const random = new SeededRandom(seed);
  const base = { kind, seed, generatorVersion: GENERATOR_VERSION };

  if (kind === 'OUTCOMES') {
    // Sin grafo compilado no hay desenlaces que recorrer. Se dice, en vez de devolver
    // casos válidos con la etiqueta equivocada.
    if (!compiled) return { ...base, cases: [], totalOutcomes: 0 };
    // El número de casos pedido NO se aplica aquí: lo fija el grafo. Pedir «3 casos»
    // sobre un artefacto con cinco finales dejaría dos decisiones sin probar y el lote
    // parecería completo. El único tope es el de cordura, y se declara al devolverlo.
    const plan = planOutcomeCases(compiled, inputs, random, MAX_OUTCOME_CASES);
    return { ...base, cases: plan.cases, totalOutcomes: plan.totalOutcomes };
  }

  return {
    ...base,
    cases: generateCases(inputs, random, request.count ?? 1, MIX_BY_KIND[kind]),
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

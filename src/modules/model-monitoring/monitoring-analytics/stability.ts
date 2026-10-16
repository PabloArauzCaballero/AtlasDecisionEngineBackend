export interface StabilityBucket {
  bucket: string;
  referenceShare: number;
  currentShare: number;
  contribution: number;
}

export interface StabilityResult {
  psi: number;
  /** `STABLE` < 0.10 ≤ `SHIFTED` < 0.25 ≤ `UNSTABLE`, los cortes de uso corriente. */
  verdict: 'STABLE' | 'SHIFTED' | 'UNSTABLE';
  referenceCount: number;
  currentCount: number;
  buckets: StabilityBucket[];
}

/**
 * Índice de estabilidad poblacional entre dos ventanas de la misma variable.
 *
 * `PSI = Σ (actual − referencia) · ln(actual / referencia)` sobre las frecuencias relativas de
 * cada categoría. Mide si a un modelo le siguen llegando los mismos solicitantes: un modelo
 * puede seguir acertando sobre quien evalúa y estar viendo una población distinta de aquella
 * con la que se construyó, y eso es una degradación que la tasa de malos tarda meses en
 * mostrar.
 *
 * Las categorías ausentes en una de las dos ventanas usan un piso mínimo en vez de cero:
 * `ln(0)` es infinito y un solo valor nuevo llevaría el índice al infinito, que no es
 * información sino un fallo de cálculo.
 */
export function populationStabilityIndex(reference: string[], current: string[]): StabilityResult {
  const FLOOR = 0.0001;
  const referenceCount = reference.length;
  const currentCount = current.length;
  if (!referenceCount || !currentCount) {
    return { psi: 0, verdict: 'STABLE', referenceCount, currentCount, buckets: [] };
  }

  const tally = (values: string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const referenceCounts = tally(reference);
  const currentCounts = tally(current);
  const allBuckets = [...new Set([...referenceCounts.keys(), ...currentCounts.keys()])].sort();

  let psi = 0;
  const buckets: StabilityBucket[] = allBuckets.map((bucket) => {
    const referenceShare = Math.max((referenceCounts.get(bucket) ?? 0) / referenceCount, FLOOR);
    const currentShare = Math.max((currentCounts.get(bucket) ?? 0) / currentCount, FLOOR);
    const contribution = (currentShare - referenceShare) * Math.log(currentShare / referenceShare);
    psi += contribution;
    return {
      bucket,
      referenceShare: (referenceCounts.get(bucket) ?? 0) / referenceCount,
      currentShare: (currentCounts.get(bucket) ?? 0) / currentCount,
      contribution,
    };
  });

  return {
    psi,
    verdict: psi >= 0.25 ? 'UNSTABLE' : psi >= 0.1 ? 'SHIFTED' : 'STABLE',
    referenceCount,
    currentCount,
    buckets: buckets.sort((a, b) => b.contribution - a.contribution),
  };
}

/**
 * La categoría de un valor para el índice de estabilidad.
 *
 * Vive aquí, exportada, porque la usan TRES sitios —el análisis bajo demanda, la captura de la
 * línea base y la evaluación programada— y tienen que coincidir exactamente. Si dos de ellos
 * categorizan distinto, el índice compara dos alfabetos que no se solapan y sale altísimo
 * siempre: una alarma permanente, que es la forma más rápida de que nadie vuelva a mirarla.
 * Tres copias de esta función eran tres oportunidades de que eso pasara sin que nadie lo notase.
 *
 * Los numéricos se agrupan en una escala logarítmica porque el PSI compara FRECUENCIAS: sin
 * agrupar, cada valor distinto sería su propia categoría y el índice mediría ruido. Y los
 * importes se reparten mejor en escala logarítmica que en tramos lineales, donde casi todo caería
 * en el primero.
 *
 * Un valor sensible llega como `{ valueHash, source }`, así que sólo aporta su presencia como
 * categoría opaca: la deriva de una variable sensible se detecta si cambia el reparto de valores
 * distintos, no su magnitud. Es una limitación real y preferible a guardar el valor.
 */
export function bucketOfValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `n:${Math.floor(Math.log10(Math.abs(value) + 1) * 3)}`;
  }
  if (typeof value === 'boolean') return `b:${String(value)}`;
  if (typeof value === 'object') {
    const hash = (value as Record<string, unknown>).valueHash;
    return typeof hash === 'string' ? `h:${hash.slice(0, 12)}` : null;
  }
  return `s:${String(value).slice(0, 40)}`;
}

/** La categoría de UNA variable dentro del snapshot de entrada de una ejecución. */
export function bucketOfSnapshot(snapshot: unknown, variableCode: string): string | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  return bucketOfValue((snapshot as Record<string, unknown>)[variableCode]);
}

/**
 * PSI contra una línea base CONGELADA, que llega como histograma y no como muestra.
 *
 * `populationStabilityIndex` compara dos muestras crudas y sirve para el análisis bajo demanda,
 * donde quien pregunta elige las dos ventanas. La vigilancia programada no puede hacer eso: su
 * referencia se congeló al promover, meses antes, y de ella se guarda el histograma —no los
 * valores— porque una línea base vive años y conservar datos personales durante años sin
 * necesitarlos es exactamente lo que no se debe hacer.
 *
 * Misma aritmética y mismo suelo: un cubo que existe en una orilla y no en la otra daría
 * `log(0)` —infinito— y un solo caso raro haría estallar el índice.
 */
export function psiAgainstBaseline(
  referenceShares: Readonly<Record<string, number>>,
  current: string[],
): StabilityResult {
  const FLOOR = 0.0001;
  const currentCount = current.length;
  const referenceCount = Object.keys(referenceShares).length;
  if (!referenceCount || !currentCount) {
    return { psi: 0, verdict: 'STABLE', referenceCount, currentCount, buckets: [] };
  }

  const currentCounts = new Map<string, number>();
  for (const value of current) currentCounts.set(value, (currentCounts.get(value) ?? 0) + 1);
  const allBuckets = [
    ...new Set([...Object.keys(referenceShares), ...currentCounts.keys()]),
  ].sort();

  let psi = 0;
  const buckets: StabilityBucket[] = allBuckets.map((bucket) => {
    const rawReference = referenceShares[bucket] ?? 0;
    const rawCurrent = (currentCounts.get(bucket) ?? 0) / currentCount;
    const referenceShare = Math.max(rawReference, FLOOR);
    const currentShare = Math.max(rawCurrent, FLOOR);
    const contribution = (currentShare - referenceShare) * Math.log(currentShare / referenceShare);
    psi += contribution;
    return { bucket, referenceShare: rawReference, currentShare: rawCurrent, contribution };
  });

  return {
    psi,
    verdict: psi >= 0.25 ? 'UNSTABLE' : psi >= 0.1 ? 'SHIFTED' : 'STABLE',
    referenceCount,
    currentCount,
    buckets: buckets.sort((a, b) => b.contribution - a.contribution),
  };
}

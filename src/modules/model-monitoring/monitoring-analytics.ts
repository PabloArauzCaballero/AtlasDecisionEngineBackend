/**
 * Núcleo analítico del monitoreo de modelo.
 *
 * Funciones puras y sin dependencias: reciben filas ya leídas y devuelven números. Está
 * separado del servicio a propósito, porque lo que hay que poder verificar aquí no es que la
 * consulta traiga las filas correctas sino que la **aritmética** sea la correcta —una tasa de
 * malos mal calculada no falla, simplemente miente— y eso se comprueba con casos escritos a
 * mano contra valores conocidos.
 *
 * Las tres medidas responden a preguntas distintas de SR 11-7 §V y CMN 4.557 art. 40:
 *
 *  - `summarizePerformance` — ¿el modelo sigue acertando?
 *  - `populationStabilityIndex` — ¿le siguen llegando los mismos solicitantes?
 *  - `adverseImpactRatios` — ¿trata igual a grupos comparables?
 */

/** Etiquetas de resultado real; espejo del enum de Prisma, sin importarlo. */
export type OutcomeLabel =
  'GOOD' | 'BAD' | 'REJECTED_WOULD_HAVE_BEEN_GOOD' | 'REJECTED_CONFIRMED_BAD' | 'INDETERMINATE';

export interface ObservedDecision {
  /** Lo que el motor decidió. Se considera aprobación todo lo que no rechaza. */
  outcome: string | null;
  label: OutcomeLabel;
  /** Puntaje publicado, si el artefacto lo produce. Habilita la medida de discriminación. */
  score?: number | null;
}

export interface PerformanceSummary {
  observed: number;
  /** Con desenlace conocido: el denominador de todo lo demás. */
  conclusive: number;
  approved: number;
  declined: number;
  /** Aprobados que salieron mal, sobre los aprobados con desenlace. */
  badRate: number | null;
  /** Aprobados que salieron bien. */
  goodRate: number | null;
  /**
   * Rechazados que se habrían comportado bien, sobre los rechazados con desenlace.
   *
   * Es la mitad del análisis que casi nadie mide, y la que detecta un modelo que se ha vuelto
   * demasiado restrictivo: sus malos no aparecen porque nunca llegaron a entrar.
   */
  falseDeclineRate: number | null;
  /**
   * Separación entre la puntuación media de buenos y malos, normalizada por el rango
   * observado. Va de 0 (el puntaje no distingue nada) a 1.
   *
   * No es el KS ni el AUC: es una medida barata y estable con pocos casos, que es la
   * situación real de una ventana de monitoreo. Sirve para ver una TENDENCIA —si cae mes a
   * mes, el modelo se está degradando—, no para publicarla como poder discriminante.
   */
  discrimination: number | null;
}

const APPROVED_LABELS: OutcomeLabel[] = ['GOOD', 'BAD'];
const DECLINED_LABELS: OutcomeLabel[] = ['REJECTED_WOULD_HAVE_BEEN_GOOD', 'REJECTED_CONFIRMED_BAD'];

export function summarizePerformance(decisions: ObservedDecision[]): PerformanceSummary {
  // `INDETERMINATE` se cuenta como observado pero NO entra en ningún denominador: mezclar
  // «no se sabe» con «salió bien» es la forma más silenciosa de inflar el acierto.
  const conclusive = decisions.filter((entry) => entry.label !== 'INDETERMINATE');
  const approved = conclusive.filter((entry) => APPROVED_LABELS.includes(entry.label));
  const declined = conclusive.filter((entry) => DECLINED_LABELS.includes(entry.label));
  const bad = approved.filter((entry) => entry.label === 'BAD').length;
  const falseDeclines = declined.filter(
    (entry) => entry.label === 'REJECTED_WOULD_HAVE_BEEN_GOOD',
  ).length;

  return {
    observed: decisions.length,
    conclusive: conclusive.length,
    approved: approved.length,
    declined: declined.length,
    badRate: approved.length ? bad / approved.length : null,
    goodRate: approved.length ? (approved.length - bad) / approved.length : null,
    falseDeclineRate: declined.length ? falseDeclines / declined.length : null,
    discrimination: discriminationOf(conclusive),
  };
}

/** Separación normalizada entre la media de los que salieron bien y la de los que salieron mal. */
function discriminationOf(conclusive: ObservedDecision[]): number | null {
  const scored = conclusive.filter(
    (entry) => typeof entry.score === 'number' && Number.isFinite(entry.score),
  ) as Array<ObservedDecision & { score: number }>;
  const goods = scored.filter(
    (entry) => entry.label === 'GOOD' || entry.label === 'REJECTED_WOULD_HAVE_BEEN_GOOD',
  );
  const bads = scored.filter(
    (entry) => entry.label === 'BAD' || entry.label === 'REJECTED_CONFIRMED_BAD',
  );
  if (!goods.length || !bads.length) return null;

  const range = Math.max(...scored.map((e) => e.score)) - Math.min(...scored.map((e) => e.score));
  // Todos con el mismo puntaje: la separación es 0, no una división por cero.
  if (range === 0) return 0;
  const mean = (rows: Array<{ score: number }>) =>
    rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
  return Math.min(1, Math.abs(mean(goods) - mean(bads)) / range);
}

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

export interface GroupOutcome {
  group: string;
  approved: boolean;
}

export interface AdverseImpactGroup {
  group: string;
  total: number;
  approved: number;
  approvalRate: number;
  /** Tasa del grupo dividida por la del grupo de referencia (el de mayor tasa). */
  impactRatio: number;
  /** `true` cuando la razón cae por debajo de 0.8 — el umbral de la regla de los 4/5. */
  belowThreshold: boolean;
}

export interface AdverseImpactResult {
  attribute: string;
  /** Grupo con la tasa de aprobación más alta; es el denominador de la razón. */
  referenceGroup: string | null;
  /** Grupos por debajo del tamaño mínimo, excluidos del veredicto. */
  ignoredForSmallSample: string[];
  groups: AdverseImpactGroup[];
  /** `true` si algún grupo con muestra suficiente cae por debajo de 0.8. */
  flagged: boolean;
}

/** Por debajo de esto, una diferencia de tasas es ruido y señalarla sería una falsa alarma. */
const MIN_GROUP_SIZE = 30;

/**
 * Razón de impacto adverso por grupo — la regla de los 4/5.
 *
 * Compara la tasa de aprobación de cada grupo con la del grupo de mayor tasa. Por debajo de
 * 0.8 hay un indicio de impacto dispar que exige explicación; es el umbral que usan las guías
 * de aplicación de ECOA y que el CFPB espera que un prestamista se autoexamine.
 *
 * Dos cosas que este resultado NO es, y conviene no confundir:
 *
 *  - **No es una conclusión de discriminación.** Una razón baja puede tener una explicación
 *    legítima de negocio; lo que obliga es a buscarla y documentarla, no a cambiar el modelo.
 *  - **No sustituye el análisis del regulador.** Es un tamiz para detectar pronto lo que
 *    después se estudia en serio.
 */
export function adverseImpactRatios(
  attribute: string,
  outcomes: GroupOutcome[],
): AdverseImpactResult {
  const byGroup = new Map<string, { total: number; approved: number }>();
  for (const entry of outcomes) {
    const current = byGroup.get(entry.group) ?? { total: 0, approved: 0 };
    current.total += 1;
    if (entry.approved) current.approved += 1;
    byGroup.set(entry.group, current);
  }

  const eligible = [...byGroup.entries()].filter(([, value]) => value.total >= MIN_GROUP_SIZE);
  const ignoredForSmallSample = [...byGroup.entries()]
    .filter(([, value]) => value.total < MIN_GROUP_SIZE)
    .map(([group]) => group)
    .sort();

  if (!eligible.length) {
    return { attribute, referenceGroup: null, ignoredForSmallSample, groups: [], flagged: false };
  }

  const rates = eligible.map(([group, value]) => ({
    group,
    total: value.total,
    approved: value.approved,
    approvalRate: value.approved / value.total,
  }));
  const best = rates.reduce((top, row) => (row.approvalRate > top.approvalRate ? row : top));

  const groups: AdverseImpactGroup[] = rates
    .map((row) => {
      // Si nadie aprueba en ningún grupo, la razón no está definida; se declara 1 —ausencia
      // de disparidad— en vez de fabricar una división por cero.
      const impactRatio = best.approvalRate === 0 ? 1 : row.approvalRate / best.approvalRate;
      return { ...row, impactRatio, belowThreshold: impactRatio < 0.8 };
    })
    .sort((a, b) => a.impactRatio - b.impactRatio);

  return {
    attribute,
    referenceGroup: best.group,
    ignoredForSmallSample,
    groups,
    flagged: groups.some((group) => group.belowThreshold),
  };
}

/** Decisión considerada aprobación. Todo lo que no rechaza ni deriva a revisión cuenta. */
export function isApproval(outcome: string | null | undefined): boolean {
  const normalized = String(outcome ?? '').toUpperCase();
  if (!normalized) return false;
  return !['DECLINED', 'REJECTED', 'DENIED', 'NO_DECISION', 'MANUAL_REVIEW', 'FAILED'].includes(
    normalized,
  );
}

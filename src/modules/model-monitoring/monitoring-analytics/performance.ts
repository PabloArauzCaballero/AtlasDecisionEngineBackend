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

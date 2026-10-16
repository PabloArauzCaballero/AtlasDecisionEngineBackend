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

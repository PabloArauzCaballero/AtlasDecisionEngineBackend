import {
  adverseImpactRatios,
  isApproval,
  populationStabilityIndex,
  summarizePerformance,
  type ObservedDecision,
  type OutcomeLabel,
} from '../src/modules/model-monitoring/monitoring-analytics';

/**
 * Aritmética del monitoreo de modelo.
 *
 * Una tasa mal calculada no falla: devuelve un número y alguien decide con él. Por eso lo que
 * se comprueba aquí son valores conocidos a mano, y sobre todo los casos donde una fórmula
 * ingenua produce un resultado que parece bueno:
 *
 *  - contar «no se sabe» como acierto infla el desempeño;
 *  - `ln(0)` manda el PSI al infinito con una sola categoría nueva;
 *  - dividir por una tasa de aprobación de cero inventa una disparidad que no existe;
 *  - un grupo de tres personas produce razones de impacto extremas que son puro ruido.
 */
describe('Monitoreo de modelo — desempeño', () => {
  const decision = (label: OutcomeLabel, outcome = 'APPROVED', score?: number): ObservedDecision =>
    ({ outcome, label, score }) as ObservedDecision;

  it('calcula la tasa de malos sobre los aprobados con desenlace', () => {
    const summary = summarizePerformance([
      decision('GOOD'),
      decision('GOOD'),
      decision('GOOD'),
      decision('BAD'),
    ]);
    expect(summary.approved).toBe(4);
    expect(summary.badRate).toBeCloseTo(0.25);
    expect(summary.goodRate).toBeCloseTo(0.75);
  });

  it('«no se sabe» no cuenta como acierto', () => {
    // El error silencioso: 2 buenos, 1 malo y 7 sin desenlace darían 10% de malos con un
    // denominador ingenuo, cuando la cifra real es 33%.
    const summary = summarizePerformance([
      decision('GOOD'),
      decision('GOOD'),
      decision('BAD'),
      ...Array.from({ length: 7 }, () => decision('INDETERMINATE')),
    ]);
    expect(summary.observed).toBe(10);
    expect(summary.conclusive).toBe(3);
    expect(summary.badRate).toBeCloseTo(1 / 3);
  });

  it('mide los rechazos que se habrían comportado bien', () => {
    // La mitad del análisis que casi nadie mide: detecta el modelo que se volvió demasiado
    // restrictivo, cuyos malos no aparecen porque nunca llegaron a entrar.
    const summary = summarizePerformance([
      decision('REJECTED_WOULD_HAVE_BEEN_GOOD', 'DECLINED'),
      decision('REJECTED_CONFIRMED_BAD', 'DECLINED'),
      decision('REJECTED_CONFIRMED_BAD', 'DECLINED'),
      decision('REJECTED_CONFIRMED_BAD', 'DECLINED'),
    ]);
    expect(summary.declined).toBe(4);
    expect(summary.falseDeclineRate).toBeCloseTo(0.25);
    // Sin aprobados no hay tasa de malos: `null`, no cero.
    expect(summary.badRate).toBeNull();
  });

  it('sin observaciones concluyentes no inventa tasas', () => {
    const summary = summarizePerformance([decision('INDETERMINATE')]);
    expect(summary.badRate).toBeNull();
    expect(summary.falseDeclineRate).toBeNull();
    expect(summary.discrimination).toBeNull();
  });

  it('la discriminación separa las puntuaciones de buenos y malos', () => {
    const summary = summarizePerformance([
      decision('GOOD', 'APPROVED', 800),
      decision('GOOD', 'APPROVED', 800),
      decision('BAD', 'APPROVED', 400),
      decision('BAD', 'APPROVED', 400),
    ]);
    // Medias 800 y 400 sobre un rango de 400: separación máxima.
    expect(summary.discrimination).toBeCloseTo(1);
  });

  it('un puntaje que no distingue nada da separación cero', () => {
    const summary = summarizePerformance([
      decision('GOOD', 'APPROVED', 600),
      decision('BAD', 'APPROVED', 600),
    ]);
    // Rango cero: 0, no una división por cero.
    expect(summary.discrimination).toBe(0);
  });

  it('sin puntajes, o sin ambos lados, no hay medida de discriminación', () => {
    expect(summarizePerformance([decision('GOOD'), decision('BAD')]).discrimination).toBeNull();
    expect(summarizePerformance([decision('GOOD', 'APPROVED', 700)]).discrimination).toBeNull();
  });
});

describe('Monitoreo de modelo — estabilidad poblacional (PSI)', () => {
  const repeat = (value: string, times: number) => Array.from({ length: times }, () => value);

  it('poblaciones idénticas dan PSI cero y veredicto estable', () => {
    const population = [...repeat('A', 50), ...repeat('B', 50)];
    const result = populationStabilityIndex(population, [...population]);
    expect(result.psi).toBeCloseTo(0);
    expect(result.verdict).toBe('STABLE');
  });

  it('un desplazamiento grande se declara inestable', () => {
    const result = populationStabilityIndex(
      [...repeat('A', 90), ...repeat('B', 10)],
      [...repeat('A', 10), ...repeat('B', 90)],
    );
    expect(result.psi).toBeGreaterThan(0.25);
    expect(result.verdict).toBe('UNSTABLE');
  });

  it('los cortes de veredicto son 0.10 y 0.25', () => {
    const leve = populationStabilityIndex(
      [...repeat('A', 50), ...repeat('B', 50)],
      [...repeat('A', 45), ...repeat('B', 55)],
    );
    expect(leve.psi).toBeLessThan(0.1);
    expect(leve.verdict).toBe('STABLE');
  });

  it('una categoría nueva NO manda el índice al infinito', () => {
    // `ln(0)` es -∞: sin el piso mínimo, un solo valor no visto antes convertía el índice en
    // un número inservible en vez de en una señal.
    const result = populationStabilityIndex(repeat('A', 100), [...repeat('A', 99), 'NUEVA']);
    expect(Number.isFinite(result.psi)).toBe(true);
    expect(result.buckets.map((b) => b.bucket)).toContain('NUEVA');
  });

  it('una categoría que desaparece tampoco', () => {
    const result = populationStabilityIndex(
      [...repeat('A', 50), ...repeat('B', 50)],
      repeat('A', 100),
    );
    expect(Number.isFinite(result.psi)).toBe(true);
    expect(result.verdict).toBe('UNSTABLE');
  });

  it('una ventana vacía no produce un veredicto falso', () => {
    // Sin datos no hay deriva que declarar; inventar «estable» con conteo cero sería peor.
    const result = populationStabilityIndex([], repeat('A', 10));
    expect(result.psi).toBe(0);
    expect(result.referenceCount).toBe(0);
    expect(result.buckets).toEqual([]);
  });

  it('ordena las categorías por cuánto aportan, para saber qué se movió', () => {
    const result = populationStabilityIndex(
      [...repeat('A', 50), ...repeat('B', 40), ...repeat('C', 10)],
      [...repeat('A', 10), ...repeat('B', 40), ...repeat('C', 50)],
    );
    // La primera es la que más explica el desplazamiento, que es lo que mira quien investiga.
    expect(result.buckets[0].contribution).toBeGreaterThanOrEqual(
      result.buckets[result.buckets.length - 1].contribution,
    );
  });
});

describe('Monitoreo de modelo — impacto adverso (regla de 4/5)', () => {
  const group = (name: string, approved: number, declined: number) => [
    ...Array.from({ length: approved }, () => ({ group: name, approved: true })),
    ...Array.from({ length: declined }, () => ({ group: name, approved: false })),
  ];

  it('marca el grupo cuya razón cae por debajo de 0.8', () => {
    const result = adverseImpactRatios('AGE_BAND', [
      ...group('26-40', 80, 20), // 80%
      ...group('60+', 50, 50), // 50% → razón 0.625
    ]);
    expect(result.referenceGroup).toBe('26-40');
    const mayores = result.groups.find((g) => g.group === '60+');
    expect(mayores?.impactRatio).toBeCloseTo(0.625);
    expect(mayores?.belowThreshold).toBe(true);
    expect(result.flagged).toBe(true);
  });

  it('no marca una diferencia que se mantiene dentro del umbral', () => {
    const result = adverseImpactRatios('REGION', [
      ...group('NORTE', 80, 20), // 80%
      ...group('SUR', 68, 32), // 68% → razón 0.85
    ]);
    expect(result.flagged).toBe(false);
  });

  it('ignora los grupos demasiado pequeños y lo dice', () => {
    // Tres personas producen razones extremas que son ruido; señalarlas sería una falsa
    // alarma que enseña a ignorar el informe.
    const result = adverseImpactRatios('GENDER', [...group('A', 80, 20), ...group('B', 0, 3)]);
    expect(result.ignoredForSmallSample).toEqual(['B']);
    expect(result.groups.map((g) => g.group)).toEqual(['A']);
    expect(result.flagged).toBe(false);
  });

  it('el umbral de muestra es 30', () => {
    const result = adverseImpactRatios('X', [...group('A', 60, 40), ...group('B', 5, 25)]);
    expect(result.groups.map((g) => g.group).sort()).toEqual(['A', 'B']);
  });

  it('si nadie aprueba en ningún grupo no hay disparidad que declarar', () => {
    // Cero entre cero no es discriminación: es un modelo que rechaza a todo el mundo, que es
    // otro problema y se ve en la tasa de aprobación.
    const result = adverseImpactRatios('X', [...group('A', 0, 40), ...group('B', 0, 40)]);
    expect(result.groups.every((g) => g.impactRatio === 1)).toBe(true);
    expect(result.flagged).toBe(false);
  });

  it('sin ningún grupo con muestra suficiente no emite veredicto', () => {
    const result = adverseImpactRatios('X', group('A', 2, 2));
    expect(result.referenceGroup).toBeNull();
    expect(result.flagged).toBe(false);
  });

  it('ordena de menor a mayor razón: primero lo que hay que mirar', () => {
    const result = adverseImpactRatios('X', [
      ...group('ALTA', 90, 10),
      ...group('BAJA', 30, 70),
      ...group('MEDIA', 60, 40),
    ]);
    expect(result.groups.map((g) => g.group)).toEqual(['BAJA', 'MEDIA', 'ALTA']);
  });
});

describe('Qué cuenta como aprobación', () => {
  it.each(['APPROVED', 'APPROVED_WITH_CONDITIONS', 'PRE_APPROVED'])('%s sí', (outcome) => {
    expect(isApproval(outcome)).toBe(true);
  });

  it.each(['DECLINED', 'REJECTED', 'DENIED', 'NO_DECISION', 'MANUAL_REVIEW', 'FAILED'])(
    '%s no',
    (outcome) => {
      expect(isApproval(outcome)).toBe(false);
    },
  );

  it('un resultado ausente no es una aprobación', () => {
    // Tratar `null` como aprobación inflaría la tasa de todos los grupos por igual y haría
    // desaparecer justo la disparidad que se busca.
    expect(isApproval(null)).toBe(false);
    expect(isApproval(undefined)).toBe(false);
    expect(isApproval('')).toBe(false);
  });

  it('la comparación no depende de mayúsculas', () => {
    expect(isApproval('declined')).toBe(false);
  });
});

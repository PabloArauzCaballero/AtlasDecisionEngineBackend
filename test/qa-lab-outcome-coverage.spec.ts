import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';
import {
  allocateOutcomeCounts,
  describeOutcomes,
  planOutcomeAllocation,
  planOutcomeCases,
  reachableOutcomeKeys,
} from '../src/modules/qa-lab/outcome-coverage';
import { buildSampleBatch } from '../src/modules/qa-lab/sample-inputs';
import { SeededRandom } from '../src/modules/qa-lab/seeded-random';

/**
 * Un caso por DESENLACE, no por clase de contrato.
 *
 * Lo que se comprueba aquí es lo único que hace útil a esta clase de lote: que la
 * entrada generada para «aprobado» de verdad lleva la ejecución a aprobado —se
 * evalúan las condiciones del camino con el MISMO evaluador que usa el motor— y que
 * lo que no se puede gobernar desde el payload se declara en vez de callarse.
 */
const evaluator = new ExpressionEvaluator();

function node(key: string, extra: Partial<CompiledDecisionArtifact['nodes'][string]> = {}) {
  return {
    key,
    type: 'CONDITION' as const,
    label: key,
    config: {},
    x: 0,
    y: 0,
    order: 0,
    terminal: false,
    conditions: [],
    actions: [],
    ...extra,
  };
}

function edge(key: string, from: string, to: string, conditions: string[], isDefault = false) {
  return {
    key,
    from,
    to,
    type: 'SEQUENCE',
    priority: 1,
    default: isDefault,
    conditions: conditions.map((code, order) => ({ code, order })),
  };
}

/** Grafo mínimo con tres finales: aprobado, revisión y rechazado. */
const compiled = {
  runtimeSchemaVersion: '1.2',
  compilerVersion: 'test',
  artifact: {
    id: '1',
    tenantId: '1',
    code: 'DEMO',
    type: 'DECISION',
    name: 'Demo',
    riskDomain: '',
  },
  version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DEPLOYED_TO_PROD' },
  variables: [],
  intermediates: [],
  outputContract: [],
  startNodeKey: 'inicio',
  nodes: {
    inicio: node('inicio'),
    aprobado: node('aprobado', {
      terminal: true,
      label: 'Aprobado',
      actions: [{ code: 'a_ok', order: 0 }],
    }),
    revision: node('revision', { terminal: true, label: 'Revisión manual' }),
    rechazado: node('rechazado', { terminal: true, label: 'Rechazado' }),
  },
  edgesByNode: {
    inicio: [
      edge('e_ok', 'inicio', 'aprobado', ['score_alto']),
      edge('e_rev', 'inicio', 'revision', ['score_medio']),
      edge('e_no', 'inicio', 'rechazado', [], true),
    ],
  },
  conditions: {
    score_alto: {
      code: 'score_alto',
      name: 'Score alto',
      expressionType: 'COMPARISON',
      expression: { variable: 'variables.score', operator: 'gte', value: 750 },
      severity: 'BLOCKING',
      reusable: false,
    },
    score_medio: {
      code: 'score_medio',
      name: 'Score medio',
      expressionType: 'COMPARISON',
      expression: { variable: 'variables.score', operator: 'gte', value: 600 },
      severity: 'BLOCKING',
      reusable: false,
    },
  },
  actions: {
    a_ok: {
      code: 'a_ok',
      type: 'SET_OUTCOME',
      payload: { outcome: 'APPROVED' },
      terminal: true,
      reasonCodes: [],
    },
  },
  totals: { nodes: 4, edges: 3, terminalPaths: 3 },
} as unknown as CompiledDecisionArtifact;

const inputs = [
  {
    code: 'score',
    dataType: 'INTEGER',
    required: true,
    nullable: false,
    constraints: { min: 300, max: 900 },
  },
];

const seeds = () => 'semilla-fija';

describe('valores de prueba por desenlace', () => {
  it('genera un caso por cada final del grafo, no los tres pedidos', () => {
    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES', count: 3 }, seeds, compiled);

    expect(batch.totalOutcomes).toBe(3);
    expect(batch.cases.map((item) => item.nodeKey)).toEqual(['aprobado', 'revision', 'rechazado']);
  });

  it('nombra el desenlace con la acción terminal cuando la hay', () => {
    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES' }, seeds, compiled);
    expect(batch.cases[0].outcome).toBe('APPROVED');
    expect(batch.cases[1].outcome).toBe('Revisión manual');
  });

  it('la entrada de cada caso lleva de verdad a su rama', () => {
    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES' }, seeds, compiled);
    const [aprobado, revision, rechazado] = batch.cases.map((item) => item.input.score as number);

    expect(aprobado).toBeGreaterThanOrEqual(750);
    // La rama de revisión exige cumplir «score_medio» Y no cumplir «score_alto»: si sólo
    // se cumpliera la primera, el motor se iría por la arista de más prioridad.
    expect(revision).toBeGreaterThanOrEqual(600);
    expect(revision).toBeLessThan(750);
    // La arista por defecto se toma cuando ninguna otra pasa.
    expect(rechazado).toBeLessThan(600);
  });

  it('las condiciones del camino se cumplen con el evaluador del motor', () => {
    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES' }, seeds, compiled);
    const context = (input: Record<string, unknown>) => ({ ...input, variables: input });

    expect(
      evaluator.evaluate(compiled.conditions.score_alto.expression, context(batch.cases[0].input)),
    ).toBe(true);
    expect(
      evaluator.evaluate(compiled.conditions.score_alto.expression, context(batch.cases[1].input)),
    ).toBe(false);
    expect(
      evaluator.evaluate(compiled.conditions.score_medio.expression, context(batch.cases[2].input)),
    ).toBe(false);
    expect(batch.cases.flatMap((item) => item.unresolved ?? [])).toEqual([]);
  });

  it('declara la condición que no se puede gobernar desde la entrada', () => {
    const conIntermedia = {
      ...compiled,
      conditions: {
        ...compiled.conditions,
        score_alto: {
          ...compiled.conditions.score_alto,
          expression: { variable: 'intermediate.dti', operator: 'lt', value: 0.4 },
        },
      },
    } as CompiledDecisionArtifact;

    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES' }, seeds, conIntermedia);
    expect(batch.cases[0].unresolved?.[0]).toContain('score_alto');
  });

  it('sin grafo compilado no finge desenlaces', () => {
    const batch = buildSampleBatch(inputs, { kind: 'OUTCOMES' }, seeds);
    expect(batch.cases).toEqual([]);
    expect(batch.totalOutcomes).toBe(0);
  });

  it('el plan es reproducible: la misma semilla da los mismos valores', () => {
    const uno = planOutcomeCases(compiled, inputs, new SeededRandom('fija'), 10);
    const dos = planOutcomeCases(compiled, inputs, new SeededRandom('fija'), 10);
    expect(dos.cases).toEqual(uno.cases);
  });

  it('el tope recorta pero deja constancia de cuántos desenlaces hay', () => {
    const plan = planOutcomeCases(compiled, inputs, new SeededRandom('fija'), 2);
    expect(plan.cases).toHaveLength(2);
    // Sin este dato, dos casos sobre tres finales se leerían como cobertura completa.
    expect(plan.totalOutcomes).toBe(3);
  });
});

describe('reparto de la porción válida entre desenlaces', () => {
  it('publica los desenlaces alcanzables, que es contra lo que se validan los pesos', () => {
    expect(reachableOutcomeKeys(compiled)).toEqual(['aprobado', 'revision', 'rechazado']);
  });

  it('genera tantos casos por rama como pide el reparto', () => {
    const allocation = new Map([
      ['rechazado', 3],
      ['aprobado', 1],
    ]);
    const cases = planOutcomeAllocation(compiled, inputs, new SeededRandom('fija'), allocation);

    expect(cases).toHaveLength(4);
    expect(cases.filter((item) => item.nodeKey === 'rechazado')).toHaveLength(3);
    expect(cases.filter((item) => item.nodeKey === 'aprobado')).toHaveLength(1);
  });

  it('los casos de una misma rama NO son copias del mismo valor', () => {
    const allocation = new Map([['rechazado', 4]]);
    const cases = planOutcomeAllocation(compiled, inputs, new SeededRandom('fija'), allocation);
    const scores = new Set(cases.map((item) => item.input.score));

    // Cuatro clones dirían «cuatro casos» habiendo probado uno. Todos respetan además el
    // techo de su rama: por debajo de 600 no se cumple ninguna condición y cae al defecto.
    expect(scores.size).toBeGreaterThan(1);
    for (const item of cases) expect(item.input.score as number).toBeLessThan(600);
  });

  it('un desenlace inalcanzable no se cuela como rama silenciosa', () => {
    const cases = planOutcomeAllocation(
      compiled,
      inputs,
      new SeededRandom('fija'),
      new Map([['no_existe', 5]]),
    );
    // El servicio rechaza la clave antes de llegar aquí; aquí sólo se comprueba que no
    // se inventa nada por su cuenta.
    expect(cases).toEqual([]);
  });
});

describe('reparto de pesos en casos', () => {
  it('no pierde ni inventa casos aunque los pesos no sumen 100', () => {
    const reparto = allocateOutcomeCounts(
      [
        ['aprobado', 1],
        ['revision', 1],
        ['rechazado', 1],
      ],
      10,
    );
    // Tres ramas y diez casos no reparten exacto: el resto mayor asigna las plazas que
    // sobran en vez de perderlas, y el total sigue siendo diez.
    expect([...reparto.values()].reduce((suma, casos) => suma + casos, 0)).toBe(10);
    expect([...reparto.values()].sort()).toEqual([3, 3, 4]);
  });

  it('respeta la proporción pedida', () => {
    const reparto = allocateOutcomeCounts(
      [
        ['rechazado', 70],
        ['aprobado', 30],
      ],
      100,
    );
    expect(reparto.get('rechazado')).toBe(70);
    expect(reparto.get('aprobado')).toBe(30);
  });

  it('un peso a cero deja esa rama sin casos, sin robárselos a las demás', () => {
    const reparto = allocateOutcomeCounts(
      [
        ['aprobado', 0],
        ['rechazado', 5],
      ],
      8,
    );
    expect(reparto.get('aprobado')).toBe(0);
    expect(reparto.get('rechazado')).toBe(8);
  });

  it('publica el rótulo junto a la clave, que es lo que elige quien reparte', () => {
    expect(describeOutcomes(compiled)).toEqual([
      { nodeKey: 'aprobado', label: 'APPROVED' },
      { nodeKey: 'revision', label: 'Revisión manual' },
      { nodeKey: 'rechazado', label: 'Rechazado' },
    ]);
  });
});

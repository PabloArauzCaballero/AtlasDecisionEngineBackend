import { validateOperationInputs } from '../src/modules/graph/validators/graph-operation-inputs.validator';
import { buildGraphLookups } from '../src/modules/graph/validators/graph-lookups';
import type {
  ArtifactGraphSnapshot,
  GraphNodeSnapshot,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Cobertura de variables (§2.4): el árbol debe declarar como entrada TODO lo que
 * consumen los campos calculados de sus nodos. Puede declarar de más, nunca de menos.
 *
 * La regla existe porque un mapeo coherente no basta: si el dato no entra a la
 * decisión, en ejecución llega vacío y el fallo aparece con un caso real delante.
 */
function variable(
  code: string,
  usageType = 'INPUT',
  overrides: Partial<VariableContractSnapshot> = {},
): VariableContractSnapshot {
  return {
    variableVersionId: '1',
    usageType,
    code,
    version: 1,
    dataType: 'DECIMAL',
    nullable: false,
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: false,
    validationRules: [],
    sources: [],
    ...overrides,
  };
}

function nodeWithCall(
  mapping: Record<string, { source: string; path?: string }>,
  inputs: unknown[],
) {
  const node = {
    key: 'CALC',
    type: 'EXPRESSION',
    label: 'Calcular',
    config: {},
    x: 0,
    y: 0,
    order: 1,
    terminal: false,
    conditions: [],
    actions: [],
    calculatedFieldCalls: [
      {
        callKey: 'c1',
        fieldCode: 'capacidad_de_pago',
        calculatedFieldVersionId: '9',
        versionNumber: 1,
        inputMapping: mapping,
        target: { kind: 'INTERMEDIATE', code: 'resultado' },
        definition: { implementationKind: 'OPERATION', contract: { inputs } },
      },
    ],
  };
  return node as unknown as GraphNodeSnapshot;
}

function snapshot(
  variables: VariableContractSnapshot[],
  node: GraphNodeSnapshot,
): ArtifactGraphSnapshot {
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'A',
      type: 'CREDIT_POLICY',
      name: 'A',
      riskDomain: 'CREDIT',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables,
    intermediates: [],
    outputContract: [],
    conditions: [],
    actions: [],
    nodes: [node],
    edges: [],
  };
}

const run = (graph: ArtifactGraphSnapshot) =>
  validateOperationInputs(graph, buildGraphLookups(graph));
const codes = (issues: Array<{ code: string }>) => issues.map((entry) => entry.code);

describe('cobertura de variables de las operaciones', () => {
  const required = [{ id: 'monthly_expenses', dataType: 'DECIMAL', required: true }];
  const mapping = { monthly_expenses: { source: 'VARIABLE', path: 'monthly_expenses' } };

  it('acepta el árbol que declara la variable exigida', () => {
    const report = run(snapshot([variable('monthly_expenses')], nodeWithCall(mapping, required)));
    expect(report.errors).toEqual([]);
  });

  it('acepta que el árbol declare variables de más', () => {
    const report = run(
      snapshot(
        [variable('monthly_expenses'), variable('tipo_cliente'), variable('moneda')],
        nodeWithCall(mapping, required),
      ),
    );
    expect(report.errors).toEqual([]);
  });

  it('rechaza el árbol al que le falta una variable exigida, nombrándola', () => {
    const report = run(snapshot([variable('monthly_income')], nodeWithCall(mapping, required)));
    expect(codes(report.errors)).toContain('OPERATION_INPUT_NOT_DECLARED');
    // El mensaje debe identificar el campo Y la variable: sin eso hay que adivinar.
    expect(report.errors[0].message).toContain('capacidad_de_pago');
    expect(report.errors[0].message).toContain('monthly_expenses');
    expect(report.errors[0].entityKey).toBe('monthly_expenses');
  });

  it('rechaza alimentar una operación desde una variable de SALIDA', () => {
    // Una salida no tiene valor cuando el nodo se ejecuta; antes esto pasaba
    // porque se comprobaba contra todas las variables, entradas y salidas juntas.
    const report = run(
      snapshot([variable('monthly_expenses', 'OUTPUT_PRIMARY')], nodeWithCall(mapping, required)),
    );
    expect(codes(report.errors)).toContain('OPERATION_INPUT_IS_OUTPUT');
  });

  it('avisa, sin bloquear, de una entrada opcional sin alimentar', () => {
    const inputs = [
      { id: 'monthly_expenses', dataType: 'DECIMAL', required: true },
      { id: 'bonus', dataType: 'DECIMAL', required: false },
    ];
    const report = run(snapshot([variable('monthly_expenses')], nodeWithCall(mapping, inputs)));
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toContain('OPERATION_OPTIONAL_INPUT_UNMAPPED');
  });

  it('ignora las entradas que no vienen de una variable del contrato', () => {
    const literal = { monthly_expenses: { source: 'LITERAL' } };
    const report = run(snapshot([], nodeWithCall(literal, required)));
    expect(report.errors).toEqual([]);
  });
});

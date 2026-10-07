import { compiledFixture } from './graph.fixture';
import type {
  CompiledDecisionArtifact,
  GraphActionSnapshot,
  GraphConditionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  NodeType,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';
import type { GeneratorContractVariable } from '../src/modules/qa-lab/contract-value-factory';

/**
 * Una definición de `scripts/lib/*.definicion.json` vuelta a leer como el compilado que ejecuta el
 * motor. Sirve para probar contra los grafos REALES de Atlas sin levantar la API de gestión.
 */
interface Definicion {
  inputs: Array<{
    code: string;
    dataType: string;
    required?: boolean;
    nullable?: boolean;
    constraints?: unknown;
  }>;
  outputs: Array<{ code: string; dataType: string; usageType: string }>;
  intermediates: Array<{
    code: string;
    name: string;
    description: string;
    dataType: string;
    producerNodeKey: string;
    consumerNodeKeys: string[];
  }>;
  conditions: Array<{
    code: string;
    name: string;
    expressionType: string;
    expression: unknown;
    severity: string;
    reusable: boolean;
  }>;
  actions?: Array<{
    code: string;
    type: string;
    payload: Record<string, unknown>;
    terminal: boolean;
    reasonCodes: Array<{ reasonCode: string; priority: number }>;
  }>;
  nodes: Array<{
    key: string;
    type: string;
    label: string;
    terminal: boolean;
    config?: unknown;
    actions?: Array<{ actionCode: string; order: number }>;
  }>;
  edges: Array<{
    key: string;
    from: string;
    to: string;
    type: string;
    priority: number;
    default: boolean;
    conditions: Array<{ conditionCode: string; order: number }>;
  }>;
}

function variable(
  input: {
    code: string;
    dataType: string;
    required?: boolean;
    nullable?: boolean;
    constraints?: unknown;
  },
  usageType: VariableContractSnapshot['usageType'],
): VariableContractSnapshot {
  const direccion = usageType === 'INPUT' ? 'input' : 'output';
  const opcional = input.required === false;
  return {
    variableVersionId: `${direccion}-${input.code}`,
    usageType,
    dependencyPath: `${direccion}.${input.code}`,
    code: input.code,
    version: 1,
    dataType: input.dataType,
    nullable: Boolean(input.nullable) || opcional,
    constraints: input.constraints,
    validationRules: [],
    sources: [],
    required: usageType === 'INPUT' && !opcional,
    fallbackPolicy: opcional ? 'DEFAULT_VALUE' : 'FAIL_CLOSED',
    sensitive: false,
  } as VariableContractSnapshot;
}

export function compilarDefinicion(raw: unknown): CompiledDecisionArtifact {
  const definicion = raw as Definicion;
  const nodes: GraphNodeSnapshot[] = definicion.nodes.map((node, index) => ({
    id: node.key,
    key: node.key,
    type: node.type as NodeType,
    label: node.label,
    config: (node.config ?? {}) as Record<string, unknown>,
    x: 0,
    y: 0,
    order: index,
    terminal: node.terminal,
    conditions: [],
    actions: (node.actions ?? []).map((action) => ({
      code: action.actionCode,
      order: action.order,
    })),
  }));
  const edges: GraphEdgeSnapshot[] = definicion.edges.map((edge) => ({
    id: edge.key,
    key: edge.key,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    priority: edge.priority,
    default: edge.default,
    conditions: edge.conditions.map((condition) => ({
      code: condition.conditionCode,
      order: condition.order,
    })),
  }));
  const conditions: GraphConditionSnapshot[] = definicion.conditions.map((condition, index) => ({
    id: String(index + 1),
    code: condition.code,
    name: condition.name,
    expressionType: condition.expressionType,
    expression: condition.expression as Record<string, unknown>,
    severity: condition.severity,
    reusable: condition.reusable,
  }));
  const intermediates = definicion.intermediates.map((item) => ({
    code: item.code,
    name: item.name,
    description: item.description,
    dataType: item.dataType,
    producerNodeKey: item.producerNodeKey,
    consumerNodeKeys: item.consumerNodeKeys,
    nullable: true,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
  })) as IntermediateVariableSnapshot[];
  const actions: GraphActionSnapshot[] = (definicion.actions ?? []).map((action) => ({
    code: action.code,
    type: action.type,
    payload: action.payload,
    terminal: action.terminal,
    reasonCodes: action.reasonCodes.map((reason) => ({
      code: reason.reasonCode,
      category: 'TEST',
      publicMessage: reason.reasonCode,
      internalMessage: reason.reasonCode,
      severity: 'LOW',
      adverseAction: false,
      priority: reason.priority,
    })),
  })) as GraphActionSnapshot[];
  return {
    ...compiledFixture(),
    startNodeKey: 'START',
    variables: [
      ...definicion.inputs.map((input) => variable(input, 'INPUT')),
      ...definicion.outputs.map((output) =>
        variable(output, output.usageType as VariableContractSnapshot['usageType']),
      ),
    ],
    intermediates,
    outputContract: [],
    nodes: Object.fromEntries(nodes.map((n) => [n.key, n])),
    edgesByNode: Object.fromEntries(
      nodes.map((n) => [
        n.key,
        edges.filter((e) => e.from === n.key).sort((a, b) => a.priority - b.priority),
      ]),
    ),
    conditions: Object.fromEntries(conditions.map((c) => [c.code, c])),
    actions: Object.fromEntries(actions.map((a) => [a.code, a])),
  };
}

/** El contrato de entrada tal como lo ve el generador. */
export function contratoDeEntrada(raw: unknown): GeneratorContractVariable[] {
  return (raw as Definicion).inputs.map((input) => ({
    code: input.code,
    dataType: input.dataType,
    required: input.required !== false,
    nullable: Boolean(input.nullable),
    constraints: input.constraints,
  }));
}

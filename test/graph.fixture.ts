import type {
  ArtifactGraphSnapshot,
  CompiledDecisionArtifact,
} from '../src/modules/graph/graph.types';

export function graphSnapshot(): ArtifactGraphSnapshot {
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'TEST_DECISION',
      type: 'CREDIT_POLICY',
      name: 'Test decision',
      riskDomain: 'CREDIT',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables: [
      {
        variableVersionId: '10',
        code: 'score',
        version: 1,
        dataType: 'INTEGER',
        nullable: false,
        validationRules: [],
        sources: [],
        required: true,
        fallbackPolicy: 'FAIL_CLOSED',
        sensitive: false,
      },
    ],
    conditions: [
      {
        id: '20',
        code: 'SCORE_OK',
        name: 'Score acceptable',
        expressionType: 'JSON_AST',
        expression: { op: 'gte', left: { var: 'score' }, right: { value: 600 } },
        severity: 'BLOCKING',
        reusable: true,
      },
    ],
    actions: [
      {
        id: '30',
        code: 'APPROVE',
        type: 'SET_OUTCOME',
        payload: { outcome: 'APPROVED' },
        terminal: true,
        reasonCodes: [
          {
            id: '40',
            code: 'APPROVED_POLICY',
            category: 'APPROVAL',
            publicMessage: 'Approved',
            internalMessage: 'Risk threshold met',
            severity: 'INFO',
            adverseAction: false,
            priority: 10,
          },
        ],
      },
      {
        id: '31',
        code: 'DECLINE',
        type: 'SET_OUTCOME',
        payload: { outcome: 'DECLINED' },
        terminal: true,
        reasonCodes: [
          {
            id: '41',
            code: 'RISK_THRESHOLD_NOT_MET',
            category: 'CREDIT_RISK',
            publicMessage: 'Not approved',
            internalMessage: 'Risk threshold not met',
            severity: 'HIGH',
            adverseAction: true,
            priority: 10,
          },
        ],
      },
    ],
    nodes: [
      {
        id: '1',
        key: 'START',
        type: 'START',
        label: 'Start',
        config: {},
        x: 0,
        y: 0,
        order: 1,
        terminal: false,
        conditions: [],
        actions: [],
      },
      {
        id: '2',
        key: 'CHECK',
        type: 'CONDITION',
        label: 'Check score',
        config: {},
        x: 100,
        y: 0,
        order: 2,
        terminal: false,
        conditions: [],
        actions: [],
      },
      {
        id: '3',
        key: 'APPROVED',
        type: 'ACTION',
        label: 'Approved',
        config: {},
        x: 200,
        y: -50,
        order: 3,
        terminal: true,
        conditions: [],
        actions: [{ code: 'APPROVE', order: 1 }],
      },
      {
        id: '4',
        key: 'DECLINED',
        type: 'ACTION',
        label: 'Declined',
        config: {},
        x: 200,
        y: 50,
        order: 4,
        terminal: true,
        conditions: [],
        actions: [{ code: 'DECLINE', order: 1 }],
      },
    ],
    edges: [
      {
        id: '1',
        key: 'START_CHECK',
        from: 'START',
        to: 'CHECK',
        type: 'DEFAULT',
        priority: 1,
        default: true,
        conditions: [],
      },
      {
        id: '2',
        key: 'CHECK_APPROVE',
        from: 'CHECK',
        to: 'APPROVED',
        type: 'CONDITIONAL',
        priority: 1,
        default: false,
        conditions: [{ code: 'SCORE_OK', order: 1 }],
      },
      {
        id: '3',
        key: 'CHECK_DECLINE',
        from: 'CHECK',
        to: 'DECLINED',
        type: 'DEFAULT',
        priority: 999,
        default: true,
        conditions: [],
      },
    ],
  };
}

export function compiledFixture(): CompiledDecisionArtifact {
  const graph = graphSnapshot();
  return {
    runtimeSchemaVersion: '1.0',
    compilerVersion: 'test-compiler',
    artifact: graph.artifact,
    version: graph.version,
    variables: graph.variables,
    startNodeKey: 'START',
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.key, node])),
    edgesByNode: Object.fromEntries(
      graph.nodes.map((node) => [
        node.key,
        graph.edges
          .filter((edge) => edge.from === node.key)
          .sort((a, b) => a.priority - b.priority),
      ]),
    ),
    conditions: Object.fromEntries(
      graph.conditions.map((condition) => [condition.code, condition]),
    ),
    actions: Object.fromEntries(graph.actions.map((action) => [action.code, action])),
    totals: { nodes: 4, edges: 3, terminalPaths: 2 },
  };
}

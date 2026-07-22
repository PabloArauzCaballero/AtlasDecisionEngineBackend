import type { Prisma, PrismaClient } from '@prisma/client';

export interface ConditionDefinition {
  code: string;
  name: string;
  expression: unknown;
}
export interface ActionDefinition {
  code: string;
  type: string;
  payload: Record<string, unknown>;
  terminal: boolean;
  reason?: string;
}
export interface NodeDefinition {
  key: string;
  type: string;
  label: string;
  order: number;
  terminal: boolean;
  config: Record<string, unknown>;
}
export interface EdgeDefinition {
  key: string;
  from: string;
  to: string;
  priority: number;
  default: boolean;
  condition?: string;
}

export interface DemoGraphResult {
  conditionDefinitions: ConditionDefinition[];
  actionDefinitions: ActionDefinition[];
  nodeDefinitions: NodeDefinition[];
  nodeActionBindings: Record<string, string[]>;
  edgeDefinitions: EdgeDefinition[];
  conditionByCode: Record<string, { id: bigint }>;
  actionByCode: Record<string, { id: bigint }>;
  nodeByKey: Record<string, { id: bigint }>;
  edgeRows: Array<{ row: { id: bigint }; definition: EdgeDefinition }>;
}

/** Builds and persists the seed rule graph for the BNPL_CREDIT_DECISION demo artifact. */
export async function buildDemoGraph(
  prisma: PrismaClient,
  versionId: bigint,
  reasonByCode: Record<string, { id: bigint }>,
): Promise<DemoGraphResult> {
  const conditionDefinitions: ConditionDefinition[] = [
    {
      code: 'KYC_OK',
      name: 'KYC y consentimiento válidos',
      expression: {
        op: 'and',
        args: [
          { op: 'eq', left: { var: 'kyc_status' }, right: { value: 'VERIFIED' } },
          { op: 'eq', left: { var: 'consent_active' }, right: { value: true } },
        ],
      },
    },
    {
      code: 'FRAUD_CLEAR',
      name: 'Sin señal crítica de fraude',
      expression: { op: 'eq', left: { var: 'fraud_signal' }, right: { value: false } },
    },
    {
      code: 'ELIGIBLE_AGE',
      name: 'Mayoría de edad',
      expression: { op: 'gte', left: { var: 'age' }, right: { value: 18 } },
    },
    {
      code: 'RISK_ACCEPTABLE',
      name: 'Riesgo dentro del umbral',
      expression: { op: 'gte', left: { var: 'bureau_score' }, right: { value: 550 } },
    },
  ];
  const conditionByCode: Record<string, { id: bigint }> = {};
  for (const condition of conditionDefinitions) {
    conditionByCode[condition.code] = await prisma.decisionRuleCondition.create({
      data: {
        artifactVersionId: versionId,
        conditionCode: condition.code,
        name: condition.name,
        expressionType: 'JSON_AST',
        expressionJson: condition.expression as Prisma.InputJsonValue,
        severity: 'BLOCKING',
        isReusable: true,
      },
    });
  }

  const actionDefinitions: ActionDefinition[] = [
    {
      code: 'SET_APPROVED',
      type: 'SET_OUTCOME',
      payload: { outcome: 'APPROVED' },
      terminal: false,
      reason: 'APPROVED_POLICY',
    },
    {
      code: 'SET_APPROVED_LIMIT',
      type: 'SET_LIMIT',
      payload: {
        valueExpression: {
          op: 'round',
          arg: {
            op: 'min',
            args: [
              { value: 5000 },
              { op: 'mul', args: [{ var: 'monthly_income' }, { value: 0.35 }] },
            ],
          },
          precision: 2,
        },
      },
      terminal: false,
    },
    {
      code: 'SET_RISK_BAND',
      type: 'SET_RISK_BAND',
      payload: {
        valueExpression: {
          op: 'if',
          condition: { op: 'gte', left: { var: 'bureau_score' }, right: { value: 700 } },
          then: { value: 'LOW' },
          else: { value: 'MEDIUM' },
        },
      },
      terminal: false,
    },
    {
      code: 'DECLINE_KYC',
      type: 'SET_OUTCOME',
      payload: { outcome: 'DECLINED' },
      terminal: true,
      reason: 'KYC_OR_CONSENT_INVALID',
    },
    {
      code: 'DECLINE_AGE',
      type: 'SET_OUTCOME',
      payload: { outcome: 'DECLINED' },
      terminal: true,
      reason: 'AGE_NOT_ELIGIBLE',
    },
    {
      code: 'DECLINE_RISK',
      type: 'SET_OUTCOME',
      payload: { outcome: 'DECLINED' },
      terminal: true,
      reason: 'RISK_THRESHOLD_NOT_MET',
    },
    {
      code: 'REVIEW_FRAUD',
      type: 'CREATE_MANUAL_REVIEW',
      payload: {
        queueCode: 'FRAUD_REVIEW',
        priority: 10,
        slaMinutes: 60,
        evidence: { bureauScore: '{{bureau_score}}', requestedAmount: '{{requested_amount}}' },
      },
      terminal: true,
      reason: 'FRAUD_REVIEW_REQUIRED',
    },
  ];
  const actionByCode: Record<string, { id: bigint }> = {};
  for (const action of actionDefinitions) {
    const created = await prisma.decisionRuleAction.create({
      data: {
        artifactVersionId: versionId,
        actionCode: action.code,
        actionType: action.type,
        payloadTemplateJson: action.payload as Prisma.InputJsonValue,
        isTerminal: action.terminal,
      },
    });
    actionByCode[action.code] = created;
    if (action.reason) {
      await prisma.decisionActionReasonMapping.create({
        data: { actionId: created.id, reasonCodeId: reasonByCode[action.reason].id, priority: 10 },
      });
    }
  }

  const nodeDefinitions: NodeDefinition[] = [
    { key: 'START', type: 'START', label: 'Inicio', order: 1, terminal: false, config: {} },
    {
      key: 'CHECK_KYC',
      type: 'CONDITION',
      label: 'Validar KYC y consentimiento',
      order: 2,
      terminal: false,
      config: {},
    },
    {
      key: 'CHECK_FRAUD',
      type: 'CONDITION',
      label: 'Evaluar señales de fraude',
      order: 3,
      terminal: false,
      config: {},
    },
    {
      key: 'CHECK_AGE',
      type: 'CONDITION',
      label: 'Validar elegibilidad',
      order: 4,
      terminal: false,
      config: {},
    },
    {
      key: 'SCORE',
      type: 'SCORE',
      label: 'Calcular puntaje ATLAS',
      order: 5,
      terminal: false,
      config: {
        scoreExpression: {
          op: 'round',
          arg: {
            op: 'add',
            args: [
              { value: 300 },
              { op: 'div', left: { var: 'bureau_score' }, right: { value: 2 } },
            ],
          },
          precision: 0,
        },
      },
    },
    {
      key: 'CHECK_RISK',
      type: 'CONDITION',
      label: 'Aplicar umbral de riesgo',
      order: 6,
      terminal: false,
      config: {},
    },
    {
      key: 'APPROVE',
      type: 'ACTION',
      label: 'Aprobar y asignar línea',
      order: 7,
      terminal: true,
      config: {},
    },
    {
      key: 'DECLINE_KYC',
      type: 'ACTION',
      label: 'Rechazar por KYC',
      order: 8,
      terminal: true,
      config: {},
    },
    {
      key: 'MANUAL_REVIEW',
      type: 'ACTION',
      label: 'Derivar a revisión manual',
      order: 9,
      terminal: true,
      config: {},
    },
    {
      key: 'DECLINE_AGE',
      type: 'ACTION',
      label: 'Rechazar por elegibilidad',
      order: 10,
      terminal: true,
      config: {},
    },
    {
      key: 'DECLINE_RISK',
      type: 'ACTION',
      label: 'Rechazar por riesgo',
      order: 11,
      terminal: true,
      config: {},
    },
  ];
  const nodeByKey: Record<string, { id: bigint }> = {};
  for (const node of nodeDefinitions) {
    nodeByKey[node.key] = await prisma.decisionRuleNode.create({
      data: {
        artifactVersionId: versionId,
        nodeKey: node.key,
        nodeType: node.type,
        label: node.label,
        configJson: node.config as Prisma.InputJsonValue,
        xPos: node.order * 120,
        yPos: 100,
        orderIndex: node.order,
        isTerminal: node.terminal,
      },
    });
  }

  const nodeActionBindings: Record<string, string[]> = {
    APPROVE: ['SET_APPROVED', 'SET_APPROVED_LIMIT', 'SET_RISK_BAND'],
    DECLINE_KYC: ['DECLINE_KYC'],
    MANUAL_REVIEW: ['REVIEW_FRAUD'],
    DECLINE_AGE: ['DECLINE_AGE'],
    DECLINE_RISK: ['DECLINE_RISK'],
  };
  for (const [nodeKey, actionCodes] of Object.entries(nodeActionBindings)) {
    for (let index = 0; index < actionCodes.length; index += 1) {
      await prisma.decisionNodeAction.create({
        data: {
          nodeId: nodeByKey[nodeKey].id,
          actionId: actionByCode[actionCodes[index]].id,
          executionOrder: index + 1,
        },
      });
    }
  }

  const edgeDefinitions: EdgeDefinition[] = [
    { key: 'E_START_KYC', from: 'START', to: 'CHECK_KYC', priority: 1, default: true },
    {
      key: 'E_KYC_OK',
      from: 'CHECK_KYC',
      to: 'CHECK_FRAUD',
      priority: 1,
      default: false,
      condition: 'KYC_OK',
    },
    { key: 'E_KYC_FAIL', from: 'CHECK_KYC', to: 'DECLINE_KYC', priority: 999, default: true },
    {
      key: 'E_FRAUD_CLEAR',
      from: 'CHECK_FRAUD',
      to: 'CHECK_AGE',
      priority: 1,
      default: false,
      condition: 'FRAUD_CLEAR',
    },
    {
      key: 'E_FRAUD_REVIEW',
      from: 'CHECK_FRAUD',
      to: 'MANUAL_REVIEW',
      priority: 999,
      default: true,
    },
    {
      key: 'E_AGE_OK',
      from: 'CHECK_AGE',
      to: 'SCORE',
      priority: 1,
      default: false,
      condition: 'ELIGIBLE_AGE',
    },
    { key: 'E_AGE_FAIL', from: 'CHECK_AGE', to: 'DECLINE_AGE', priority: 999, default: true },
    { key: 'E_SCORE_RISK', from: 'SCORE', to: 'CHECK_RISK', priority: 1, default: true },
    {
      key: 'E_RISK_OK',
      from: 'CHECK_RISK',
      to: 'APPROVE',
      priority: 1,
      default: false,
      condition: 'RISK_ACCEPTABLE',
    },
    { key: 'E_RISK_FAIL', from: 'CHECK_RISK', to: 'DECLINE_RISK', priority: 999, default: true },
  ];
  const edgeRows: Array<{ row: { id: bigint }; definition: EdgeDefinition }> = [];
  for (const edge of edgeDefinitions) {
    const row = await prisma.decisionRuleEdge.create({
      data: {
        artifactVersionId: versionId,
        fromNodeId: nodeByKey[edge.from].id,
        toNodeId: nodeByKey[edge.to].id,
        edgeKey: edge.key,
        edgeType: edge.default ? 'DEFAULT' : 'CONDITIONAL',
        priority: edge.priority,
        isDefault: edge.default,
      },
    });
    edgeRows.push({ row, definition: edge });
    if (edge.condition) {
      await prisma.decisionEdgeCondition.create({
        data: {
          edgeId: row.id,
          conditionId: conditionByCode[edge.condition].id,
          evaluationOrder: 1,
        },
      });
    }
  }

  return {
    conditionDefinitions,
    actionDefinitions,
    nodeDefinitions,
    nodeActionBindings,
    edgeDefinitions,
    conditionByCode,
    actionByCode,
    nodeByKey,
    edgeRows,
  };
}

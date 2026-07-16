import { CompileStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { sha256 } from './helpers';
import type { ActionDefinition, ConditionDefinition, DemoGraphResult, NodeDefinition } from './demo-graph';

export type DemoVariable = { definition: { variableCode: string; isSensitive: boolean }; version: Record<string, unknown> & { id: bigint; versionNumber: number; dataType: string; unitCode: string | null; nullable: boolean; validationSchemaJson: unknown } };
export type DemoReason = { id: bigint; category: string; publicMessage: string; internalMessage: string; severity: string; isAdverseAction: boolean };

export interface DemoSnapshotResult {
  compiledChecksum: string;
  canonicalChecksum: string;
  compiledArtifact: { id: bigint };
}

/** Builds the deterministic graph/compiled snapshots for the demo artifact and persists the compiled record. */
export async function buildDemoSnapshots(
  prisma: PrismaClient,
  artifact: { id: bigint; tenantId: bigint; artifactCode: string; artifactType: string; name: string; riskDomain: string },
  version: { id: bigint },
  variables: DemoVariable[],
  reasonByCode: Record<string, DemoReason>,
  graph: DemoGraphResult,
): Promise<DemoSnapshotResult> {
  const { conditionDefinitions, actionDefinitions, nodeDefinitions, nodeActionBindings, conditionByCode, actionByCode, nodeByKey, edgeRows } = graph;

  const variableSnapshots = variables.map(({ definition, version: variable }) => ({
    variableVersionId: variable.id.toString(),
    code: definition.variableCode,
    version: variable.versionNumber,
    dataType: variable.dataType,
    unitCode: variable.unitCode,
    nullable: variable.nullable,
    validationSchema: variable.validationSchemaJson,
    validationRules: [],
    sources: [{ system: 'REQUEST_PAYLOAD', path: '$.variables', field: definition.variableCode, precedence: 1, freshnessSlaSeconds: 60, authoritative: true }],
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: definition.isSensitive,
  }));

  const conditionSnapshots = conditionDefinitions.map((item: ConditionDefinition) => ({
    id: conditionByCode[item.code].id.toString(),
    code: item.code,
    name: item.name,
    expressionType: 'JSON_AST',
    expression: item.expression,
    severity: 'BLOCKING',
    reusable: true,
  }));
  const actionSnapshots = actionDefinitions.map((item: ActionDefinition) => ({
    id: actionByCode[item.code].id.toString(),
    code: item.code,
    type: item.type,
    payload: item.payload,
    terminal: item.terminal,
    reasonCodes: item.reason
      ? [{
          id: reasonByCode[item.reason].id.toString(),
          code: item.reason,
          category: reasonByCode[item.reason].category,
          publicMessage: reasonByCode[item.reason].publicMessage,
          internalMessage: reasonByCode[item.reason].internalMessage,
          severity: reasonByCode[item.reason].severity,
          adverseAction: reasonByCode[item.reason].isAdverseAction,
          priority: 10,
        }]
      : [],
  }));
  const nodeSnapshots = nodeDefinitions.map((item: NodeDefinition) => ({
    id: nodeByKey[item.key].id.toString(),
    key: item.key,
    type: item.type,
    label: item.label,
    config: item.config,
    x: item.order * 120,
    y: 100,
    order: item.order,
    terminal: item.terminal,
    conditions: [],
    actions: (nodeActionBindings[item.key] ?? []).map((code, index) => ({ code, order: index + 1 })),
  }));
  const edgeSnapshots = edgeRows.map(({ row, definition }) => ({
    id: row.id.toString(),
    key: definition.key,
    from: definition.from,
    to: definition.to,
    type: definition.default ? 'DEFAULT' : 'CONDITIONAL',
    priority: definition.priority,
    default: definition.default,
    conditions: definition.condition ? [{ code: definition.condition, order: 1 }] : [],
  }));

  const graphSnapshot = {
    artifact: {
      id: artifact.id.toString(), tenantId: artifact.tenantId.toString(), code: artifact.artifactCode,
      type: artifact.artifactType, name: artifact.name, riskDomain: artifact.riskDomain,
    },
    version: { id: version.id.toString(), number: 1, semanticVersion: '1.0.0', status: 'APPROVED' },
    variables: variableSnapshots,
    conditions: conditionSnapshots,
    actions: actionSnapshots,
    nodes: nodeSnapshots,
    edges: edgeSnapshots,
  };
  const canonicalChecksum = sha256(graphSnapshot);
  const compiled = {
    runtimeSchemaVersion: '1.0',
    compilerVersion: 'atlas-compiler-1.0.0',
    artifact: graphSnapshot.artifact,
    version: { ...graphSnapshot.version, checksum: canonicalChecksum },
    variables: variableSnapshots,
    startNodeKey: 'START',
    nodes: Object.fromEntries(nodeSnapshots.map((node) => [node.key, node])),
    edgesByNode: Object.fromEntries(
      nodeSnapshots.map((node) => [node.key, edgeSnapshots.filter((edge) => edge.from === node.key).sort((a, b) => a.priority - b.priority)]),
    ),
    conditions: Object.fromEntries(conditionSnapshots.map((condition) => [condition.code, condition])),
    actions: Object.fromEntries(actionSnapshots.map((action) => [action.code, action])),
    totals: { nodes: nodeSnapshots.length, edges: edgeSnapshots.length, terminalPaths: 5 },
  };
  const compiledChecksum = sha256(compiled);
  const compiledArtifact = await prisma.decisionCompiledArtifact.create({
    data: {
      artifactVersionId: version.id,
      compilerVersion: 'atlas-compiler-1.0.0',
      runtimeSchemaVersion: '1.0',
      compiledPayloadJson: compiled as unknown as Prisma.InputJsonValue,
      compiledChecksum,
      compileStatus: CompileStatus.SUCCESS,
    },
  });

  return { compiledChecksum, canonicalChecksum, compiledArtifact };
}

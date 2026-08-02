import { CompileStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { layoutSeedNodes } from '../../../common/graph/tree-layout';
import { sha256 } from './helpers';
import type {
  ActionDefinition,
  ConditionDefinition,
  DemoGraphResult,
  NodeDefinition,
} from './demo-graph';

export type DemoVariable = {
  definition: { variableCode: string; isSensitive: boolean };
  version: Record<string, unknown> & {
    id: bigint;
    versionNumber: number;
    dataType: string;
    unitCode: string | null;
    nullable: boolean;
    validationSchemaJson: unknown;
  };
};
export type DemoReason = {
  id: bigint;
  category: string;
  publicMessage: string;
  internalMessage: string;
  severity: string;
  isAdverseAction: boolean;
};

export interface DemoSnapshotResult {
  compiledChecksum: string;
  canonicalChecksum: string;
  compiledArtifact: { id: bigint };
}

/** Builds the deterministic graph/compiled snapshots for the demo artifact and persists the compiled record. */
const PRIMARY_OUTPUT_CODE = 'decision_outcome';

export async function buildDemoSnapshots(
  prisma: PrismaClient,
  artifact: {
    id: bigint;
    tenantId: bigint;
    artifactCode: string;
    artifactType: string;
    name: string;
    riskDomain: string;
  },
  version: { id: bigint; semanticVersion: string },
  inputVariables: DemoVariable[],
  outputVariables: DemoVariable[],
  reasonByCode: Record<string, DemoReason>,
  graph: DemoGraphResult,
): Promise<DemoSnapshotResult> {
  const {
    conditionDefinitions,
    actionDefinitions,
    nodeDefinitions,
    nodeActionBindings,
    conditionByCode,
    actionByCode,
    nodeByKey,
    edgeDefinitions,
    edgeRows,
  } = graph;

  const inputSnapshots = inputVariables.map(({ definition, version: variable }) => ({
    variableVersionId: variable.id.toString(),
    usageType: 'INPUT',
    dependencyPath: `input.${definition.variableCode}`,
    code: definition.variableCode,
    version: variable.versionNumber,
    dataType: variable.dataType,
    unitCode: variable.unitCode,
    nullable: variable.nullable,
    validationSchema: variable.validationSchemaJson,
    validationRules: [],
    sources: [
      {
        system: 'REQUEST_PAYLOAD',
        path: '$.variables',
        field: definition.variableCode,
        precedence: 1,
        freshnessSlaSeconds: 60,
        authoritative: true,
      },
    ],
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: definition.isSensitive,
  }));

  // OUTPUT contracts the engine validates after execution (execution-engine.service.ts):
  // usageType + dependencyPath drive the outputContracts filter, and `required`/`nullable`
  // decide whether a missing output fails closed. `decision_outcome` is the single
  // OUTPUT_PRIMARY; it is always set on every terminal path so it stays non-nullable/required.
  const outputSnapshots = outputVariables.map(({ definition, version: variable }) => ({
    variableVersionId: variable.id.toString(),
    usageType: definition.variableCode === PRIMARY_OUTPUT_CODE ? 'OUTPUT_PRIMARY' : 'OUTPUT',
    dependencyPath: `output.${definition.variableCode}`,
    code: definition.variableCode,
    version: variable.versionNumber,
    dataType: variable.dataType,
    unitCode: variable.unitCode,
    nullable: variable.nullable,
    validationSchema: variable.validationSchemaJson,
    validationRules: [],
    sources: [
      {
        system: 'DECISION_ENGINE',
        path: '$.output',
        field: definition.variableCode,
        precedence: 1,
        freshnessSlaSeconds: 0,
        authoritative: true,
      },
    ],
    required: true,
    fallbackPolicy: 'NOT_APPLICABLE',
    sensitive: definition.isSensitive,
  }));

  const variableSnapshots = [...inputSnapshots, ...outputSnapshots];

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
      ? [
          {
            id: reasonByCode[item.reason].id.toString(),
            code: item.reason,
            category: reasonByCode[item.reason].category,
            publicMessage: reasonByCode[item.reason].publicMessage,
            internalMessage: reasonByCode[item.reason].internalMessage,
            severity: reasonByCode[item.reason].severity,
            adverseAction: reasonByCode[item.reason].isAdverseAction,
            priority: 10,
          },
        ]
      : [],
  }));
  // Mismas coordenadas (porcentaje del lienzo) que se persisten en los nodos, para
  // que el snapshot compilado y el grafo editable describan el mismo dibujo.
  const positions = layoutSeedNodes(nodeDefinitions, edgeDefinitions);
  const nodeSnapshots = nodeDefinitions.map((item: NodeDefinition) => ({
    id: nodeByKey[item.key].id.toString(),
    key: item.key,
    type: item.type,
    label: item.label,
    config: item.config,
    x: positions.get(item.key)?.x ?? 4,
    y: positions.get(item.key)?.y ?? 45,
    order: item.order,
    terminal: item.terminal,
    conditions: [],
    actions: (nodeActionBindings[item.key] ?? []).map((code, index) => ({
      code,
      order: index + 1,
    })),
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
      id: artifact.id.toString(),
      tenantId: artifact.tenantId.toString(),
      code: artifact.artifactCode,
      type: artifact.artifactType,
      name: artifact.name,
      riskDomain: artifact.riskDomain,
    },
    version: {
      id: version.id.toString(),
      number: 1,
      semanticVersion: version.semanticVersion,
      status: 'APPROVED',
    },
    variables: variableSnapshots,
    conditions: conditionSnapshots,
    actions: actionSnapshots,
    nodes: nodeSnapshots,
    edges: edgeSnapshots,
  };
  const canonicalChecksum = sha256(graphSnapshot);
  // Runtime schema 1.1: this artifact declares OUTPUT variables and uses RESULT terminals, the
  // configurable-outputs feature the engine gates on `runtimeSchemaVersion`/OUTPUT contracts
  // (compiler.service.ts sets 1.1 for exactly this shape).
  const terminalPaths = nodeSnapshots.filter((node) => node.terminal).length;
  const compiled = {
    runtimeSchemaVersion: '1.1',
    compilerVersion: 'atlas-compiler-1.1.0',
    artifact: graphSnapshot.artifact,
    version: { ...graphSnapshot.version, checksum: canonicalChecksum },
    variables: variableSnapshots,
    startNodeKey: 'START',
    nodes: Object.fromEntries(nodeSnapshots.map((node) => [node.key, node])),
    edgesByNode: Object.fromEntries(
      nodeSnapshots.map((node) => [
        node.key,
        edgeSnapshots
          .filter((edge) => edge.from === node.key)
          .sort((a, b) => a.priority - b.priority),
      ]),
    ),
    conditions: Object.fromEntries(
      conditionSnapshots.map((condition) => [condition.code, condition]),
    ),
    actions: Object.fromEntries(actionSnapshots.map((action) => [action.code, action])),
    totals: { nodes: nodeSnapshots.length, edges: edgeSnapshots.length, terminalPaths },
  };
  const compiledChecksum = sha256(compiled);
  const compiledArtifact = await prisma.decisionCompiledArtifact.create({
    data: {
      artifactVersionId: version.id,
      compilerVersion: 'atlas-compiler-1.1.0',
      runtimeSchemaVersion: '1.1',
      compiledPayloadJson: compiled as unknown as Prisma.InputJsonValue,
      compiledChecksum,
      compileStatus: CompileStatus.SUCCESS,
    },
  });

  return { compiledChecksum, canonicalChecksum, compiledArtifact };
}

import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { BranchExtractorService } from '../src/modules/code-import/branch-extractor.service';
import { ContractExtractorService } from '../src/modules/code-import/contract-extractor.service';
import { GraphGeneratorService } from '../src/modules/code-import/graph-generator.service';
import { CompilerService } from '../src/modules/graph/compiler.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { ArtifactGraphSnapshot } from '../src/modules/graph/graph.types';

/**
 * Un algoritmo importado tiene que EMITIR sus motivos, no dejarlos como texto.
 *
 * Antes cada rama escribía el motivo como una cadena en una salida
 * (`"motivo": "AGE_NOT_ELIGIBLE"`), aunque ese código ya existiera en el catálogo
 * de reason codes. Una decisión así no se puede filtrar por motivo, ni explicar
 * al cliente con su mensaje público, ni auditar contra el catálogo. Esta prueba
 * recorre el camino completo —código → árbol → grafo válido → ejecución— y exige
 * que el motivo salga en `reasons`, que es lo que consume el runtime.
 */

const SOURCE = `// @atlas-contract
// { "contractVersion": "1",
//   "inputs": [{ "id": "edad", "name": "Edad", "type": "INTEGER", "required": true }],
//   "outputs": [
//     { "id": "decision", "name": "Decisión", "type": "STRING", "required": true },
//     { "id": "motivo", "name": "Motivo", "type": "STRING", "required": true }],
//   "primaryOutputId": "decision",
//   "reasonOutputId": "motivo" }
if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE' };
} else {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY' };
}
`;

const REASONS: Record<string, { publicMessage: string; category: string }> = {
  AGE_NOT_ELIGIBLE: {
    publicMessage: 'La solicitud no cumple los requisitos de elegibilidad.',
    category: 'ELIGIBILITY',
  },
  APPROVED_POLICY: { publicMessage: 'Solicitud aprobada.', category: 'APPROVAL' },
};

function buildSnapshot(): ArtifactGraphSnapshot {
  const extraction = new ContractExtractorService().extract('JAVASCRIPT', SOURCE);
  const contract = extraction.contract!;
  const derived = new BranchExtractorService().extract(
    'JAVASCRIPT',
    extraction.scriptBody,
    contract,
  );
  expect(derived.unsupported).toBeUndefined();
  const graph = new GraphGeneratorService().generate(
    {
      irVersion: '1',
      language: 'JAVASCRIPT',
      sourceChecksum: 'x',
      scriptBody: extraction.scriptBody,
      contract,
      branches: derived.branches,
    },
    new Set(Object.keys(REASONS)),
  );

  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: 'IMPORTADO',
      type: 'CREDIT_POLICY',
      name: 'Importado',
      riskDomain: 'CREDIT_ORIGINATION',
    },
    version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables: graph.dependencies.map((dependency, index) => ({
      variableVersionId: String(index + 1),
      usageType: dependency.usageType,
      dependencyPath: dependency.dependencyPath,
      code: dependency.variableCode,
      version: 1,
      dataType: dependency.dataType,
      unitCode: null,
      nullable: false,
      validationRules: [],
      sources: [],
      required: dependency.required,
      fallbackPolicy: dependency.usageType === 'INPUT' ? 'FAIL_CLOSED' : 'NOT_APPLICABLE',
      sensitive: false,
    })),
    conditions: (graph.conditions ?? []).map((condition, index) => ({
      id: String(index + 1),
      code: condition.code,
      name: condition.name,
      expressionType: 'JSON_AST',
      expression: condition.expression,
      severity: 'BLOCKING',
      reusable: false,
    })),
    actions: (graph.actions ?? []).map((action, index) => ({
      id: String(index + 1),
      code: action.code,
      type: action.type,
      payload: {},
      terminal: false,
      reasonCodes: [
        {
          id: String(index + 1),
          code: action.reasonCode,
          category: REASONS[action.reasonCode].category,
          publicMessage: REASONS[action.reasonCode].publicMessage,
          internalMessage: action.reasonCode,
          severity: 'HIGH',
          adverseAction: action.reasonCode.startsWith('AGE'),
          priority: 10,
        },
      ],
    })),
    nodes: graph.nodes.map((node, index) => ({
      id: String(index + 1),
      key: node.key,
      type: node.type,
      label: node.label,
      config: node.config,
      x: 4 + index * 12,
      y: 45,
      order: index + 1,
      terminal: node.type === 'RESULT',
      conditions: [],
      actions: (node.actions ?? []).map((binding) => ({
        code: binding.actionCode,
        order: binding.order,
      })),
    })),
    intermediates: [],
    outputContract: [],
    edges: graph.edges.map((edge, index) => ({
      id: String(index + 1),
      key: edge.key,
      from: edge.from,
      to: edge.to,
      type: edge.conditionCode ? 'CONDITIONAL' : 'DEFAULT',
      priority: edge.default ? 999 : index + 1,
      default: edge.default,
      conditions: edge.conditionCode ? [{ code: edge.conditionCode, order: 1 }] : [],
    })),
  };
}

describe('un algoritmo importado emite sus motivos', () => {
  it('un mismo motivo en dos ramas declara la acción una sola vez', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE' };
} else if (variables.edad > 75) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE' };
} else {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY' };
}
`;
    const contract = {
      contractVersion: '1',
      inputs: [{ id: 'edad', name: 'Edad', type: 'INTEGER' as const, required: true }],
      outputs: [
        { id: 'decision', name: 'Decisión', type: 'STRING' as const, required: true },
        { id: 'motivo', name: 'Motivo', type: 'STRING' as const, required: true },
      ],
      primaryOutputId: 'decision',
      reasonOutputId: 'motivo',
    };
    const derived = new BranchExtractorService().extract('JAVASCRIPT', source, contract);
    const graph = new GraphGeneratorService().generate(
      {
        irVersion: '1',
        language: 'JAVASCRIPT',
        sourceChecksum: 'x',
        scriptBody: source,
        contract,
        branches: derived.branches,
      },
      new Set(Object.keys(REASONS)),
    );

    // Una sola definición de acción, pero un emisor por rama: si se declarara dos
    // veces, el grafo no pasaría la validación por código de acción duplicado.
    expect(graph.actions?.map((action) => action.code)).toEqual([
      'EMIT_AGE_NOT_ELIGIBLE',
      'EMIT_APPROVED_POLICY',
    ]);
    expect(graph.nodes.filter((node) => node.type === 'ACTION').map((node) => node.key)).toEqual([
      'REASON_1',
      'REASON_2',
      'REASON_DEFAULT',
    ]);
  });

  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'x'.repeat(32) }));
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 256 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  it('genera un grafo estructuralmente válido', () => {
    const report = new GraphValidatorService(new ExpressionEvaluator(), hashes).validate(
      buildSnapshot(),
    );
    if (!report.valid) {
      throw new Error(report.errors.map((error) => `${error.code}: ${error.message}`).join('\n'));
    }
    expect(report.valid).toBe(true);
  });

  it.each([
    [16, 'RECHAZADO', 'AGE_NOT_ELIGIBLE'],
    [30, 'APROBADO', 'APPROVED_POLICY'],
  ])('con edad %i decide %s y emite %s', async (edad, decision, reasonCode) => {
    const { compiled } = new CompilerService(hashes).compile(buildSnapshot(), 2);
    const result = await engine.execute(compiled, { edad });

    expect(result.output.decision).toBe(decision);
    // El motivo ya no es sólo una cadena en la salida: sale por el canal de
    // motivos, con su mensaje público, que es lo que se audita y se explica.
    expect(result.reasons.map((reason) => reason.code)).toEqual([reasonCode]);
    expect(result.reasons[0].message).toBe(REASONS[reasonCode].publicMessage);
  });
});

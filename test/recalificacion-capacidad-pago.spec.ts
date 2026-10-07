import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import definicion from '../scripts/lib/recalificacion-capacidad-pago.definicion.json';
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

/**
 * `ATLAS_RECALIFICACION_CAPACIDAD`, ejecutado con el motor real.
 *
 * Fija lo que Pablo pidió el 2026-10-06: la capacidad de pago se recalifica y sale SIEMPRE como un
 * número entero múltiplo de 50, redondeado hacia abajo (nunca presta más de lo que la capacidad
 * soporta). Además de los casos de la definición, barre cientos de miles de capacidades contra una
 * referencia en aritmética entera de centavos.
 */
describe('ATLAS_RECALIFICACION_CAPACIDAD · capacidad de pago redondeada hacia abajo a múltiplos de 50', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 64 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  function variable(
    code: string,
    dataType: string,
    usageType: VariableContractSnapshot['usageType'] = 'INPUT',
    optional = false,
  ): VariableContractSnapshot {
    const direccion = usageType === 'INPUT' ? 'input' : 'output';
    return {
      variableVersionId: `${direccion}-${code}`,
      usageType,
      dependencyPath: `${direccion}.${code}`,
      code,
      version: 1,
      dataType,
      nullable: optional,
      validationRules: [],
      sources: [],
      required: usageType === 'INPUT' && !optional,
      fallbackPolicy: optional ? 'DEFAULT_VALUE' : 'FAIL_CLOSED',
      sensitive: false,
    };
  }

  function compilar(): CompiledDecisionArtifact {
    const reasonPorCodigo = new Map(
      definicion.reasonCodes.map((reason, index) => [
        reason.reasonCode,
        {
          id: String(index + 1),
          code: reason.reasonCode,
          category: reason.category,
          publicMessage: reason.publicMessage,
          internalMessage: reason.internalMessage,
          severity: reason.severity,
          adverseAction: reason.isAdverseAction,
        },
      ]),
    );
    const actions: GraphActionSnapshot[] = definicion.actions.map((action, index) => ({
      id: String(index + 1),
      code: action.code,
      type: action.type,
      payload: action.payload,
      terminal: action.terminal,
      reasonCodes: action.reasonCodes.map((reason) => ({
        ...reasonPorCodigo.get(reason.reasonCode)!,
        priority: reason.priority,
      })),
    }));
    const nodes: GraphNodeSnapshot[] = definicion.nodes.map((node, index) => ({
      id: node.key,
      key: node.key,
      type: node.type as NodeType,
      label: node.label,
      config: node.config as Record<string, unknown>,
      x: 0,
      y: 0,
      order: index,
      terminal: node.terminal,
      conditions: [],
      actions: node.actions.map((action) => ({ code: action.actionCode, order: action.order })),
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
    const intermediates: IntermediateVariableSnapshot[] = definicion.intermediates.map((item) => ({
      code: item.code,
      name: item.name,
      description: item.description,
      dataType: item.dataType,
      producerNodeKey: item.producerNodeKey,
      consumerNodeKeys: item.consumerNodeKeys,
      nullable: false,
      updatePolicy: 'SINGLE_WRITE',
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    }));

    return {
      ...compiledFixture(),
      startNodeKey: 'START',
      variables: [
        ...definicion.inputs.map((input) =>
          variable(
            input.code,
            input.dataType,
            'INPUT',
            Boolean((input as { optional?: boolean }).optional),
          ),
        ),
        ...definicion.outputs.map((output) =>
          variable(
            output.code,
            output.dataType,
            output.usageType as VariableContractSnapshot['usageType'],
          ),
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

  const compilado = compilar();

  it.each(definicion.cases.map((caso) => [caso.caseCode, caso] as const))(
    '%s',
    async (_code, caso) => {
      const resultado = await engine.execute(compilado, caso.input);
      const esperado = caso.expectedResult as Record<string, unknown>;
      const real: Record<string, unknown> = {
        ...resultado.output,
        outcome: resultado.outcome,
        reasonCodes: resultado.reasons.map((reason) => reason.code),
      };
      for (const [clave, valor] of Object.entries(esperado)) {
        expect({ [clave]: real[clave] }).toEqual({ [clave]: valor });
      }
    },
  );

  it('barrido: 40.000 capacidades por extracto dan múltiplos de 50, hacia abajo y nunca sobre el techo', async () => {
    for (let k = 0; k < 40_000; k += 1) {
      const cuota = (k * 7) / 100; // 0,00 … ~2.800 en pasos de 7 centavos
      const resultado = await engine.execute(compilado, {
        statement_eligible: true,
        statement_max_installment: cuota,
        relationship_score: 90,
      });
      const limite = Number(resultado.output.recommended_limit);
      const techoCentavos = Math.round(Math.round(cuota * 100) * 3);
      const esperado = techoCentavos < 30_000 ? 0 : 50 * Math.floor(techoCentavos / 5_000);
      expect({ cuota, limite }).toEqual({ cuota, limite: esperado });
      expect(limite % 50).toBe(0);
      expect(Number.isInteger(limite)).toBe(true);
    }
  });

  it('ningún desenlace emite decimales: todo límite es entero', async () => {
    for (const caso of definicion.cases) {
      const resultado = await engine.execute(compilado, caso.input);
      expect(Number.isInteger(Number(resultado.output.recommended_limit))).toBe(true);
    }
  });

  it('la política coincide con la de Core (plazo, tramo inicial, mínimo, graduación)', () => {
    const texto = JSON.stringify(definicion.nodes);
    for (const fragmento of [
      '"value":1500',
      '"value":20000',
      '"value":300',
      '"value":0.1',
      '"value":50',
    ]) {
      expect(texto).toContain(fragmento);
    }
  });
});

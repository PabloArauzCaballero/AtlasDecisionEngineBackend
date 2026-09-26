import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import definicion from '../scripts/lib/riesgo-onboarding-cliente.definicion.json';
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
 * El riesgo de onboarding del cliente (`RIESGO_ONBOARDING_CLIENTE`), ejecutado con el motor real.
 *
 * ## Por qué existe
 *
 * Hasta el 2026-09-14 esta decisión no existía en el Motor: AtlasBackend la tomaba con
 * `risk_heuristic_v0`, una heurística dentro de su código que aprobaba con 65 puntos sin que
 * ninguna versión de política la hubiera visto (`DECISION_ENGINE_RISK_ARTIFACT` estaba vacío en
 * todos los entornos). `scripts/riesgo-onboarding-cliente.mjs` publica el artefacto por la API de
 * gestión, y ESTA prueba ejecuta la MISMA definición (`scripts/lib/…definicion.json`) con el motor
 * en proceso: lo que el guion publica es lo que aquí se comprueba, no una copia a mano.
 *
 * Lo que fija: la falta de evidencia manda sobre el puntaje; 65 aprueba y 64,99 no; los casos que
 * van a una persona abren caso en la cola `RIESGO_ONBOARDING` con la evidencia rellena; y no hay
 * ningún desenlace de rechazo.
 */
describe('RIESGO_ONBOARDING_CLIENTE · la política versionada del riesgo de onboarding', () => {
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
  ): VariableContractSnapshot {
    const direccion = usageType === 'INPUT' ? 'input' : 'output';
    return {
      variableVersionId: `${direccion}-${code}`,
      usageType,
      dependencyPath: `${direccion}.${code}`,
      code,
      version: 1,
      dataType,
      nullable: false,
      validationRules: [],
      sources: [],
      required: usageType === 'INPUT',
      fallbackPolicy: 'FAIL_CLOSED',
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
        ...definicion.inputs.map((input) => variable(input.code, input.dataType)),
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

  it('sin evidencia abre caso en la cola RIESGO_ONBOARDING con la evidencia rellena', async () => {
    const caso = definicion.cases.find((c) => c.caseCode === 'RIESGO-SIN-IDENTIDAD-REVISA')!;
    const resultado = await engine.execute(compilado, caso.input);
    expect(resultado.manualReview?.queueCode).toBe('RIESGO_ONBOARDING');
    // Las plantillas `{{…}}` se renderizan a texto: es lo que el analista lee en la bandeja.
    expect(resultado.manualReview?.evidence).toMatchObject({
      motivo: 'MISSING_IDENTITY_DOCUMENT',
      faltantes: '1',
      documentoIdentidad: 'false',
      puntajeTotal: '90',
      umbral: definicion.umbral,
    });
  });

  it('el puntaje insuficiente es motivo ADVERSO; la evidencia faltante no lo es', async () => {
    const bajo = definicion.cases.find((c) => c.caseCode === 'RIESGO-60-REVISA')!;
    const resultado = await engine.execute(compilado, bajo.input);
    expect(resultado.reasons.map((r) => [r.code, r.adverseAction])).toEqual([
      ['BELOW_MINIMUM_RISK_SCORE', true],
    ]);
    const sinConsentimiento = definicion.cases.find(
      (c) => c.caseCode === 'RIESGO-SIN-CONSENTIMIENTO-REVISA',
    )!;
    const revisado = await engine.execute(compilado, sinConsentimiento.input);
    expect(revisado.reasons.map((r) => [r.code, r.adverseAction])).toEqual([
      ['MISSING_CONSENT', false],
    ]);
  });

  it('aprobar no abre caso, y ningún camino termina en rechazo', async () => {
    const aprueba = definicion.cases.find((c) => c.caseCode === 'RIESGO-70-APRUEBA')!;
    const resultado = await engine.execute(compilado, aprueba.input);
    expect(resultado.manualReview).toBeUndefined();
    const desenlaces = definicion.nodes
      .filter((node) => node.terminal)
      .map(
        (node) =>
          (
            node.config as { assignments?: Array<{ outputCode: string; value?: unknown }> }
          ).assignments?.find((a) => a.outputCode === 'riesgo_decision')?.value,
      );
    expect(new Set(desenlaces)).toEqual(new Set(['APPROVE', 'MANUAL_REVIEW']));
  });
});

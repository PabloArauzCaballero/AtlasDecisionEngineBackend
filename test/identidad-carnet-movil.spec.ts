import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import definicion from '../scripts/lib/identidad-carnet-movil.definicion.json';
import type {
  CompiledDecisionArtifact,
  GraphConditionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  NodeType,
  VariableContractSnapshot,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from '../src/modules/graph/graph.types';

/**
 * La verificación de identidad del móvil (`IDENTIDAD_CARNET_MOVIL` 1.2.0), ejecutada con el motor real.
 *
 * ## Por qué existe
 *
 * La 1.1.1 vivía sólo en la base de DEV (sembrada por `seed.system` el 2026-08-23): un cambio suyo
 * no se podía revisar en un PR, y TEST (Contabo) no tenía ninguna versión. Esto reproduce su forma
 * exportada y le añade lo que AtlasBackend manda desde el 2026-09-18: la bitácora del alta.
 *
 * ## Lo que fija
 *
 * - Sin bitácora (`identidad_comportamiento_disponible = false` y el resto en `null`) decide
 *   EXACTAMENTE como la 1.1.1: es la prueba de regresión.
 * - Las tres señales de comportamiento mandan a una persona (cola `IDENTIDAD`) con la evidencia
 *   rellena, y NUNCA rechazan.
 * - El rechazo del worker manda sobre cualquier señal: un suplantador con comportamiento perfecto
 *   sigue rechazado, y un humano torpe con carnet ajeno no se aprueba por parecer humano.
 * - 0,69 no escala y 0,70 sí: el corte es el que el plan declaró.
 *
 * El worker se SUSTITUYE por un doble: lo que se prueba aquí es la política, no el OCR.
 */
type Caso = (typeof definicion.cases)[number];

/** Lo que el worker contestaría en cada escenario, con la forma de `toIdentityResult`. */
const WORKER: Record<Caso['worker'], () => WorkerServiceOutcome | Error> = {
  verificado: () => ({
    status: 'SUCCEEDED',
    result: {
      decision: 'VERIFIED',
      faceSimilarity: 0.91,
      documentEvidence: 0.88,
      documentType: 'BO_CI',
      liveness: 'PASSED',
    },
    warnings: [],
    durationMs: 1200,
  }),
  no_coincide: () => ({
    status: 'SUCCEEDED_WITH_WARNINGS',
    result: {
      decision: 'NOT_VERIFIED',
      faceSimilarity: 0.31,
      documentEvidence: 0.9,
      documentType: 'BO_CI',
      liveness: 'PASSED',
    },
    warnings: ['NOT_VERIFIED', 'FACE_NO_MATCH'],
    durationMs: 1200,
  }),
  dudoso: () => ({
    status: 'SUCCEEDED_WITH_WARNINGS',
    result: {
      decision: 'REVIEW_REQUIRED',
      faceSimilarity: 0.74,
      documentEvidence: 0.8,
      documentType: 'BO_CI',
      liveness: 'INCONCLUSIVE',
    },
    warnings: ['REVIEW_REQUIRED', 'AMBIGUOUS_FACE_MATCH'],
    durationMs: 1200,
  }),
  // El worker RECHAZA con excepción de dominio (`IDENTITY_DOCUMENT_NOT_IDENTITY`); el nodo tiene `onError: CONTINUE`
  // y el código del error llega a `intermediate.id_codigo_error`, que es lo que la condición mira.
  documento_invalido: () =>
    new DomainException(
      'IDENTITY_DOCUMENT_NOT_IDENTITY',
      'La imagen no es un documento de identidad.',
    ),
};

describe('IDENTIDAD_CARNET_MOVIL 1.2.0 · la política de identidad con la bitácora del alta', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 64 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  function variable(
    input: { code: string; dataType: string; optional?: boolean },
    usageType: VariableContractSnapshot['usageType'] = 'INPUT',
  ): VariableContractSnapshot {
    const direccion = usageType === 'INPUT' ? 'input' : 'output';
    return {
      variableVersionId: `${direccion}-${input.code}`,
      usageType,
      dependencyPath: `${direccion}.${input.code}`,
      code: input.code,
      version: 1,
      dataType: input.dataType,
      nullable: Boolean(input.optional),
      validationRules: [],
      sources: [],
      required: usageType === 'INPUT' && !input.optional,
      fallbackPolicy: input.optional ? 'DEFAULT_VALUE' : 'FAIL_CLOSED',
      sensitive: false,
    };
  }

  function compilar(): CompiledDecisionArtifact {
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
      actions: [],
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
        ...definicion.inputs.map((input) => variable(input)),
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
      actions: {},
    };
  }

  const compilado = compilar();

  function invocador(caso: Caso): WorkerServiceInvoker {
    return {
      async invoke() {
        const respuesta = WORKER[caso.worker]();
        if (respuesta instanceof Error) throw respuesta;
        return respuesta;
      },
    };
  }

  const ejecutar = (caso: Caso) =>
    engine.execute(
      compilado,
      caso.input as Record<string, unknown>,
      undefined,
      undefined,
      undefined,
      invocador(caso),
    );

  it.each(definicion.cases.map((caso) => [caso.caseCode, caso] as const))(
    '%s',
    async (_code, caso) => {
      const resultado = await ejecutar(caso);
      for (const [clave, valor] of Object.entries(caso.expectedResult)) {
        expect({ [clave]: resultado.output[clave] }).toEqual({ [clave]: valor });
      }
    },
  );

  /*
   * El carnet del escáner del sistema, visto desde la política.
   *
   * El invocador pone las marcas de la población en `warnings` (ver
   * `worker-service-invoker.service.ts`), porque el artefacto no proyecta
   * `riskFlags`. Aquí se fija la otra mitad: que esos `warnings` quedan en la
   * traza del paso —`evaluation.worker.warnings`, que `execution-writer` guarda
   * en `evaluationResultJson`— y en `workerCalls`, sin cambiar lo que decide.
   */
  describe('carnet del escáner del sistema', () => {
    const MARCAS = ['THRESHOLD_PROFILE_UNMEASURED', 'DOCUMENT_CAPTURE_SYSTEM_SCANNER'];
    const conRespuesta = (caso: Caso, respuesta: WorkerServiceOutcome) =>
      engine.execute(
        compilado,
        caso.input as Record<string, unknown>,
        undefined,
        undefined,
        undefined,
        { invoke: async () => respuesta },
      );

    it('un VERIFICADO con las marcas en `warnings` sigue VERIFICADO y las deja en la traza', async () => {
      const caso = definicion.cases.find((c) => c.caseCode === 'ID-HUMANO-VERIFICA')!;
      const verificado = WORKER.verificado() as WorkerServiceOutcome;
      const resultado = await conRespuesta(caso, { ...verificado, warnings: MARCAS });

      for (const [clave, valor] of Object.entries(caso.expectedResult)) {
        expect({ [clave]: resultado.output[clave] }).toEqual({ [clave]: valor });
      }
      expect(resultado.workerCalls[0].warnings).toEqual(MARCAS);
      const paso = resultado.trace.find((step) => step.nodeKey === 'VERIFICAR_IDENTIDAD');
      expect(
        (paso?.evaluation as { worker?: { warnings?: string[] } } | undefined)?.worker?.warnings,
      ).toEqual(MARCAS);
    });

    it('el rechazo por parecido sobre un anverso gris que el worker manda a revisión termina en REVISION_HUMANA', async () => {
      const caso = definicion.cases.find((c) => c.caseCode === 'ID-DUDOSO-REVISA')!;
      const resultado = await conRespuesta(caso, {
        status: 'SUCCEEDED_WITH_WARNINGS',
        result: {
          decision: 'REVIEW_REQUIRED',
          faceSimilarity: 0.72,
          documentEvidence: 0.9,
          documentType: 'BO_CI',
          liveness: 'PASSED',
        },
        warnings: ['REVIEW_REQUIRED', 'FACE_NO_MATCH', 'DOCUMENT_GRAYSCALE', ...MARCAS],
        durationMs: 1200,
      });
      expect(resultado.output.identidad_resultado).toBe('REVISION_HUMANA');
      expect(resultado.output.identidad_resultado).not.toBe('RECHAZADO');
    });
  });

  it('la señal de comportamiento abre caso en la cola IDENTIDAD con la evidencia de la bitácora', async () => {
    const caso = definicion.cases.find((c) => c.caseCode === 'ID-MECANICO-REVISA')!;
    const resultado = await ejecutar(caso);
    expect(resultado.manualReview?.queueCode).toBe('IDENTIDAD');
    expect(resultado.manualReview?.evidence).toMatchObject({
      motivo: 'COMPORTAMIENTO_IDENTIDAD_MECANICO',
      senal: 'COMPORTAMIENTO_MECANICO',
      pegadoEnCarnet: 'true',
      correccionesOcr: '0',
      segundosIdentidad: '30',
      decisionDelWorker: 'VERIFIED',
    });
  });

  it('ningún camino de comportamiento termina en rechazo: sólo el worker rechaza', () => {
    const rechazan = definicion.nodes.filter(
      (node) =>
        node.terminal &&
        (
          node.config as { assignments?: { outputCode: string; value?: unknown }[] }
        ).assignments?.some(
          (a) => a.outputCode === 'identidad_resultado' && a.value === 'RECHAZADO',
        ),
    );
    expect(rechazan.map((n) => n.key).sort()).toEqual(['RECHAZAR_DOCUMENTO', 'RECHAZAR_IDENTIDAD']);
    const aristasDeComportamiento = definicion.edges.filter((e) =>
      ['E_MECANICO', 'E_CAPTURA', 'E_AUTOMATIZADO'].includes(e.key),
    );
    expect(
      aristasDeComportamiento.map((e) => definicion.nodes.find((n) => n.key === e.to)!.type),
    ).toEqual(['MANUAL_REVIEW', 'MANUAL_REVIEW', 'MANUAL_REVIEW']);
    // Y van DESPUÉS de los dos rechazos y ANTES de la aprobación: el worker manda.
    const prioridades = Object.fromEntries(
      definicion.edges.filter((e) => e.from === 'EVALUAR').map((e) => [e.key, e.priority]),
    );
    expect(prioridades['E_DOC_INVALIDO']).toBeLessThan(prioridades['E_MECANICO']);
    expect(prioridades['E_NO_COINCIDE']).toBeLessThan(prioridades['E_MECANICO']);
    expect(prioridades['E_AUTOMATIZADO']).toBeLessThan(prioridades['E_APROBAR']);
  });

  it('el registro estatal y la agenda (1.3.0) sólo derivan a una persona, después del worker y antes de aprobar', () => {
    const nuevas = definicion.edges.filter((e) => ['E_REGISTRO', 'E_AGENDA'].includes(e.key));
    expect(nuevas.map((e) => definicion.nodes.find((n) => n.key === e.to)!.type)).toEqual([
      'MANUAL_REVIEW',
      'MANUAL_REVIEW',
    ]);
    const prioridades = Object.fromEntries(
      definicion.edges.filter((e) => e.from === 'EVALUAR').map((e) => [e.key, e.priority]),
    );
    expect(prioridades['E_NO_COINCIDE']).toBeLessThan(prioridades['E_REGISTRO']);
    expect(prioridades['E_REGISTRO']).toBeLessThan(prioridades['E_AGENDA']);
    expect(prioridades['E_AGENDA']).toBeLessThan(prioridades['E_APROBAR']);
    // Sin prioridades repetidas: dos aristas con la misma dejarían el orden al azar del motor.
    expect(new Set(Object.values(prioridades)).size).toBe(Object.keys(prioridades).length);
  });

  it('las entradas del registro y de la agenda son opcionales: un backend que no las mande decide como la 1.2.0', () => {
    const nuevas = definicion.inputs.filter(
      (v) => v.code.startsWith('identidad_segip_') || v.code.startsWith('identidad_agenda_'),
    );
    expect(nuevas.map((v) => v.code).sort()).toEqual([
      'identidad_agenda_bolivia_ratio',
      'identidad_agenda_coincidencias_riesgo',
      'identidad_agenda_disponible',
      'identidad_agenda_total',
      'identidad_agenda_unicos_ratio',
      'identidad_segip_coincidencia',
      'identidad_segip_estado',
    ]);
    expect(nuevas.every((v) => v.optional)).toBe(true);
  });

  it('las nueve variables de comportamiento son opcionales: sin ellas el contrato no falla cerrado', () => {
    const comportamiento = definicion.inputs.filter((v) =>
      v.code.startsWith('identidad_comportamiento_'),
    );
    expect(comportamiento).toHaveLength(9);
    expect(comportamiento.every((v) => v.optional)).toBe(true);
    expect(definicion.inputs.filter((v) => !v.optional).map((v) => v.code)).toEqual([
      'identidad_carnet_frente_base64',
      'identidad_selfie_base64',
      'identidad_pais_documento',
    ]);
  });
});

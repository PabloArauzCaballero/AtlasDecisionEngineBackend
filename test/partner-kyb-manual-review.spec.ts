import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import type {
  CompiledDecisionArtifact,
  GraphConditionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  IntermediateVariableSnapshot,
  NodeType,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * La verificación del expediente del comercio (`PARTNER_KYB_REVIEW`), ejecutada con el motor real.
 *
 * ## Por qué existe esta prueba
 *
 * El artefacto tenía sus TRES desenlaces como nodos `RESULT`, y uno de ellos se llama
 * «REVISION_MANUAL». Un `RESULT` no abre nada: el caso en `decision_manual_review_case` sólo se
 * crea desde un nodo `MANUAL_REVIEW`. Medido contra el motor local el 2026-09-08, un expediente
 * completo con el correo sin verificar devolvía `outcome: REVISION_MANUAL` y `manualReview: null`
 * — un expediente derivado «a una persona» que no aparecía en la cola de ninguna persona, con el
 * comercio esperando indefinidamente a que alguien lo mirase.
 *
 * El grafo del artefacto vive hoy en una rama de PostgreSQL y no en el repositorio (`c4084c9`),
 * así que un cambio suyo no se puede revisar en un PR. Esto reproduce su forma —las dos
 * intermedias, las dos condiciones, las tres salidas— y comprueba con el MOTOR, no de palabra,
 * que cada expediente acaba donde debe. `scripts/kyb-revision-manual.mjs` publica la versión que
 * cumple esto.
 */
describe('PARTNER_KYB_REVIEW · la derivación a revisión abre caso', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );

  const REQUISITOS = [
    'kyb_tiene_matricula',
    'kyb_representante_acreditado',
    'kyb_qr_negocio',
    'kyb_qr_bancario',
  ] as const;

  /** Cuántos días de expediente abierto se consideran ya una señal para mirarlo con ojos humanos. */
  const DIAS_PARA_CONSIDERAR_ANTIGUO = 120;

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

  const entrada = (code: string, dataType: string) => variable(code, dataType);

  function intermedia(code: string, producerNodeKey: string): IntermediateVariableSnapshot {
    return {
      code,
      name: code,
      description: code,
      dataType: 'INTEGER',
      producerNodeKey,
      consumerNodeKeys: ['EVALUAR', 'APROBAR', 'REVISAR', 'RECHAZAR'],
      nullable: false,
      updatePolicy: 'SINGLE_WRITE',
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    };
  }

  function node(
    key: string,
    type: NodeType,
    config: Record<string, unknown>,
    terminal = false,
  ): GraphNodeSnapshot {
    return {
      id: key,
      key,
      type,
      label: key,
      config,
      x: 0,
      y: 0,
      order: 1,
      terminal,
      conditions: [],
      actions: [],
    };
  }

  function edge(
    key: string,
    from: string,
    to: string,
    opts: Partial<GraphEdgeSnapshot> = {},
  ): GraphEdgeSnapshot {
    return {
      id: key,
      key,
      from,
      to,
      type: opts.type ?? 'DEFAULT',
      priority: opts.priority ?? 1,
      default: opts.default ?? true,
      conditions: opts.conditions ?? [],
    };
  }

  /** `si (condición) 1 si no 0`: así se cuentan booleanos en el AST del motor. */
  const unoSi = (condicion: Record<string, unknown>) => ({
    op: 'if',
    condition: condicion,
    then: { value: 1 },
    else: { value: 0 },
  });

  const salidas = (decision: string, motivo: string) => ({
    mode: 'MAPPING',
    assignments: [
      { source: 'LITERAL', value: decision, outputCode: 'kyb_decision' },
      { source: 'LITERAL', value: motivo, outputCode: 'kyb_motivo' },
      {
        source: 'EXPRESSION',
        expression: { var: 'intermediate.requisitos_faltantes' },
        outputCode: 'kyb_requisitos_faltantes',
      },
      {
        source: 'EXPRESSION',
        expression: { var: 'intermediate.senales_operativas' },
        outputCode: 'kyb_senales_operativas',
      },
    ],
  });

  const CONDICIONES: GraphConditionSnapshot[] = [
    {
      id: 'c1',
      code: 'FALTAN_REQUISITOS',
      name: 'Faltan requisitos para operar',
      expressionType: 'JSON_AST',
      expression: {
        op: 'gt',
        left: { var: 'intermediate.requisitos_faltantes' },
        right: { value: 0 },
      },
      severity: 'BLOCKING',
      reusable: true,
    },
    {
      id: 'c2',
      code: 'HAY_SENALES',
      name: 'El expediente trae señales operativas',
      expressionType: 'JSON_AST',
      expression: {
        op: 'gt',
        left: { var: 'intermediate.senales_operativas' },
        right: { value: 0 },
      },
      severity: 'BLOCKING',
      reusable: true,
    },
  ];

  /**
   * La evidencia que el analista ve al abrir el caso. Va con plantillas porque el motor las
   * renderiza contra las variables de la ejecución: sin ellas el caso llega vacío y quien lo
   * atiende tiene que ir a buscar el expediente a Atlas para saber por qué está ahí.
   */
  const EVIDENCIA = {
    motivo: 'KYB_SENALES_OPERATIVAS',
    requisitosFaltantes: '{{intermediate.requisitos_faltantes}}',
    senalesOperativas: '{{intermediate.senales_operativas}}',
    correoVerificado: '{{kyb_correo_verificado}}',
    sucursalesDeclaradas: '{{kyb_sucursales}}',
    antiguedadDias: '{{kyb_antiguedad_dias}}',
  };

  function compilar(revisarEsManual: boolean): CompiledDecisionArtifact {
    const nodes: GraphNodeSnapshot[] = [
      node('START', 'START', {}),
      node('CONTAR_REQUISITOS', 'EXPRESSION', {
        intermediateAssignments: [
          {
            code: 'requisitos_faltantes',
            source: 'EXPRESSION',
            expression: {
              op: 'add',
              args: REQUISITOS.map((code) => unoSi({ op: 'not', arg: { var: code } })),
            },
          },
        ],
      }),
      node('MEDIR_SENALES', 'EXPRESSION', {
        intermediateAssignments: [
          {
            code: 'senales_operativas',
            source: 'EXPRESSION',
            expression: {
              op: 'add',
              args: [
                unoSi({ op: 'not', arg: { var: 'kyb_correo_verificado' } }),
                unoSi({ op: 'lt', left: { var: 'kyb_sucursales' }, right: { value: 1 } }),
                unoSi({
                  op: 'gt',
                  left: { var: 'kyb_antiguedad_dias' },
                  right: { value: DIAS_PARA_CONSIDERAR_ANTIGUO },
                }),
              ],
            },
          },
        ],
      }),
      node('EVALUAR', 'CONDITION', {}),
      node('RECHAZAR', 'RESULT', salidas('RECHAZADO', 'KYB_REQUISITOS_INCOMPLETOS'), true),
      node(
        'REVISAR',
        revisarEsManual ? 'MANUAL_REVIEW' : 'RESULT',
        {
          ...salidas('REVISION_MANUAL', 'KYB_SENALES_OPERATIVAS'),
          ...(revisarEsManual
            ? { queueCode: 'MERCHANT_KYB', priority: 80, slaMinutes: 240, evidence: EVIDENCIA }
            : {}),
        },
        true,
      ),
      node('APROBAR', 'RESULT', salidas('APROBADO', 'KYB_COMPLETO'), true),
    ];
    const edges: GraphEdgeSnapshot[] = [
      edge('E_START', 'START', 'CONTAR_REQUISITOS'),
      edge('E_REQUISITOS', 'CONTAR_REQUISITOS', 'MEDIR_SENALES'),
      edge('E_SENALES', 'MEDIR_SENALES', 'EVALUAR'),
      edge('E_INCOMPLETO', 'EVALUAR', 'RECHAZAR', {
        type: 'CONDITIONAL',
        priority: 1,
        default: false,
        conditions: [{ code: 'FALTAN_REQUISITOS', order: 1 }],
      }),
      edge('E_REVISION', 'EVALUAR', 'REVISAR', {
        type: 'CONDITIONAL',
        priority: 2,
        default: false,
        conditions: [{ code: 'HAY_SENALES', order: 1 }],
      }),
      edge('E_APROBACION', 'EVALUAR', 'APROBAR', { priority: 3 }),
    ];

    const base = compiledFixture();
    return {
      ...base,
      startNodeKey: 'START',
      variables: [
        ...REQUISITOS.map((code) => entrada(code, 'BOOLEAN')),
        entrada('kyb_correo_verificado', 'BOOLEAN'),
        entrada('kyb_sucursales', 'INTEGER'),
        entrada('kyb_antiguedad_dias', 'INTEGER'),
        // El motor rechaza escribir una salida que el contrato no declara (`UNDECLARED_OUTPUT`):
        // el desenlace principal va primero porque es el que responde «qué decidió».
        variable('kyb_decision', 'STRING', 'OUTPUT_PRIMARY'),
        variable('kyb_motivo', 'STRING', 'OUTPUT'),
        variable('kyb_requisitos_faltantes', 'INTEGER', 'OUTPUT'),
        variable('kyb_senales_operativas', 'INTEGER', 'OUTPUT'),
      ],
      intermediates: [
        intermedia('requisitos_faltantes', 'CONTAR_REQUISITOS'),
        intermedia('senales_operativas', 'MEDIR_SENALES'),
      ],
      outputContract: [],
      nodes: Object.fromEntries(nodes.map((n) => [n.key, n])),
      edgesByNode: Object.fromEntries(
        nodes.map((n) => [
          n.key,
          edges.filter((e) => e.from === n.key).sort((a, b) => a.priority - b.priority),
        ]),
      ),
      conditions: Object.fromEntries(CONDICIONES.map((c) => [c.code, c])),
      actions: {},
    };
  }

  /** Un expediente completo. Cada prueba cambia sólo lo que quiere probar. */
  const expediente = (cambios: Record<string, unknown> = {}) => ({
    kyb_tiene_matricula: true,
    kyb_representante_acreditado: true,
    kyb_qr_negocio: true,
    kyb_qr_bancario: true,
    kyb_correo_verificado: true,
    kyb_sucursales: 1,
    kyb_antiguedad_dias: 20,
    ...cambios,
  });

  it('el expediente completo y sin señales se aprueba, y no abre ningún caso', async () => {
    const resultado = await engine.execute(compilar(true), expediente());

    expect(resultado.output.kyb_decision).toBe('APROBADO');
    expect(resultado.output.kyb_motivo).toBe('KYB_COMPLETO');
    expect(resultado.manualReview).toBeUndefined();
  });

  it('con una señal operativa deriva a una persona Y ABRE el caso con su evidencia', async () => {
    const resultado = await engine.execute(
      compilar(true),
      expediente({ kyb_correo_verificado: false }),
    );

    expect(resultado.output.kyb_decision).toBe('REVISION_MANUAL');
    expect(resultado.output.kyb_senales_operativas).toBe(1);
    // Lo que faltaba: sin esto el expediente sale «a revisión» y no entra en ninguna cola.
    expect(resultado.manualReview).toEqual({
      queueCode: 'MERCHANT_KYB',
      priority: 80,
      slaMinutes: 240,
      /*
       * Los valores llegan como CADENA, no con su tipo: `renderTemplate` interpola sobre texto.
       * Se fija aquí a propósito — quien lea el caso desde otro sistema no puede comparar
       * `senalesOperativas === 1` y esperar que sea cierto.
       */
      evidence: {
        motivo: 'KYB_SENALES_OPERATIVAS',
        requisitosFaltantes: '0',
        senalesOperativas: '1',
        correoVerificado: 'false',
        sucursalesDeclaradas: '1',
        antiguedadDias: '20',
      },
    });
  });

  /*
   * La regresión que motiva todo: con `RESULT` el desenlace se llama igual y NO abre caso. Si
   * alguien vuelve a publicar el artefacto con nodos `RESULT`, esta prueba explica qué se pierde.
   */
  it('con REVISAR como RESULT el desenlace es el mismo pero NO hay caso: es el fallo que se corrige', async () => {
    const resultado = await engine.execute(
      compilar(false),
      expediente({ kyb_correo_verificado: false }),
    );

    expect(resultado.output.kyb_decision).toBe('REVISION_MANUAL');
    expect(resultado.manualReview).toBeUndefined();
  });

  it('un requisito duro que falta rechaza, por impecable que esté lo demás', async () => {
    const resultado = await engine.execute(compilar(true), expediente({ kyb_qr_bancario: false }));

    expect(resultado.output.kyb_decision).toBe('RECHAZADO');
    expect(resultado.output.kyb_motivo).toBe('KYB_REQUISITOS_INCOMPLETOS');
    expect(resultado.output.kyb_requisitos_faltantes).toBe(1);
    // Rechazar NO abre caso: no hay nada que una persona pueda decidir, falta un documento.
    expect(resultado.manualReview).toBeUndefined();
  });

  it('los requisitos duros no se compensan: faltar uno rechaza aunque además haya señales', async () => {
    const resultado = await engine.execute(
      compilar(true),
      expediente({ kyb_qr_negocio: false, kyb_correo_verificado: false, kyb_sucursales: 0 }),
    );

    expect(resultado.output.kyb_decision).toBe('RECHAZADO');
    expect(resultado.output.kyb_senales_operativas).toBe(2);
  });

  it('un expediente viejo también sale a revisión: la antigüedad es una señal, no un defecto', async () => {
    const resultado = await engine.execute(
      compilar(true),
      expediente({ kyb_antiguedad_dias: DIAS_PARA_CONSIDERAR_ANTIGUO + 1 }),
    );

    expect(resultado.output.kyb_decision).toBe('REVISION_MANUAL');
    expect(resultado.manualReview?.queueCode).toBe('MERCHANT_KYB');
  });

  it('la cola es propia y no la del crédito: los revisa otro equipo con otro criterio', async () => {
    const resultado = await engine.execute(compilar(true), expediente({ kyb_sucursales: 0 }));

    expect(resultado.manualReview?.queueCode).not.toBe('CREDIT_REVIEW');
    expect(resultado.manualReview?.queueCode).toBe('MERCHANT_KYB');
  });
});

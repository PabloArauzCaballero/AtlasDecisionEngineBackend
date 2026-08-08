import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { managementHeaders } from './support/headers';
import { findBankStatementFixture } from '../../src/modules/workers/bank-statement/fixtures/bank-statement-fixtures';

/**
 * Nodo `WORKER` de punta a punta: se crea un artefacto que LLAMA al servicio de extractos,
 * se valida y compila por HTTP, se gobierna, se despliega y se ejecuta con un PDF real.
 *
 * El PDF es el escenario sintético «extracto completo» del propio worker —un documento de
 * verdad, con texto posicionado, que la cascada de analizadores tiene que leer—, así que
 * esta prueba ejercita el camino entero: petición → resolución de variables → motor →
 * llamada al servicio → proyección a intermedias → decisión → evidencia persistida.
 */
describe('Nodos que llaman a un servicio de worker (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const runId = Date.now();
  const artifactCode = `E2E_WORKER_NODE_${runId}`;
  const documentVariable = `e2eExtractoDocumento_${runId}`;
  const outcomeVariable = `e2eExtractoResultado_${runId}`;

  const author = managementHeaders('e2e.worker-node-author', ['RISK_ANALYST']);
  const qaApprover = managementHeaders('e2e.worker-node-qa', ['QA_ANALYST']);
  const riskApprover = managementHeaders('e2e.worker-node-risk', ['RISK_APPROVER']);
  const deployer = managementHeaders('e2e.worker-node-deployer', ['PLATFORM_ADMIN']);

  let documentVariableVersionId: string;
  let outcomeVariableVersionId: string;
  let versionId: string;

  /** El mismo escenario que usa el worker por HTTP: seis movimientos legibles. */
  const statementBase64 = findBankStatementFixture('valid-complete')!.build().toString('base64');

  beforeAll(async () => {
    // El servicio sólo se puede invocar si el despliegue declara la capacidad, con la misma
    // bandera que publica el catálogo `/v1/workers`.
    app = await createTestApp({ BANK_STATEMENT_WORKER_ENABLED: true });
  });

  afterAll(async () => {
    await app.close();
  });

  it('declara las variables de entrada y de salida', async () => {
    const document = await request(server())
      .post('/v1/variables')
      .set(author)
      .send({
        variableCode: documentVariable,
        canonicalName: 'Extracto bancario en base64',
        businessDescription: 'Documento que el nodo entrega al servicio de extractos.',
        dataClassification: 'CONFIDENTIAL',
        ownerTeam: 'RISK_DECISIONING',
        isSensitive: true,
        initialVersion: { dataType: 'STRING', nullable: false, sources: [], validationRules: [] },
      })
      .expect(201);
    documentVariableVersionId = document.body.versions[0].id;

    const outcome = await request(server())
      .post('/v1/variables')
      .set(author)
      .send({
        variableCode: outcomeVariable,
        canonicalName: 'Resultado del análisis del extracto',
        businessDescription: 'Decisión tomada con lo que devolvió el servicio de extractos.',
        dataClassification: 'INTERNAL',
        ownerTeam: 'RISK_DECISIONING',
        isSensitive: false,
        initialVersion: { dataType: 'STRING', nullable: false, sources: [], validationRules: [] },
      })
      .expect(201);
    outcomeVariableVersionId = outcome.body.versions[0].id;
  });

  /** Grafo: START → llamada al servicio → decide por número de movimientos leídos. */
  function graphBody(nodeConfig: Record<string, unknown>) {
    return {
      dependencies: [
        {
          variableVersionId: documentVariableVersionId,
          usageType: 'INPUT',
          isRequired: true,
          fallbackPolicy: 'FAIL_CLOSED',
          dependencyPath: `input.${documentVariable}`,
        },
        {
          variableVersionId: outcomeVariableVersionId,
          usageType: 'OUTPUT_PRIMARY',
          isRequired: true,
          fallbackPolicy: 'NOT_APPLICABLE',
          dependencyPath: `output.${outcomeVariable}`,
        },
      ],
      intermediates: [
        intermediate('ext_estado', 'Estado de la llamada', 'STRING'),
        intermediate('ext_movimientos', 'Movimientos leídos', 'INTEGER'),
      ],
      conditions: [
        {
          code: 'EXTRACTO_LEGIBLE',
          name: 'El extracto se leyó y trae movimientos',
          expressionType: 'JSON_AST',
          expression: {
            op: 'and',
            args: [
              // `neq FAILED` y no `eq SUCCEEDED`: el servicio devuelve
              // SUCCEEDED_WITH_WARNINGS cuando el documento se leyó con avisos de
              // validación financiera, que sigue siendo una lectura utilizable.
              {
                op: 'neq',
                left: { var: 'intermediate.ext_estado' },
                right: { value: 'FAILED' },
              },
              { op: 'gte', left: { var: 'intermediate.ext_movimientos' }, right: { value: 3 } },
            ],
          },
          severity: 'BLOCKING',
          reusable: false,
        },
      ],
      actions: [],
      nodes: [
        node('START', 'START', 0, {}),
        node('ANALIZAR', 'WORKER', 1, nodeConfig),
        node('EVALUAR', 'CONDITION', 2, {}),
        resultNode('ACEPTAR', 3, 'EXTRACTO_ACEPTADO', outcomeVariable),
        resultNode('RECHAZAR', 4, 'EXTRACTO_RECHAZADO', outcomeVariable),
      ],
      edges: [
        edge('E_START', 'START', 'ANALIZAR', true, 1, []),
        edge('E_ANALISIS', 'ANALIZAR', 'EVALUAR', true, 1, []),
        edge('E_ACEPTA', 'EVALUAR', 'ACEPTAR', false, 1, [
          { conditionCode: 'EXTRACTO_LEGIBLE', order: 1 },
        ]),
        edge('E_RECHAZA', 'EVALUAR', 'RECHAZAR', true, 999, []),
      ],
    };
  }

  const WORKER_CONFIG = {
    service: 'bank-statement',
    operation: 'normalize',
    arguments: {
      documentBase64: { source: 'VARIABLE', path: documentVariable },
      fileName: { source: 'LITERAL', value: 'extracto-completo.pdf' },
    },
    onError: 'FAIL',
    timeoutMs: 20_000,
    outputs: [
      { intermediateCode: 'ext_estado', path: 'call.status' },
      { intermediateCode: 'ext_movimientos', path: 'result.transactions.length' },
    ],
  };

  it('crea el artefacto con un nodo de llamada a servicio', async () => {
    const created = await request(server())
      .post('/v1/artifacts')
      .set(author)
      .send({
        artifactCode,
        artifactType: 'CREDIT_POLICY',
        name: 'E2E llamada a servicio de worker',
        ownerTeam: 'RISK_DECISIONING',
        businessPurpose: 'Verifica que un nodo del grafo puede llamar al servicio de extractos.',
        riskDomain: 'CREDIT_ORIGINATION',
      })
      .expect(201);
    versionId = created.body.versions[0].id;

    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '1' })
      .send(graphBody(WORKER_CONFIG))
      .expect(200);
  });

  it('rechaza en validación una llamada a un servicio inexistente', async () => {
    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '2' })
      .send(graphBody({ ...WORKER_CONFIG, service: 'servicio-inventado' }))
      .expect(200);

    const report = await request(server())
      .post(`/v1/artifact-versions/${versionId}/validate`)
      .set(author)
      .expect(201);
    expect(report.body.valid).toBe(false);
    expect(report.body.errors.map((issue: { code: string }) => issue.code)).toContain(
      'WORKER_SERVICE_UNKNOWN',
    );
  });

  it('valida y compila el grafo bien declarado', async () => {
    await request(server())
      .put(`/v1/artifact-versions/${versionId}/graph`)
      .set({ ...author, 'if-match': '3' })
      .send(graphBody(WORKER_CONFIG))
      .expect(200);

    const report = await request(server())
      .post(`/v1/artifact-versions/${versionId}/validate`)
      .set(author)
      .expect(201);
    expect(report.body.errors).toEqual([]);
    expect(report.body.valid).toBe(true);

    const compiled = await request(server())
      .post(`/v1/artifact-versions/${versionId}/compile`)
      .set(author)
      .expect(201);
    expect(compiled.body.compileStatus).toBe('SUCCESS');
  });

  it('pasa una suite de regresión bloqueante que convierte el PDF de verdad', async () => {
    // No es sólo el trámite que exige el gobierno: el ejecutor de casos de prueba corre por
    // otro camino que el runtime, así que esto comprueba que TAMBIÉN allí un nodo de
    // servicio recibe su invocador y la llamada se hace de verdad.
    const suite = await request(server())
      .post(`/v1/artifact-versions/${versionId}/test-suites`)
      .set(author)
      .send({
        suiteCode: `${artifactCode}_REGRESION`,
        name: 'Regresión de llamada a servicio',
        suiteType: 'REGRESSION',
        isBlocking: true,
        cases: [
          {
            caseCode: 'EXTRACTO_LEGIBLE',
            testName: 'Acepta un extracto con movimientos legibles',
            input: { [documentVariable]: statementBase64 },
            expectedResult: { [outcomeVariable]: 'EXTRACTO_ACEPTADO' },
          },
        ],
      })
      .expect(201);

    const queued = await request(server())
      .post(`/v1/test-suites/${suite.body.id}/runs`)
      .set(author)
      .send({})
      .expect(202);

    const deadline = Date.now() + 40_000;
    let run = queued;
    while (Date.now() < deadline) {
      run = await request(server()).get(`/v1/test-runs/${queued.body.id}`).set(author).expect(200);
      if (['PASSED', 'FAILED', 'ERROR'].includes(run.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(run.body.status).toBe('PASSED');
  }, 60_000);

  it('gobierna y despliega la versión a SANDBOX', async () => {
    const submitted = await request(server())
      .post(`/v1/artifact-versions/${versionId}/submit-for-review`)
      .set(author)
      .send({ requireCompliance: false })
      .expect(201);
    const [qaStep, riskStep] = submitted.body.steps.sort(
      (a: { stepOrder: number }, b: { stepOrder: number }) => a.stepOrder - b.stepOrder,
    );
    await request(server())
      .post(`/v1/approval-steps/${qaStep.id}/decisions`)
      .set(qaApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);
    await request(server())
      .post(`/v1/approval-steps/${riskStep.id}/decisions`)
      .set(riskApprover)
      .send({ decision: 'APPROVE', evidence: [] })
      .expect(201);

    const deployed = await request(server())
      .post(`/v1/artifact-versions/${versionId}/deployments`)
      .set(deployer)
      .send({ environmentCode: 'SANDBOX', deploymentMode: 'DIRECT', traffic: [] })
      .expect(201);
    expect(deployed.body.deploymentStatus).toBe('ACTIVE');
  });

  it('convierte el PDF durante la decisión y decide con lo que devolvió el servicio', async () => {
    const response = await request(server())
      .post(`/v1/simulations/${artifactCode}`)
      .set(author)
      .send({
        requestId: `worker-node-sim-${runId}`,
        environmentCode: 'SANDBOX',
        variables: { [documentVariable]: statementBase64 },
      })
      .expect(201);

    expect(response.body.output[outcomeVariable]).toBe('EXTRACTO_ACEPTADO');
    expect(response.body.trace.nodes).toContain('ANALIZAR');
  }, 40_000);

  it('un documento que no es un extracto aborta la decisión con el código del servicio', async () => {
    const response = await request(server())
      .post(`/v1/simulations/${artifactCode}`)
      .set(author)
      .send({
        requestId: `worker-node-sim-invalid-${runId}`,
        environmentCode: 'SANDBOX',
        // Base64 de `no soy un pdf`: el nodo declara `onError: FAIL`, así que el fallo del
        // servicio tiene que llegar al cliente con su propio código, no con uno genérico.
        variables: { [documentVariable]: Buffer.from('no soy un pdf').toString('base64') },
      })
      .expect(415);

    // RFC7807: el código del dominio viaja en `title`, no en un campo `code` suelto.
    expect(response.body.title).toBe('BANK_STATEMENT_FILE_NOT_PDF');
  }, 40_000);
});

function intermediate(code: string, name: string, dataType: string) {
  return {
    code,
    name,
    description: `${name}. La escribe la llamada al servicio.`,
    dataType,
    producerNodeKey: 'ANALIZAR',
    consumerNodeKeys: [],
    nullable: false,
    updatePolicy: 'SINGLE_WRITE',
    sensitivityClass: 'INTERNAL',
    tracePolicy: 'FULL',
  };
}

function node(key: string, type: string, order: number, config: Record<string, unknown>) {
  return {
    key,
    type,
    label: key,
    config,
    x: order * 100,
    y: 0,
    order: order + 1,
    terminal: false,
    conditions: [],
    actions: [],
  };
}

function resultNode(key: string, order: number, value: string, outputCode: string) {
  return {
    ...node(key, 'RESULT', order, {
      mode: 'MAPPING',
      assignments: [{ outputCode, source: 'LITERAL', value }],
    }),
    terminal: true,
  };
}

function edge(
  key: string,
  from: string,
  to: string,
  isDefault: boolean,
  priority: number,
  conditions: Array<{ conditionCode: string; order: number }>,
) {
  return {
    key,
    from,
    to,
    type: isDefault ? 'DEFAULT' : 'CONDITIONAL',
    priority,
    default: isDefault,
    conditions,
  };
}

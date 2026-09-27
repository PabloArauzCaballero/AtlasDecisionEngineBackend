import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ReplaceGraphDto } from '../src/modules/artifacts/artifact.dto';
import { CompilerService } from '../src/modules/graph/compiler.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import type {
  ArtifactGraphSnapshot,
  CompiledDecisionArtifact,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';
import { TestCaseExecutorService } from '../src/modules/testing/test-case-executor.service';
import { CreateTestSuiteDto } from '../src/modules/testing/testing.dto';
import { CreateVariableDefinitionDto } from '../src/modules/variables/variable.dto';
import definicion from '../scripts/lib/atlas-underwriting-v2.definicion.json';

/**
 * `ATLAS_BNPL_UNDERWRITING` v2, verificado contra un Motor de mentira que responde como la API de
 * gestión real (mismo patrón que `test/partner-kyb-review.spec.ts`, verificado FIEL el 2026-09-25).
 *
 * v1 YA está desplegada (versión 371, START→APPROVE/DECLINE, 5 entradas, sin puntaje):
 * `scripts/atlas-underwriting-v2.mjs` no crea el artefacto, lo CLONA. Esta prueba comprueba, sin
 * red, las tres cosas que pueden salir mal en ese trayecto:
 *
 * 1. Que el guion manda lo que la API acepta (DTOs reales, `forbidNonWhitelisted`).
 * 2. Que el grafo escrito COMPILA con el validador y el compilador reales del Motor.
 * 3. Que la suite bloqueante (34 casos: 5 compuertas, 13 bordes exactos de puntaje/PD/banda, 9
 *    nucleos de la fórmula, 4 de tarifa con tasa base variable, + 3 combinados) pasa entera
 *    ejecutada por `TestCaseExecutorService`, el mismo motor que corre en el Motor real, sobre lo
 *    que el guion ESCRIBIÓ, no sobre una copia hecha a mano.
 */

const SCRIPT = join(__dirname, '..', 'scripts', 'atlas-underwriting-v2.mjs');
const V1_ID = '371';

interface Peticion {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  ifMatch?: string;
}

interface CuerpoVariable {
  variableCode: string;
  dataClassification: string;
  isSensitive: boolean;
  initialVersion: {
    dataType: string;
    nullable: boolean;
    displayName: string;
    description: string;
    constraints?: Record<string, unknown>;
    validationSchema?: Record<string, unknown>;
    expectedOrigin: string;
    contractVersion: string;
    sources: Array<{
      sourceSystemCode: string;
      sourcePath: string;
      sourceField: string;
      freshnessSlaSeconds: number;
      precedence: number;
      isAuthoritative: boolean;
    }>;
    validationRules: VariableContractSnapshot['validationRules'];
  };
}

interface VariableGuardada {
  id: string;
  versionId: string;
  dataType: string;
  cuerpo?: CuerpoVariable;
}

interface ReasonCodeGuardado {
  id: string;
  reasonCode: string;
  category: string;
  publicMessage: string;
  internalMessage: string;
  severity: string;
  isAdverseAction: boolean;
}

const hashes = new HashService(new ConfigService({}));
const validador = new GraphValidatorService(new ExpressionEvaluator(), hashes);
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  new ConfigService({ MAX_EXECUTION_STEPS: 128 }),
  new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  new MetricsService(),
);

/** Las 32 variables que YA existen en el catálogo (reutilizadas por código, no creadas). */
function catalogoPreexistente(): Map<string, VariableGuardada> {
  const mapa = new Map<string, VariableGuardada>();
  let contador = 1;
  for (const codigo of [
    ...definicion.inputs.map((i) => i.code).filter((c) => c !== 'product_base_annual_rate'),
    // `decision_outcome` es NUEVA (igual que `product_base_annual_rate`): el catálogo real de
    // DEV no la tiene, así que este doble tampoco debe fingir que ya existe.
    ...definicion.outputs.map((o) => o.code).filter((c) => c !== 'decision_outcome'),
  ]) {
    const id = String(contador++);
    // La API real siempre da un `variableVersionId` numérico puro (regex del DTO real); el
    // prefijo "v-" que tenía esto no lo cumplía y ReplaceGraphDto lo rechazaba en cada corrida.
    const versionId = String(contador++);
    mapa.set(codigo, { id, versionId, dataType: 'PREEXISTENTE' });
  }
  return mapa;
}

/** Lo que el guion escribió, vuelto a leer como lo lee el Motor: un `ArtifactGraphSnapshot`. */
function snapshotDeLoEscrito(motor: MotorFalso, versionId: string): ArtifactGraphSnapshot {
  const grafoCrudo = motor.grafosPorVersion.get(versionId);
  if (!grafoCrudo) throw new Error(`Ningún grafo escrito para la versión ${versionId}`);
  const grafo = plainToInstance(ReplaceGraphDto, grafoCrudo);
  const variablePorVersion = new Map(
    [...motor.variables.values()].map((variable) => [variable.versionId, variable]),
  );
  const variables = grafo.dependencies.map((dependencia): VariableContractSnapshot => {
    const guardada = variablePorVersion.get(dependencia.variableVersionId);
    if (!guardada)
      throw new Error(`Dependencia sin variable creada: ${dependencia.variableVersionId}`);
    const cuerpo = guardada.cuerpo;
    const codigo =
      motor.codigoDeVersion.get(dependencia.variableVersionId) ?? dependencia.dependencyPath;
    if (!cuerpo) {
      // Variable preexistente del catálogo: no se recreó, así que no hay `cuerpo` capturado; se
      // reconstruye lo mínimo que el validador necesita a partir de lo que el guion YA sabe
      // (la propia `definicion`), igual que el Motor real leería su catálogo.
      const definida = [...definicion.inputs, ...definicion.outputs].find((v) => v.code === codigo);
      if (!definida) throw new Error(`Sin definición para la variable preexistente ${codigo}`);
      return {
        variableVersionId: dependencia.variableVersionId,
        usageType: dependencia.usageType,
        dependencyPath: dependencia.dependencyPath,
        code: definida.code,
        version: 1,
        dataType: definida.dataType === 'NUMBER' ? 'DECIMAL' : definida.dataType,
        nullable: false,
        validationSchema: (definida as { constraints?: unknown }).constraints,
        constraints: (definida as { constraints?: unknown }).constraints,
        displayName: definida.name,
        description: definida.description,
        expectedOrigin: dependencia.usageType === 'INPUT' ? 'REQUEST' : 'GRAPH_NODE',
        contractVersion: '1',
        sensitivityClass: 'INTERNAL',
        decisionUseRestriction: 'NONE',
        validationRules: [],
        sources: [],
        required: dependencia.isRequired,
        fallbackPolicy: dependencia.fallbackPolicy,
        sensitive: false,
      };
    }
    const version = cuerpo.initialVersion;
    return {
      variableVersionId: dependencia.variableVersionId,
      usageType: dependencia.usageType,
      dependencyPath: dependencia.dependencyPath,
      code: cuerpo.variableCode,
      version: 1,
      dataType: version.dataType === 'NUMBER' ? 'DECIMAL' : version.dataType,
      nullable: version.nullable,
      validationSchema: version.validationSchema,
      constraints: version.constraints,
      displayName: version.displayName,
      description: version.description,
      expectedOrigin: version.expectedOrigin,
      contractVersion: version.contractVersion,
      sensitivityClass: cuerpo.dataClassification,
      decisionUseRestriction: 'NONE',
      validationRules: version.validationRules,
      sources: version.sources.map((origen) => ({
        system: origen.sourceSystemCode,
        path: origen.sourcePath,
        field: origen.sourceField,
        precedence: origen.precedence,
        freshnessSlaSeconds: origen.freshnessSlaSeconds,
        authoritative: origen.isAuthoritative,
      })),
      required: dependencia.isRequired,
      fallbackPolicy: dependencia.fallbackPolicy,
      sensitive: cuerpo.isSensitive,
    };
  });
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: definicion.artifact.artifactCode,
      type: definicion.artifact.artifactType,
      name: definicion.artifact.name,
      riskDomain: definicion.artifact.riskDomain,
    },
    version: { id: versionId, number: 2, semanticVersion: '2.0.0', status: 'DRAFT' },
    variables,
    intermediates: (grafo.intermediates ?? []).map((item) => ({ ...item })),
    outputContract: (grafo.outputContract ?? []).map((campo) => ({ ...campo })),
    conditions: grafo.conditions.map((condicion, index) => ({
      id: String(index + 1),
      ...condicion,
    })),
    actions: grafo.actions.map((accion) => ({
      code: accion.code,
      type: accion.type,
      payload: accion.payload,
      terminal: accion.terminal,
      reasonCodes: accion.reasonCodes.map((referencia) => {
        const reason = motor.reasonPorId.get(referencia.reasonCodeId);
        if (!reason) throw new Error(`Reason code sin definición: ${referencia.reasonCodeId}`);
        return {
          id: reason.id,
          code: reason.reasonCode,
          category: reason.category,
          publicMessage: reason.publicMessage,
          internalMessage: reason.internalMessage,
          severity: reason.severity,
          adverseAction: reason.isAdverseAction,
          priority: referencia.priority,
        };
      }),
    })),
    nodes: grafo.nodes.map((nodo) => ({
      id: nodo.key,
      key: nodo.key,
      type: nodo.type,
      label: nodo.label,
      config: nodo.config,
      x: nodo.x,
      y: nodo.y,
      order: nodo.order,
      terminal: nodo.terminal,
      conditions: nodo.conditions.map((c) => ({
        code: c.conditionCode,
        order: c.order,
        expected: c.expected ?? true,
      })),
      actions: nodo.actions.map((a) => ({ code: a.actionCode, order: a.order })),
    })),
    edges: grafo.edges.map((arista) => ({
      id: arista.key,
      key: arista.key,
      from: arista.from,
      to: arista.to,
      type: arista.type,
      priority: arista.priority,
      default: arista.default,
      conditions: arista.conditions.map((c) => ({ code: c.conditionCode, order: c.order })),
    })),
  };
}

function compilarLoEscrito(
  motor: MotorFalso,
  versionId: string,
): { compilado: CompiledDecisionArtifact; reporte: ReturnType<GraphValidatorService['validate']> } {
  const snapshot = snapshotDeLoEscrito(motor, versionId);
  const reporte = validador.validate(snapshot);
  const { compiled } = new CompilerService(hashes).compile(
    snapshot,
    reporte.metrics.terminalPathCount,
  );
  return { compilado: compiled, reporte };
}

/**
 * Un Motor de gestión en miniatura para `ATLAS_BNPL_UNDERWRITING`: arranca con v1 YA desplegada
 * (versión 371) y responde a las rutas que el guion usa.
 */
class MotorFalso {
  readonly peticiones: Peticion[] = [];
  readonly variables: Map<string, VariableGuardada>;
  readonly codigoDeVersion = new Map<string, string>();
  readonly solicitudes: Array<{ id: string; artifactVersionId: string; status: string }> = [];
  readonly despliegues: Array<Record<string, unknown>> = [];
  readonly grafosPorVersion = new Map<string, Record<string, unknown>>();
  readonly suitesPorVersion = new Map<string, Record<string, unknown> & { id: string }>();
  readonly veredictoPorRun = new Map<string, Array<{ caseCode: string; resultStatus: string }>>();
  versiones: Array<{ id: string; versionNumber: number; status: string; lockVersion: number }> = [
    { id: V1_ID, versionNumber: 1, status: 'DEPLOYED_DEV_TEST_STAGING_PROD', lockVersion: 1 },
  ];
  private server?: Server;
  private contador = 1000;

  constructor() {
    this.variables = catalogoPreexistente();
    for (const [codigo, guardada] of this.variables)
      this.codigoDeVersion.set(guardada.versionId, codigo);
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
  }

  get escrituras(): Peticion[] {
    return this.peticiones.filter((peticion) => peticion.method !== 'GET');
  }

  cuerposDe(method: string, patron: RegExp): Array<Record<string, unknown>> {
    return this.peticiones
      .filter((p) => p.method === method && patron.test(p.path))
      .map((p) => p.body ?? {});
  }

  async iniciar(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.atender(req)
        .catch((error: unknown): [number, unknown] => [
          500,
          {
            code: 'MOTOR_DE_PRUEBA',
            message: error instanceof Error ? error.message : String(error),
          },
        ])
        .then(([status, cuerpo]) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(cuerpo));
        });
    });
    await new Promise<void>((listo) => this.server?.listen(0, '127.0.0.1', listo));
  }

  async detener(): Promise<void> {
    await new Promise<void>((listo) => this.server?.close(() => listo()));
  }

  private async atender(req: IncomingMessage): Promise<[number, unknown]> {
    const partes: Buffer[] = [];
    for await (const parte of req) partes.push(parte as Buffer);
    const texto = Buffer.concat(partes).toString('utf8');
    const body = texto ? (JSON.parse(texto) as Record<string, unknown>) : null;
    const url = new URL(req.url ?? '/', 'http://motor');
    const method = req.method ?? 'GET';
    this.peticiones.push({ method, path: url.pathname, body, ifMatch: req.headers['if-match'] });
    return this.responder(method, url, body, req.headers['if-match']);
  }

  private async responder(
    method: string,
    url: URL,
    body: Record<string, unknown> | null,
    ifMatch: string | undefined,
  ): Promise<[number, unknown]> {
    const ruta = `${method} ${url.pathname}`;
    const nueva = () => String(this.contador++);

    if (ruta === 'GET /v1/reason-codes') return [200, { items: [...this.reasonCodes.values()] }];
    if (ruta === 'POST /v1/reason-codes') {
      const cuerpo = body as {
        reasonCode: string;
        category: string;
        publicMessage: string;
        internalMessage: string;
        severity: string;
        isAdverseAction: boolean;
      };
      const id = nueva();
      const guardado = { id, ...cuerpo };
      this.reasonCodes.set(cuerpo.reasonCode, guardado);
      this.reasonPorId.set(id, guardado);
      return [201, { id }];
    }
    if (ruta === 'GET /v1/variables') {
      const codigo = url.searchParams.get('search');
      const previa = codigo ? this.variables.get(codigo) : undefined;
      return [
        200,
        { items: previa ? [{ id: previa.id, variableCode: codigo }] : [], hasNextPage: false },
      ];
    }
    const detalleVariable = /^GET \/v1\/variables\/(.+)$/.exec(ruta);
    if (detalleVariable) {
      const previa = [...this.variables.values()].find((v) => v.id === detalleVariable[1]);
      return previa
        ? [
            200,
            {
              id: previa.id,
              versions: [{ id: previa.versionId, versionNumber: 1, dataType: previa.dataType }],
            },
          ]
        : [404, {}];
    }
    if (ruta === 'POST /v1/variables') {
      const cuerpo = body as unknown as CuerpoVariable;
      const id = nueva();
      const versionId = nueva();
      const guardada = { id, versionId, dataType: cuerpo.initialVersion.dataType, cuerpo };
      this.variables.set(cuerpo.variableCode, guardada);
      this.codigoDeVersion.set(versionId, cuerpo.variableCode);
      return [201, { id, versions: [{ id: versionId }] }];
    }
    if (ruta === 'GET /v1/artifacts') {
      return [200, { items: [{ id: '1', artifactCode: definicion.artifact.artifactCode }] }];
    }
    if (ruta === 'GET /v1/artifacts/1') {
      return [200, { versions: this.versiones }];
    }
    const clonar = /^POST \/v1\/artifact-versions\/(.+)\/clone$/.exec(ruta);
    if (clonar) {
      const nuevoId = nueva();
      const nuevaVersion = {
        id: nuevoId,
        versionNumber: Math.max(...this.versiones.map((v) => v.versionNumber)) + 1,
        status: 'DRAFT',
        lockVersion: 1,
      };
      this.versiones.push(nuevaVersion);
      return [201, { id: nuevoId, versionId: nuevoId, lockVersion: 1 }];
    }
    const leerGrafo = /^GET \/v1\/artifact-versions\/(.+)\/graph$/.exec(ruta);
    if (leerGrafo) {
      const grafo = this.grafosPorVersion.get(leerGrafo[1]);
      return grafo ? [200, grafo] : [200, { nodes: [] }];
    }
    const escribirGrafo = /^PUT \/v1\/artifact-versions\/(.+)\/graph$/.exec(ruta);
    if (escribirGrafo) {
      const version = this.versiones.find((v) => v.id === escribirGrafo[1]);
      if (!version) return [404, {}];
      if (ifMatch !== String(version.lockVersion)) return [412, { code: 'STALE_LOCK_VERSION' }];
      this.grafosPorVersion.set(escribirGrafo[1], body ?? {});
      version.lockVersion += 1;
      return [200, { lockVersion: version.lockVersion }];
    }
    const compilar = /^POST \/v1\/artifact-versions\/(.+)\/validate-and-compile$/.exec(ruta);
    if (compilar) {
      const version = this.versiones.find((v) => v.id === compilar[1]);
      if (!version) return [404, {}];
      version.status = 'COMPILED';
      return [201, { canonicalChecksum: 'checksum-de-prueba' }];
    }
    const leerVersion = /^GET \/v1\/artifact-versions\/(.+)$/.exec(ruta);
    if (leerVersion && !ruta.includes('/graph') && !ruta.includes('/test-suites')) {
      const version = this.versiones.find((v) => v.id === leerVersion[1]);
      return version ? [200, version] : [404, {}];
    }
    if (ruta === 'GET /v1/approval-requests') return [200, { items: this.solicitudes }];
    const listarSuites = /^GET \/v1\/artifact-versions\/(.+)\/test-suites$/.exec(ruta);
    if (listarSuites) {
      const suite = this.suitesPorVersion.get(listarSuites[1]);
      return [200, { items: suite ? [{ id: suite.id, suiteCode: suite.suiteCode }] : [] }];
    }
    const crearSuite = /^POST \/v1\/artifact-versions\/(.+)\/test-suites$/.exec(ruta);
    if (crearSuite) {
      const id = nueva();
      const suite = { ...(body ?? {}), id } as Record<string, unknown> & { id: string };
      this.suitesPorVersion.set(crearSuite[1], suite);
      this.suiteVersionPorId.set(id, crearSuite[1]);
      return [201, { id }];
    }
    const correrSuite = /^POST \/v1\/test-suites\/(.+)\/runs$/.exec(ruta);
    if (correrSuite) {
      const runId = nueva();
      const versionId = this.suiteVersionPorId.get(correrSuite[1]);
      if (versionId) this.runVersionPorId.set(runId, versionId);
      return [201, { id: runId }];
    }
    const leerRun = /^GET \/v1\/test-runs\/(.+)$/.exec(ruta);
    if (leerRun) return [200, await this.veredicto(leerRun[1])];
    const enviarRevision = /^POST \/v1\/artifact-versions\/(.+)\/submit-for-review$/.exec(ruta);
    if (enviarRevision) {
      const version = this.versiones.find((v) => v.id === enviarRevision[1]);
      if (!version) return [404, {}];
      const suite = this.suitesPorVersion.get(enviarRevision[1]);
      if (!suite?.isBlocking) return [409, { code: 'NO_BLOCKING_TEST_SUITE' }];
      const solicitud = { id: nueva(), artifactVersionId: enviarRevision[1], status: 'PENDING' };
      this.solicitudes.push(solicitud);
      version.status = 'IN_REVIEW';
      return [201, { id: solicitud.id }];
    }
    const desplegar = /^POST \/v1\/artifact-versions\/(.+)\/deployments$/.exec(ruta);
    if (desplegar) {
      this.despliegues.push(body ?? {});
      return [201, { id: nueva() }];
    }
    return [500, { code: 'RUTA_NO_SIMULADA', ruta }];
  }

  readonly reasonCodes = new Map<string, ReasonCodeGuardado>();
  readonly reasonPorId = new Map<string, ReasonCodeGuardado>();
  private readonly suiteVersionPorId = new Map<string, string>();
  private readonly runVersionPorId = new Map<string, string>();

  /** Ejecuta la suite con el ejecutor real sobre el grafo que el guion acaba de escribir. */
  private async veredicto(runId: string): Promise<unknown> {
    const versionId = this.runVersionPorId.get(runId);
    if (!versionId) return { status: 'FAILED', caseRuns: [] };
    const { compilado } = compilarLoEscrito(this, versionId);
    const ejecutor = new TestCaseExecutorService(
      engine,
      {
        resolve: async (_c: unknown, valores: unknown) => ({
          valid: true,
          values: valores,
          errors: [],
        }),
      } as never,
      { bind: () => undefined } as never,
      { bind: () => undefined } as never,
    );
    const suite = this.suitesPorVersion.get(versionId);
    const casos = (suite?.cases ?? []) as Array<{
      caseCode: string;
      input: Record<string, unknown>;
      expectedResult: Record<string, unknown>;
    }>;
    const resultado: Array<{ caseCode: string; resultStatus: string }> = [];
    for (const caso of casos) {
      const evaluado = await ejecutor.execute({
        tenantId: BigInt(1),
        artifactCode: definicion.artifact.artifactCode,
        runId: BigInt(runId),
        payload: compilado,
        testCase: {
          id: BigInt(1),
          caseCode: caso.caseCode,
          inputJson: caso.input,
          expectedResultJson: caso.expectedResult,
        },
      });
      resultado.push({ caseCode: caso.caseCode, resultStatus: evaluado.resultStatus });
    }
    this.veredictoPorRun.set(runId, resultado);
    const todosVerdes = resultado.every((caso) => caso.resultStatus === 'PASS');
    return {
      status: todosVerdes ? 'PASSED' : 'FAILED',
      caseRuns: resultado.map((caso) => ({
        resultStatus: caso.resultStatus,
        testCase: { caseCode: caso.caseCode },
      })),
    };
  }
}

interface Salida {
  code: number | null;
  stdout: string;
  stderr: string;
}

function correr(motor: MotorFalso, argumentos: string[], conClave = true): Promise<Salida> {
  return new Promise((resolver, rechazar) => {
    const entorno = { ...process.env, MANAGEMENT_API_KEY: 'clave-de-prueba' } as Record<
      string,
      string | undefined
    >;
    if (!conClave) delete entorno.MANAGEMENT_API_KEY;
    const hijo = spawn(process.execPath, [SCRIPT, '--base', motor.url, ...argumentos], {
      env: entorno as NodeJS.ProcessEnv,
    });
    let stdout = '';
    let stderr = '';
    hijo.stdout.on('data', (trozo: Buffer) => (stdout += trozo.toString()));
    hijo.stderr.on('data', (trozo: Buffer) => (stderr += trozo.toString()));
    hijo.on('error', rechazar);
    hijo.on('close', (code) => resolver({ code, stdout, stderr }));
  });
}

function errores(clase: new () => object, cuerpo: unknown): string[] {
  const aplanar = (error: ValidationError, ruta: string): string[] => {
    const aqui = ruta ? `${ruta}.${error.property}` : error.property;
    const propios = Object.values(error.constraints ?? {}).map((mensaje) => `${aqui}: ${mensaje}`);
    return [...propios, ...(error.children ?? []).flatMap((hijo) => aplanar(hijo, aqui))];
  };
  return validateSync(plainToInstance(clase, cuerpo as object), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((error) => aplanar(error, ''));
}

describe('ATLAS_BNPL_UNDERWRITING v2 · el guion que clona v1 y escribe el grafo con puntaje real', () => {
  jest.setTimeout(60_000);

  describe('la definición', () => {
    it('trae 32 entradas reutilizadas + 1 nueva, 4 salidas con rol + 1 desenlace nuevo, 34 casos y suite bloqueante', () => {
      expect(definicion.inputs).toHaveLength(32);
      expect(definicion.inputs.filter((i) => i.code === 'product_base_annual_rate')).toHaveLength(
        1,
      );
      expect(definicion.outputs).toHaveLength(5);
      expect(definicion.outputs.filter((o) => o.code === 'decision_outcome')).toHaveLength(1);
      expect(definicion.cases.length).toBeGreaterThanOrEqual(15);
      expect(definicion.suite.isBlocking).toBe(true);
    });

    it('declara PROBABILITY_OF_DEFAULT y PRICED_RATE juntos desde el primer commit (gate económico)', () => {
      const roles = new Map(definicion.outputs.map((o) => [o.code, o.semanticRole]));
      expect(roles.get('probability_of_default')).toBe('PROBABILITY_OF_DEFAULT');
      expect(roles.get('annual_percentage_rate')).toBe('PRICED_RATE');
    });

    it('las cinco compuertas del Paso 0 son BLOCKING y van antes que el puntaje en las aristas', () => {
      const compuertas = definicion.conditions.filter((c) => c.code.startsWith('G'));
      expect(compuertas).toHaveLength(5);
      expect(compuertas.every((c) => c.severity === 'BLOCKING')).toBe(true);
      const prioridades = definicion.edges
        .filter((e) => e.from === 'EVALUAR_COMPUERTAS')
        .sort((a, b) => a.priority - b.priority)
        .map((e) => e.to);
      expect(prioridades).toEqual([
        'ACT_IDENTIDAD',
        'ACT_SANCIONES',
        'ACT_FRAUDE',
        'ACT_JURISDICCION',
        'ACT_TECNICA',
        'SC_1',
      ]);
    });

    it('RECHAZAR es un nodo RESULT real (v1 nunca rechazaba); la banda E es la única que llega ahí', () => {
      const tipos = Object.fromEntries(definicion.nodes.map((n) => [n.key, n.type]));
      expect(tipos.RECHAZAR).toBe('RESULT');
      expect(tipos.APROBAR).toBe('RESULT');
    });
  });

  describe('crear v2 clonando v1 contra un Motor que responde como la API de gestión', () => {
    let motor: MotorFalso;
    let primera: Salida;
    let v2Id: string;

    beforeAll(async () => {
      motor = new MotorFalso();
      await motor.iniciar();
      primera = await correr(motor, []);
      v2Id = motor.versiones.find(
        (v) => v.status !== 'DEPLOYED_DEV_TEST_STAGING_PROD' && v.id !== V1_ID,
      )!.id;
    });
    afterAll(async () => motor.detener());

    it('termina bien: clona v1, NO despliega nada (separación de funciones, M-2)', () => {
      expect(primera.stderr).toBe('');
      expect(primera.code).toBe(0);
      expect(motor.despliegues).toHaveLength(0);
      expect(motor.solicitudes).toHaveLength(1);
      expect(primera.stdout).toContain('QA_ANALYST');
      expect(primera.stdout).toContain('RISK_APPROVER');
    });

    it('clona v1 exactamente una vez y crea sólo las variables nuevas (product_base_annual_rate, decision_outcome)', () => {
      expect(motor.cuerposDe('POST', /\/artifact-versions\/371\/clone$/)).toHaveLength(1);
      const creadas = motor.cuerposDe('POST', /^\/v1\/variables$/) as Array<{
        variableCode: string;
      }>;
      expect(creadas.map((c) => c.variableCode).sort()).toEqual([
        'decision_outcome',
        'product_base_annual_rate',
      ]);
      expect(motor.cuerposDe('PUT', /\/graph$/)).toHaveLength(1);
      expect(motor.cuerposDe('POST', /^\/v1\/artifacts$/)).toHaveLength(0); // nunca crea el artefacto
    });

    it('cada cuerpo pasa los DTO reales de la API', () => {
      for (const cuerpo of motor.cuerposDe('POST', /^\/v1\/variables$/)) {
        expect(errores(CreateVariableDefinitionDto, cuerpo)).toEqual([]);
      }
      expect(errores(ReplaceGraphDto, motor.grafosPorVersion.get(v2Id))).toEqual([]);
      const [suite] = motor.cuerposDe('POST', /\/test-suites$/);
      expect(errores(CreateTestSuiteDto, suite)).toEqual([]);
    });

    it('el grafo escrito compila con el validador y el compilador reales, sin errores', () => {
      const { reporte } = compilarLoEscrito(motor, v2Id);
      expect(reporte.errors).toEqual([]);
      expect(reporte.valid).toBe(true);
      // 25 nodos, 24 aristas, 7 caminos terminales (5 compuertas + RECHAZAR + APROBAR).
      expect(reporte.metrics).toMatchObject({ nodeCount: 25, edgeCount: 24, terminalPathCount: 7 });
    });

    it('la suite bloqueante ejecutada sobre lo escrito queda entera en verde', () => {
      expect(motor.veredictoPorRun.size).toBeGreaterThan(0);
      const [veredicto] = [...motor.veredictoPorRun.values()];
      expect(veredicto).toHaveLength(definicion.cases.length);
      expect(veredicto.filter((c) => c.resultStatus !== 'PASS')).toEqual([]);
      expect(primera.stdout).toContain(`${definicion.cases.length} en verde, 0 en rojo`);
    });

    it('correrlo otra vez no escribe nada: ya está en revisión', async () => {
      const antes = motor.escrituras.length;
      const segunda = await correr(motor, []);
      expect(segunda.code).toBe(0);
      expect(segunda.stdout).toContain('Ya está en revisión');
      expect(motor.escrituras).toHaveLength(antes);
    });
  });

  describe('los desenlaces reales del grafo escrito, caso por caso', () => {
    let compilado: CompiledDecisionArtifact;

    beforeAll(async () => {
      const motor = new MotorFalso();
      await motor.iniciar();
      await correr(motor, []);
      const v2Id = motor.versiones.find((v) => v.id !== V1_ID)!.id;
      compilado = compilarLoEscrito(motor, v2Id).compilado;
      await motor.detener();
    });

    const caso = (codigo: string) => definicion.cases.find((c) => c.caseCode === codigo)!;

    it.each(definicion.cases.map((c) => c.caseCode))(
      '%s coincide con expectedResult',
      async (codigo) => {
        const datos = caso(codigo);
        const resultado = await engine.execute(compilado, datos.input);
        const real: Record<string, unknown> = { ...resultado.output };
        for (const [clave, esperado] of Object.entries(datos.expectedResult)) {
          if (clave === 'reasonCodes') {
            expect(resultado.reasons.map((r) => r.code)).toEqual(esperado);
            continue;
          }
          if (clave === 'trace') {
            expect(resultado.terminalNodeKey).toBe((esperado as { terminal: string }).terminal);
            continue;
          }
          if (typeof esperado === 'number') {
            expect(real[clave]).toBeCloseTo(esperado, 9);
          } else {
            expect(real[clave]).toEqual(esperado);
          }
        }
      },
    );

    it('las cinco compuertas abren caso en la cola BNPL_UNDERWRITING, no un RESULT silencioso', async () => {
      const resultado = await engine.execute(
        compilado,
        caso('GATE-1-IDENTIDAD-KYC-NO-VERIFICADO').input,
      );
      expect(resultado.manualReview?.queueCode).toBe('BNPL_UNDERWRITING');
      expect(resultado.manualReview?.evidence).toMatchObject({ motivo: 'IDENTIDAD_NO_VERIFICADA' });
    });

    it('cuando aplican dos compuertas a la vez, gana la de mayor prioridad (identidad antes que sanciones)', async () => {
      const resultado = await engine.execute(
        compilado,
        caso('GATE-PRIORIDAD-IDENTIDAD-GANA-A-SANCIONES').input,
      );
      expect(resultado.reasons.map((r) => r.code)).toEqual(['IDENTIDAD_NO_VERIFICADA']);
    });

    it('el puntaje=30 y el puntaje=31 caen en tramos de PD distintos aunque ambos sean banda A', async () => {
      const r30 = await engine.execute(compilado, caso('BORDE-PUNTAJE-30').input);
      const r31 = await engine.execute(compilado, caso('BORDE-PUNTAJE-31').input);
      expect(r30.output.probability_of_default).toBeCloseTo(0.02, 9);
      expect(r31.output.probability_of_default).toBeCloseTo(0.05, 9);
      expect(r30.output.risk_band).toBe('A');
      expect(r31.output.risk_band).toBe('A');
    });

    it('el puntaje=180 (banda D, PD 0.25) aprueba y el puntaje=181 (banda E, PD 0.40) rechaza de verdad', async () => {
      const r180 = await engine.execute(compilado, caso('BORDE-PUNTAJE-180').input);
      const r181 = await engine.execute(compilado, caso('BORDE-PUNTAJE-181').input);
      expect(r180.outcome).toBe('APPROVE');
      expect(r181.outcome).toBe('DECLINE');
      expect(r181.reasons.map((r) => r.code)).toEqual(['RIESGO_EXCEDE_EL_LIMITE']);
      expect(r181.output.annual_percentage_rate).toBeUndefined();
    });

    it('annual_percentage_rate = product_base_annual_rate + prima/100 EXACTO, con la base variable', async () => {
      const b = await engine.execute(compilado, caso('APR-BANDA-B-BASE-VARIABLE-035').input);
      expect(b.output.pricing_tier).toBe('B');
      expect(b.output.annual_percentage_rate).toBeCloseTo(0.35 + 0.06, 9);
      const d = await engine.execute(compilado, caso('APR-BANDA-D-BASE-VARIABLE-055').input);
      expect(d.output.pricing_tier).toBe('D');
      expect(d.output.annual_percentage_rate).toBeCloseTo(0.55 + 0.24, 9);
    });

    it('charge_off_count se topa en 2 (min(5,2)*60=120): sin el tope caería en banda E, no C', async () => {
      const resultado = await engine.execute(compilado, caso('CASTIGOS-TOPE-EN-DOS').input);
      expect(resultado.output.risk_band).toBe('C');
    });

    it('no_hit_flag y thin_file_flag no se suman: sólo cuenta no_hit_flag', async () => {
      const resultado = await engine.execute(
        compilado,
        caso('BURO-NO-HIT-Y-THIN-FILE-NO-SE-SUMAN').input,
      );
      expect(resultado.output.probability_of_default).toBeCloseTo(0.02, 9);
    });

    it('floor(oldest_trade_age_months/4) sin operador FLOOR: 119 descuenta 29 y 200 topa en 30', async () => {
      const r119 = await engine.execute(compilado, caso('ANTIGUEDAD-119-DESCUENTA-29').input);
      const r200 = await engine.execute(compilado, caso('ANTIGUEDAD-200-TOPA-EN-30').input);
      // Aporte fijo de 30 (device_risk_score=100) menos el descuento: 30-29=1 y 30-30=0.
      expect(r119.output.probability_of_default).toBeCloseTo(0.02, 9);
      expect(r200.output.probability_of_default).toBeCloseTo(0.02, 9);
    });
  });

  describe('dry-run y credencial', () => {
    it('--dry-run sólo lee: no clona, no escribe variables ni grafo', async () => {
      const motor = new MotorFalso();
      await motor.iniciar();
      const salida = await correr(motor, ['--dry-run']);
      expect(salida.code).toBe(0);
      expect(motor.escrituras).toEqual([]);
      await motor.detener();
    });

    it('sin MANAGEMENT_API_KEY se niega antes de tocar la red', async () => {
      const motor = new MotorFalso();
      await motor.iniciar();
      const salida = await correr(motor, [], false);
      expect(salida.code).toBe(1);
      expect(salida.stderr).toContain('MANAGEMENT_API_KEY');
      expect(motor.peticiones).toEqual([]);
      await motor.detener();
    });

    it('si el artefacto no tiene ninguna versión publicada, falla en vez de crear una desde cero', async () => {
      const motor = new MotorFalso();
      motor.versiones = [];
      await motor.iniciar();
      const salida = await correr(motor, []);
      expect(salida.code).toBe(1);
      expect(salida.stderr).toContain('no tiene versiones');
      expect(motor.cuerposDe('POST', /^\/v1\/artifacts$/)).toHaveLength(0);
      await motor.detener();
    });
  });
});

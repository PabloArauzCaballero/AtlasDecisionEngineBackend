import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { CreateArtifactDto, ReplaceGraphDto } from '../src/modules/artifacts/artifact.dto';
import { DeployVersionDto } from '../src/modules/deployments/deployment.dto';
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
import definicion from '../scripts/lib/partner-kyb-review.definicion.json';

/**
 * La verificación del expediente del comercio (`PARTNER_KYB_REVIEW`), portada al repositorio.
 *
 * ## Por qué existe
 *
 * La definición base de este artefacto sólo vivía en la base del Motor de DEV: el directorio de
 * semillas se borró en `c4084c9` y un Motor nuevo no tenía de dónde sacarla. `scripts/partner-kyb-review.mjs`
 * la crea desde cero por la API de gestión, y ESTA prueba comprueba —sin red— las tres cosas que
 * pueden salir mal en ese trayecto:
 *
 * 1. **Que el guion manda lo que la API acepta.** Cada cuerpo que envía se valida con los DTO reales
 *    y con `forbidNonWhitelisted`, que es lo que hace el `ValidationPipe` global: un campo de más
 *    (o con el nombre de la LECTURA en vez del de la escritura) es un 400 en Contabo, no aquí.
 * 2. **Que el grafo resultante compila.** Con el validador y el compilador reales del Motor.
 * 3. **Que la suite bloqueante pasa** ejecutada por `TestCaseExecutorService`, el mismo que corre
 *    en el Motor, sobre lo que el guion escribió y no sobre una copia hecha a mano.
 *
 * El «Motor» de esta prueba es un servidor HTTP local que responde como la API de gestión y guarda
 * lo que recibe. No es el Motor real: lo que NO puede comprobar (permisos, separación de
 * funciones, el veredicto de la corrida asíncrona) se dice en la cabecera del guion.
 */

const SCRIPT = join(__dirname, '..', 'scripts', 'partner-kyb-review.mjs');
const VERSION_ID = '10';

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
    unitCode?: string;
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

/** Lo que el Motor de mentira guarda de una variable del catálogo. */
interface VariableGuardada {
  id: string;
  versionId: string;
  dataType: string;
  cuerpo?: CuerpoVariable;
}

const hashes = new HashService(new ConfigService({}));
const validador = new GraphValidatorService(new ExpressionEvaluator(), hashes);
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
  new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  new MetricsService(),
);

/**
 * Lo que el guion escribió, vuelto a leer como lo lee el Motor: un `ArtifactGraphSnapshot`.
 * Es la misma composición que hace `artifact-graph-reader.service.ts`, sin la base de datos.
 */
function snapshotDeLoEscrito(motor: MotorFalso): ArtifactGraphSnapshot {
  const grafo = plainToInstance(ReplaceGraphDto, motor.grafo);
  const variablePorVersion = new Map(
    [...motor.variables.values()].map((variable) => [variable.versionId, variable]),
  );
  const variables = grafo.dependencies.map((dependencia): VariableContractSnapshot => {
    const guardada = variablePorVersion.get(dependencia.variableVersionId);
    const cuerpo = guardada?.cuerpo;
    if (!cuerpo)
      throw new Error(`Dependencia sin variable creada: ${dependencia.variableVersionId}`);
    const version = cuerpo.initialVersion;
    return {
      variableVersionId: dependencia.variableVersionId,
      usageType: dependencia.usageType,
      dependencyPath: dependencia.dependencyPath,
      code: cuerpo.variableCode,
      version: 1,
      dataType: version.dataType,
      unitCode: version.unitCode ?? null,
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
    version: { id: VERSION_ID, number: 1, semanticVersion: '1.0.0', status: 'DRAFT' },
    variables,
    intermediates: (grafo.intermediates ?? []).map((item) => ({ ...item })),
    outputContract: (grafo.outputContract ?? []).map((campo) => ({ ...campo })),
    conditions: grafo.conditions.map((condicion, index) => ({
      id: String(index + 1),
      ...condicion,
    })),
    actions: [],
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
        expected: c.expected,
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

function compilarLoEscrito(motor: MotorFalso): {
  compilado: CompiledDecisionArtifact;
  reporte: ReturnType<GraphValidatorService['validate']>;
} {
  const snapshot = snapshotDeLoEscrito(motor);
  const reporte = validador.validate(snapshot);
  const { compiled } = new CompilerService(hashes).compile(
    snapshot,
    reporte.metrics.terminalPathCount,
  );
  return { compilado: compiled, reporte };
}

/**
 * Un Motor de gestión en miniatura: responde a las rutas que el guion usa y RECUERDA lo que recibe.
 *
 * La corrida de la suite no está guionada: cuando el guion pide su veredicto, se ejecutan los casos
 * con el ejecutor real sobre el grafo que el guion acaba de escribir. Si el guion escribiera un
 * grafo distinto del que prueba, la suite lo diría igual que lo diría el Motor.
 */
class MotorFalso {
  readonly peticiones: Peticion[] = [];
  readonly variables = new Map<string, VariableGuardada>();
  readonly solicitudes: Array<{ id: string; artifactVersionId: string; status: string }> = [];
  readonly despliegues: Array<Record<string, unknown>> = [];
  grafo: Record<string, unknown> | null = null;
  suite: Record<string, unknown> | null = null;
  ultimoVeredicto: Array<{ caseCode: string; resultStatus: string }> = [];
  artefacto: { versionStatus: string; lockVersion: number } | null = null;
  private server?: Server;
  private contador = 100;

  constructor(readonly ambientes: string[] = ['TEST']) {}

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
      // Si el Motor de mentira revienta se responde 500 con el motivo: colgar al cliente escondería
      // la causa detrás de un tiempo de espera agotado.
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
    this.peticiones.push({
      method,
      path: url.pathname,
      body,
      ifMatch: req.headers['if-match'],
    });
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

    if (ruta === 'GET /v1/environments') {
      return [200, this.ambientes.map((code) => ({ code }))];
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
      const guardada = {
        id: nueva(),
        versionId: nueva(),
        dataType: cuerpo.initialVersion.dataType,
        cuerpo,
      };
      this.variables.set(cuerpo.variableCode, guardada);
      return [201, { id: guardada.id, versions: [{ id: guardada.versionId }] }];
    }
    if (ruta === 'GET /v1/artifacts') {
      return [
        200,
        {
          items: this.artefacto
            ? [{ id: '1', artifactCode: definicion.artifact.artifactCode }]
            : [],
        },
      ];
    }
    if (ruta === 'POST /v1/artifacts') {
      this.artefacto = { versionStatus: 'DRAFT', lockVersion: 1 };
      return [
        201,
        {
          id: '1',
          versions: [{ id: VERSION_ID, versionNumber: 1, status: 'DRAFT', lockVersion: 1 }],
        },
      ];
    }
    if (ruta === 'GET /v1/artifacts/1' && this.artefacto) {
      const { versionStatus, lockVersion } = this.artefacto;
      return [
        200,
        { versions: [{ id: VERSION_ID, versionNumber: 1, status: versionStatus, lockVersion }] },
      ];
    }
    if (ruta === `PATCH /v1/artifact-versions/${VERSION_ID}/notes`) return [200, {}];
    if (ruta === `PUT /v1/artifact-versions/${VERSION_ID}/graph` && this.artefacto) {
      // El Motor rechaza una escritura sobre una versión que cambió desde que se leyó.
      if (ifMatch !== String(this.artefacto.lockVersion))
        return [412, { code: 'STALE_LOCK_VERSION' }];
      this.grafo = body;
      this.artefacto.lockVersion += 1;
      return [200, { lockVersion: this.artefacto.lockVersion }];
    }
    if (
      ruta === `POST /v1/artifact-versions/${VERSION_ID}/validate-and-compile` &&
      this.artefacto
    ) {
      this.artefacto.versionStatus = 'COMPILED';
      return [201, { canonicalChecksum: 'checksum-de-prueba' }];
    }
    if (ruta === 'GET /v1/approval-requests') return [200, { items: this.solicitudes }];
    if (ruta === `GET /v1/artifact-versions/${VERSION_ID}/test-suites`) {
      return [200, { items: this.suite ? [{ id: '50', suiteCode: this.suite.suiteCode }] : [] }];
    }
    if (ruta === `POST /v1/artifact-versions/${VERSION_ID}/test-suites`) {
      this.suite = body;
      return [201, { id: '50' }];
    }
    if (ruta === 'POST /v1/test-suites/50/runs') return [201, { id: '60' }];
    if (ruta === 'GET /v1/test-runs/60') return [200, await this.veredicto()];
    if (ruta === `POST /v1/artifact-versions/${VERSION_ID}/submit-for-review` && this.artefacto) {
      // El Motor exige una suite bloqueante en verde para admitir la revisión.
      if (!this.suite?.isBlocking) return [409, { code: 'NO_BLOCKING_TEST_SUITE' }];
      const solicitud = { id: nueva(), artifactVersionId: VERSION_ID, status: 'PENDING' };
      this.solicitudes.push(solicitud);
      this.artefacto.versionStatus = 'IN_REVIEW';
      return [201, { id: solicitud.id }];
    }
    const despliegue = /^POST \/v1\/artifact-versions\/(.+)\/deployments$/.exec(ruta);
    if (despliegue) {
      const codigo = String(body?.environmentCode);
      if (!this.ambientes.includes(codigo)) return [404, { code: 'ENVIRONMENT_NOT_FOUND' }];
      this.despliegues.push(body ?? {});
      return [201, { id: nueva() }];
    }
    return [500, { code: 'RUTA_NO_SIMULADA', ruta }];
  }

  /** Ejecuta la suite con el ejecutor real sobre el grafo que el guion escribió. */
  private async veredicto(): Promise<unknown> {
    const { compilado } = compilarLoEscrito(this);
    const ejecutor = new TestCaseExecutorService(
      engine,
      {
        resolve: async (_contratos: unknown, valores: unknown) => ({
          valid: true,
          values: valores,
          errors: [],
        }),
      } as never,
      { bind: () => undefined } as never,
      { bind: () => undefined } as never,
    );
    const casos = (this.suite?.cases ?? []) as Array<{
      caseCode: string;
      input: Record<string, unknown>;
      expectedResult: Record<string, unknown>;
    }>;
    this.ultimoVeredicto = [];
    for (const caso of casos) {
      const evaluado = await ejecutor.execute({
        tenantId: BigInt(1),
        artifactCode: definicion.artifact.artifactCode,
        runId: BigInt(60),
        payload: compilado,
        testCase: {
          id: BigInt(1),
          caseCode: caso.caseCode,
          inputJson: caso.input,
          expectedResultJson: caso.expectedResult,
        },
      });
      this.ultimoVeredicto.push({ caseCode: caso.caseCode, resultStatus: evaluado.resultStatus });
    }
    const todosVerdes = this.ultimoVeredicto.every((caso) => caso.resultStatus === 'PASS');
    return {
      status: todosVerdes ? 'PASSED' : 'FAILED',
      caseRuns: this.ultimoVeredicto.map((caso) => ({
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

/**
 * Los incumplimientos de un cuerpo, cada uno con su ruta y sin volcar el cuerpo entero: cuando el
 * guion se equivoca hay que ver QUÉ campo sobra o falta, no doscientas líneas del payload.
 */
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

describe('PARTNER_KYB_REVIEW · la definición portada y el guion que la crea desde cero', () => {
  jest.setTimeout(60_000);

  describe('la definición', () => {
    it('trae todo lo de la versión de origen: 11 variables, 7 nodos, 6 aristas, 2 condiciones', () => {
      expect(definicion.inputs).toHaveLength(7);
      expect(definicion.outputs).toHaveLength(4);
      expect(definicion.nodes).toHaveLength(7);
      expect(definicion.edges).toHaveLength(6);
      expect(definicion.conditions).toHaveLength(2);
      expect(definicion.intermediates).toHaveLength(2);
    });

    it('no lleva identificadores prestados: los de una base no significan nada en otra', () => {
      const claves = new Set<string>();
      const recorrer = (valor: unknown): void => {
        if (Array.isArray(valor)) valor.forEach(recorrer);
        else if (valor && typeof valor === 'object') {
          for (const [clave, hijo] of Object.entries(valor)) {
            claves.add(clave);
            recorrer(hijo);
          }
        }
      };
      recorrer(definicion);
      for (const prestada of [
        'id',
        'variableVersionId',
        'artifactId',
        'artifactVersionId',
        'tenantId',
      ]) {
        expect(claves.has(prestada)).toBe(false);
      }
    });

    /*
     * Esto fija que el guion porta la v1 tal cual era y NO adelanta la v2. Si alguien convierte
     * REVISAR en MANUAL_REVIEW aquí, la v2 (`kyb-revision-manual.mjs`) deja de tener nada que
     * corregir y quien firma ya no puede comparar contra lo que circulaba.
     */
    it('REVISAR es un nodo RESULT: es la versión base, no la corregida', () => {
      const tipos = Object.fromEntries(definicion.nodes.map((nodo) => [nodo.key, nodo.type]));
      expect(tipos.REVISAR).toBe('RESULT');
      expect(Object.values(tipos)).not.toContain('MANUAL_REVIEW');
    });

    it('la suite es bloqueante y cubre los tres desenlaces', () => {
      expect(definicion.suite.isBlocking).toBe(true);
      const decisiones = new Set(definicion.cases.map((caso) => caso.expectedResult.kyb_decision));
      expect(decisiones).toEqual(new Set(['APROBADO', 'REVISION_MANUAL', 'RECHAZADO']));
    });
  });

  describe('crear desde cero contra un Motor que responde como la API de gestión', () => {
    let motor: MotorFalso;
    let primera: Salida;

    beforeAll(async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      primera = await correr(motor, []);
    });
    afterAll(async () => motor.detener());

    it('termina bien y deja la versión en revisión, sin desplegar nada', () => {
      expect(primera.stderr).toBe('');
      expect(primera.code).toBe(0);
      expect(motor.artefacto?.versionStatus).toBe('IN_REVIEW');
      expect(motor.solicitudes).toHaveLength(1);
      // Separación de funciones: quien crea la versión no la despliega.
      expect(motor.despliegues).toHaveLength(0);
      expect(primera.stdout).toContain('QA_ANALYST');
      expect(primera.stdout).toContain('SEPARATION_OF_DUTIES_VIOLATION');
    });

    it('crea las 11 variables por código y el artefacto una sola vez', () => {
      expect(motor.cuerposDe('POST', /^\/v1\/variables$/)).toHaveLength(11);
      expect(motor.cuerposDe('POST', /^\/v1\/artifacts$/)).toHaveLength(1);
      expect(motor.cuerposDe('PUT', /\/graph$/)).toHaveLength(1);
    });

    it('cada cuerpo pasa los DTO reales de la API, campo por campo', () => {
      for (const cuerpo of motor.cuerposDe('POST', /^\/v1\/variables$/)) {
        expect(errores(CreateVariableDefinitionDto, cuerpo)).toEqual([]);
      }
      // Sin `authoringNotes`: no es un campo de alta y `forbidNonWhitelisted` lo rechazaría.
      const [alta] = motor.cuerposDe('POST', /^\/v1\/artifacts$/);
      expect(errores(CreateArtifactDto, alta)).toEqual([]);
      expect(alta).not.toHaveProperty('authoringNotes');
      expect(errores(ReplaceGraphDto, motor.grafo)).toEqual([]);
      const [suite] = motor.cuerposDe('POST', /\/test-suites$/);
      expect(errores(CreateTestSuiteDto, suite)).toEqual([]);
    });

    it('escribe el grafo con la versión que leyó (if-match) y las notas de autoría aparte', () => {
      const escritura = motor.peticiones.find((p) => p.method === 'PUT');
      expect(escritura?.ifMatch).toBe('1');
      const notas = motor.cuerposDe('PATCH', /\/notes$/);
      expect(String(notas[0]?.notes)).toContain('REVISAR es un nodo RESULT');
      // Un id de otra base en las notas engañaría a quien las lea: no debe haber ninguno.
      expect(String(notas[0]?.notes)).not.toMatch(/\b(470|529)\b/);
    });

    it('no reutiliza el formato de lectura: las salidas no se «recuperan» y los orígenes no se mienten', () => {
      const grafo = plainToInstance(ReplaceGraphDto, motor.grafo);
      const entradas = grafo.dependencies.filter((d) => d.usageType === 'INPUT');
      const salidas = grafo.dependencies.filter((d) => d.usageType !== 'INPUT');
      expect(entradas).toHaveLength(7);
      expect(entradas.every((d) => d.fallbackPolicy === 'FAIL_CLOSED' && d.isRequired)).toBe(true);
      expect(salidas.map((d) => d.usageType).sort()).toEqual(
        ['OUTPUT', 'OUTPUT', 'OUTPUT', 'OUTPUT_PRIMARY'].sort(),
      );
      expect(salidas.every((d) => d.fallbackPolicy === 'NOT_APPLICABLE')).toBe(true);
      const contrato = Object.fromEntries((grafo.outputContract ?? []).map((c) => [c.code, c]));
      expect(contrato.kyb_decision).toMatchObject({ sourceKind: 'NODE', sourceRef: 'EVALUAR' });
      expect(contrato.kyb_requisitos_faltantes).toMatchObject({
        sourceKind: 'INTERMEDIATE',
        sourceRef: 'requisitos_faltantes',
      });
      expect(contrato.kyb_senales_operativas).toMatchObject({
        sourceKind: 'INTERMEDIATE',
        sourceRef: 'senales_operativas',
      });
    });

    it('el grafo escrito compila con el validador y el compilador reales, con 3 caminos terminales', () => {
      const { reporte } = compilarLoEscrito(motor);
      expect(reporte.errors).toEqual([]);
      expect(reporte.valid).toBe(true);
      expect(reporte.metrics).toMatchObject({ nodeCount: 7, edgeCount: 6, terminalPathCount: 3 });
    });

    it('la suite bloqueante ejecutada sobre lo escrito queda entera en verde', () => {
      expect(motor.suite?.isBlocking).toBe(true);
      expect(motor.ultimoVeredicto).toHaveLength(definicion.cases.length);
      expect(motor.ultimoVeredicto.filter((caso) => caso.resultStatus !== 'PASS')).toEqual([]);
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

  describe('los desenlaces reales del grafo portado', () => {
    let compilado: CompiledDecisionArtifact;

    beforeAll(async () => {
      const motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      await correr(motor, []);
      await motor.detener();
      compilado = compilarLoEscrito(motor).compilado;
    });

    const caso = (codigo: string) => definicion.cases.find((c) => c.caseCode === codigo)!;

    it.each([
      ['KYB-COMPLETO-APRUEBA', 'APROBAR'],
      ['KYB-SIN-QR-BANCARIO-RECHAZA', 'RECHAZAR'],
      ['KYB-DUROS-NO-COMPENSAN', 'RECHAZAR'],
      ['KYB-CORREO-SIN-PROBAR-REVISA', 'REVISAR'],
      ['KYB-SIN-SUCURSALES-REVISA', 'REVISAR'],
      ['KYB-EXPEDIENTE-VIEJO-REVISA', 'REVISAR'],
      ['KYB-ANTIGUEDAD-120-APRUEBA', 'APROBAR'],
      ['KYB-TRES-SENALES-REVISA', 'REVISAR'],
      ['KYB-CUATRO-REQUISITOS-RECHAZA', 'RECHAZAR'],
    ])('%s termina en %s', async (codigo, terminal) => {
      const resultado = await engine.execute(compilado, caso(codigo).input);
      expect(resultado.terminalNodeKey).toBe(terminal);
    });

    /*
     * El caso que el guion de v2 afirmaba como MANUAL_REVIEW. En esta versión REVISAR es RESULT, y
     * un RESULT deja como `outcome` el valor de la salida principal: el desenlace se LLAMA
     * REVISION_MANUAL pero no hay caso en ninguna cola. Cuando se apruebe la v2 (REVISAR →
     * MANUAL_REVIEW, cola MERCHANT_KYB) este caso pasa a exigir `outcome: MANUAL_REVIEW` y el caso.
     */
    it('el correo sin verificar sale «a revisión» pero NO abre caso: es el defecto que corrige la v2', async () => {
      const resultado = await engine.execute(compilado, caso('KYB-CORREO-SIN-PROBAR-REVISA').input);
      expect(resultado.outcome).toBe('REVISION_MANUAL');
      expect(resultado.outcome).not.toBe('MANUAL_REVIEW');
      expect(resultado.manualReview).toBeUndefined();
    });

    it('el umbral de antigüedad es el del grafo: 120 días no es señal y 121 sí', async () => {
      const limite = await engine.execute(compilado, caso('KYB-ANTIGUEDAD-120-APRUEBA').input);
      expect(limite.output.kyb_senales_operativas).toBe(0);
      const pasado = await engine.execute(compilado, caso('KYB-EXPEDIENTE-VIEJO-REVISA').input);
      expect(pasado.output.kyb_senales_operativas).toBe(1);
    });
  });

  describe('dry-run, ambientes y reanudación', () => {
    let motor: MotorFalso;

    afterEach(async () => motor.detener());

    it('--dry-run sólo lee: no crea variables, artefacto ni nada', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      const salida = await correr(motor, ['--dry-run']);
      expect(salida.code).toBe(0);
      expect(motor.escrituras).toEqual([]);
      expect(salida.stdout).toContain('[dry-run] crearía el artefacto PARTNER_KYB_REVIEW');
    });

    it('sin MANAGEMENT_API_KEY se niega antes de tocar la red', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      const salida = await correr(motor, [], false);
      expect(salida.code).toBe(1);
      expect(salida.stderr).toContain('MANAGEMENT_API_KEY');
      expect(motor.peticiones).toEqual([]);
    });

    it('reutiliza una variable que ya existe con el mismo tipo y no la vuelve a crear', async () => {
      // La variable previa sale de una corrida real: así trae el cuerpo con el que se creó y el
      // Motor de mentira puede seguir armando el grafo con ella.
      const origen = new MotorFalso(['TEST']);
      await origen.iniciar();
      await correr(origen, ['--dry-run']);
      const primera = await correr(origen, []);
      await origen.detener();
      expect(primera.code).toBe(0);

      motor = new MotorFalso(['TEST']);
      motor.variables.set('kyb_sucursales', origen.variables.get('kyb_sucursales')!);
      await motor.iniciar();
      const salida = await correr(motor, []);
      expect(salida.code).toBe(0);
      expect(motor.cuerposDe('POST', /^\/v1\/variables$/)).toHaveLength(10);
    });

    it('una variable con el mismo código y otro tipo aborta sin crear el artefacto', async () => {
      motor = new MotorFalso(['TEST']);
      motor.variables.set('kyb_sucursales', { id: '7', versionId: '8', dataType: 'STRING' });
      await motor.iniciar();
      const salida = await correr(motor, []);
      expect(salida.code).toBe(1);
      expect(salida.stderr).toContain('kyb_sucursales');
      expect(motor.cuerposDe('POST', /^\/v1\/artifacts$/)).toHaveLength(0);
    });

    it('despliega en TEST por defecto y con el cuerpo que la API acepta', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      const salida = await correr(motor, ['--deploy', VERSION_ID]);
      expect(salida.code).toBe(0);
      expect(motor.despliegues).toEqual([
        { environmentCode: 'TEST', deploymentMode: 'DIRECT', traffic: [] },
      ]);
      expect(errores(DeployVersionDto, motor.despliegues[0])).toEqual([]);
    });

    it('en el Motor de Contabo (sólo STAGING) avisa y no despliega a medias', async () => {
      motor = new MotorFalso(['STAGING']);
      await motor.iniciar();
      const fallido = await correr(motor, ['--deploy', VERSION_ID]);
      expect(fallido.code).toBe(1);
      expect(fallido.stderr).toContain('STAGING');
      expect(motor.despliegues).toHaveLength(0);

      // Con una lista donde el primero existe y el segundo no, tampoco se despliega el primero.
      const mitad = await correr(motor, ['--deploy', VERSION_ID, '--environments', 'STAGING,TEST']);
      expect(mitad.code).toBe(1);
      expect(motor.despliegues).toHaveLength(0);

      const bueno = await correr(motor, ['--deploy', VERSION_ID, '--environments', 'STAGING']);
      expect(bueno.code).toBe(0);
      expect(motor.despliegues).toEqual([
        { environmentCode: 'STAGING', deploymentMode: 'DIRECT', traffic: [] },
      ]);
    });

    it('al crear avisa de que el ambiente por defecto no existe, pero sigue: no es un error', async () => {
      motor = new MotorFalso(['STAGING']);
      await motor.iniciar();
      const salida = await correr(motor, []);
      expect(salida.code).toBe(0);
      expect(salida.stdout).toContain('AVISO');
      expect(salida.stdout).toContain('STAGING');
    });

    it('si una corrida anterior dejó la versión compilada sin solicitud, la reanuda sin reescribir el grafo', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      await correr(motor, []);
      motor.solicitudes.length = 0;
      if (motor.artefacto) motor.artefacto.versionStatus = 'COMPILED';
      const grafosAntes = motor.cuerposDe('PUT', /\/graph$/).length;

      const salida = await correr(motor, []);
      expect(salida.code).toBe(0);
      expect(motor.cuerposDe('PUT', /\/graph$/)).toHaveLength(grafosAntes);
      expect(motor.solicitudes).toHaveLength(1);
      expect(salida.stdout).toContain('Suite KYB-DESENLACES ya existe');
    });
  });
});

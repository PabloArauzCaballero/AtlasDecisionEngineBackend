import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { ReplaceGraphDto } from '../src/modules/artifacts/artifact.dto';
import type { ResolvedDeployment } from '../src/modules/deployments/deployment-resolver.service';
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
import { ExecutionWriterService } from '../src/modules/runtime/execution-writer.service';
import { manualReviewCaseCode } from '../src/modules/runtime/manual-review-case-code';
import { TestCaseExecutorService } from '../src/modules/testing/test-case-executor.service';
import { CreateTestSuiteDto } from '../src/modules/testing/testing.dto';
import definicion from '../scripts/lib/partner-kyb-review.definicion.json';

/**
 * La versión de `PARTNER_KYB_REVIEW` en la que REVISION_MANUAL ABRE caso (hallazgo A12, P-16).
 *
 * ## El defecto
 *
 * La versión desplegada tiene el nodo REVISAR como `RESULT`. Un `RESULT` publica el desenlace
 * —`kyb_decision: REVISION_MANUAL`— pero no abre nada: el caso en `decision_manual_review_case`
 * sólo lo crea un nodo `MANUAL_REVIEW`. AtlasBackend recibe `manualReview: null`, guarda
 * `manualReviewCaseCode` vacío, y el expediente del comercio queda «en revisión» sin estar en la
 * bandeja de nadie.
 *
 * ## Lo que esta prueba fija
 *
 * `scripts/kyb-revision-manual.mjs` prepara la versión corregida por la API de gestión: clona la
 * vigente, cambia SÓLO REVISAR, compila, corre la suite bloqueante y la envía a revisión. Aquí se
 * ejecuta el guion de verdad contra un Motor de gestión en miniatura que sirve la versión base
 * tal como la LEE `artifact-graph-reader.service.ts` (con sus nulos y sus nombres de lectura), y se
 * comprueba:
 *
 * 1. que lo que el guion escribe pasa los DTO reales con `forbidNonWhitelisted`;
 * 2. que el grafo resultante es la base con un único nodo distinto;
 * 3. que compila con el validador y el compilador reales y la suite bloqueante pasa con el
 *    ejecutor real;
 * 4. que REVISION_MANUAL devuelve `manualReview` en la cola `MERCHANT_KYB` y que, al persistir la
 *    ejecución, se crea el caso con el MISMO código que la respuesta anuncia a AtlasBackend;
 * 5. que el guion NUNCA aprueba ni despliega: eso lo firman dos personas desde el portal.
 */

const SCRIPT = join(__dirname, '..', 'scripts', 'kyb-revision-manual.mjs');
const BASE_ID = '470';
const NUEVA_ID = '471';

const hashes = new HashService(new ConfigService({}));
const validador = new GraphValidatorService(new ExpressionEvaluator(), hashes);
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
  new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  new MetricsService(),
);

type Definicion = typeof definicion;
type Entrada = Definicion['inputs'][number] & { constraints?: Record<string, unknown> };
type Salida = Definicion['outputs'][number];

/** Un contrato de variable como lo devuelve la lectura del grafo. */
function contrato(
  variable: Entrada | Salida,
  usageType: string,
  indice: number,
): VariableContractSnapshot {
  const esEntrada = usageType === 'INPUT';
  const restricciones = (variable as { constraints?: Record<string, unknown> }).constraints;
  return {
    variableVersionId: String(900 + indice),
    usageType: usageType as VariableContractSnapshot['usageType'],
    dependencyPath: `${esEntrada ? 'input' : 'output'}.${variable.code}`,
    code: variable.code,
    version: 1,
    dataType: variable.dataType,
    unitCode: null,
    nullable: false,
    validationSchema: restricciones ?? null,
    constraints: restricciones ?? null,
    displayName: variable.name,
    description: variable.description,
    validationMessage: null,
    exampleValid: null,
    exampleInvalid: null,
    expectedOrigin: esEntrada ? 'REQUEST' : 'DERIVED',
    contractVersion: '1',
    sensitivityClass: 'INTERNAL',
    decisionUseRestriction: 'NONE',
    validationRules: [],
    sources: [],
    required: true,
    fallbackPolicy: esEntrada ? 'FAIL_CLOSED' : 'NOT_APPLICABLE',
    sensitive: false,
  } as unknown as VariableContractSnapshot;
}

/**
 * La versión base (la desplegada, REVISAR como `RESULT`) servida con la forma exacta de
 * `GET /v1/artifact-versions/:id/graph`: ids de base, `code` en vez de `conditionCode`, `required`
 * en vez de `isRequired`, y los nulos que Prisma devuelve en las columnas vacías.
 */
function lecturaDeLaBase(): ArtifactGraphSnapshot {
  const variables = [
    ...definicion.inputs.map((v, i) => contrato(v, 'INPUT', i)),
    ...definicion.outputs.map((v, i) => contrato(v, v.usageType, definicion.inputs.length + i)),
  ];
  return {
    artifact: {
      id: '1',
      tenantId: '1',
      code: definicion.artifact.artifactCode,
      type: definicion.artifact.artifactType,
      name: definicion.artifact.name,
      riskDomain: definicion.artifact.riskDomain,
    },
    version: {
      id: BASE_ID,
      number: 1,
      semanticVersion: '1.0.0',
      status: 'DEPLOYED_TO_TEST',
      checksum: definicion.procedencia.checksumEnOrigen,
      authoringNotes: definicion.artifact.authoringNotes,
      processingPurpose: null,
      legalBasis: null,
    },
    variables,
    intermediates: definicion.intermediates.map((item, i) => ({
      id: String(300 + i),
      ...item,
      initialValue: undefined,
      constraints: null,
      nullable: false,
      updatePolicy: 'SINGLE_WRITE',
      availabilityCondition: undefined,
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    })) as unknown as ArtifactGraphSnapshot['intermediates'],
    outputContract: definicion.outputs.map((campo, i) => ({
      id: String(400 + i),
      code: campo.code,
      name: campo.name,
      description: campo.description,
      sourceKind: campo.sourceKind,
      sourceRef: campo.sourceRef,
      valueMapping: null,
      absenceReasons: [],
      reasonCodes: [],
      contractVersion: '1',
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
      semanticRole: 'NONE',
      policyMinValue: null,
      policyMaxValue: null,
    })) as unknown as ArtifactGraphSnapshot['outputContract'],
    conditions: definicion.conditions.map((condicion, i) => ({
      id: String(500 + i),
      ...condicion,
    })) as ArtifactGraphSnapshot['conditions'],
    actions: [],
    nodes: definicion.nodes.map((nodo, i) => ({
      id: String(600 + i),
      calculatedFieldCalls: [],
      key: nodo.key,
      type: nodo.type as ArtifactGraphSnapshot['nodes'][number]['type'],
      label: nodo.label,
      config: nodo.config,
      x: nodo.x,
      y: nodo.y,
      order: i,
      terminal: nodo.terminal,
      conditions: [],
      actions: [],
    })),
    edges: definicion.edges.map((arista, i) => ({
      id: String(700 + i),
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

/**
 * Lo que el guion escribió, releído como lo relee el Motor. Las variables se resuelven por el id
 * de versión contra la lectura de la base: el guion no crea variables, reutiliza las de la base.
 */
function snapshotDeLoEscrito(escrito: Record<string, unknown>): ArtifactGraphSnapshot {
  const base = lecturaDeLaBase();
  const grafo = plainToInstance(ReplaceGraphDto, escrito);
  const porVersion = new Map(base.variables.map((v) => [v.variableVersionId, v]));
  return {
    ...base,
    version: { ...base.version, id: NUEVA_ID, number: 2, status: 'DRAFT' },
    variables: grafo.dependencies.map((dependencia) => {
      const previa = porVersion.get(dependencia.variableVersionId);
      if (!previa) throw new Error(`Variable desconocida: ${dependencia.variableVersionId}`);
      return {
        ...previa,
        usageType: dependencia.usageType as VariableContractSnapshot['usageType'],
        dependencyPath: dependencia.dependencyPath,
        required: dependencia.isRequired,
        fallbackPolicy: dependencia.fallbackPolicy,
      };
    }),
    intermediates: (grafo.intermediates ?? []).map((item) => ({ ...item })),
    outputContract: (grafo.outputContract ?? []).map((campo) => ({ ...campo })),
    conditions: grafo.conditions.map((condicion, i) => ({ id: String(800 + i), ...condicion })),
    actions: [],
    nodes: grafo.nodes.map((nodo, i) => ({
      // Ids numéricos: el escritor de ejecuciones persiste cada paso con `BigInt(nodeId)`.
      id: String(1000 + i),
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
    edges: grafo.edges.map((arista, i) => ({
      id: String(1100 + i),
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

function compilar(escrito: Record<string, unknown>) {
  const snapshot = snapshotDeLoEscrito(escrito);
  const reporte = validador.validate(snapshot);
  const { compiled } = new CompilerService(hashes).compile(
    snapshot,
    reporte.metrics.terminalPathCount,
  );
  return { compilado: compiled, reporte };
}

interface Peticion {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
  ifMatch?: string;
}

interface Version {
  id: string;
  versionNumber: number;
  status: string;
  lockVersion: number;
}

/**
 * Un Motor de gestión en miniatura con la versión base desplegada. Recuerda lo que recibe y, cuando
 * el guion pide el veredicto de la suite, la ejecuta con el ejecutor REAL sobre lo que el guion
 * acaba de escribir: si escribiera un grafo distinto del que prueba, la suite lo diría.
 */
class MotorFalso {
  readonly peticiones: Peticion[] = [];
  readonly versiones: Version[] = [
    { id: BASE_ID, versionNumber: 1, status: 'DEPLOYED_TO_TEST', lockVersion: 3 },
  ];
  readonly solicitudes: Array<{ id: string; artifactVersionId: string; status: string }> = [];
  grafo: Record<string, unknown> | null = null;
  suite: Record<string, unknown> | null = null;
  veredicto: Array<{ caseCode: string; resultStatus: string }> = [];
  private server?: Server;

  get url(): string {
    return `http://127.0.0.1:${(this.server?.address() as AddressInfo).port}`;
  }

  get escrituras(): Peticion[] {
    return this.peticiones.filter((p) => p.method !== 'GET');
  }

  async iniciar(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.atender(req)
        .catch((error: unknown): [number, unknown] => [
          500,
          { code: 'MOTOR_DE_PRUEBA', message: error instanceof Error ? error.message : error },
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
    const ifMatch = req.headers['if-match'];
    this.peticiones.push({ method, path: url.pathname, body, ifMatch });
    if (req.headers['x-tenant-id'] !== '1') return [400, { code: 'TENANT_REQUIRED' }];
    return this.responder(`${method} ${url.pathname}`, body, ifMatch);
  }

  private nueva(): Version | undefined {
    return this.versiones.find((v) => v.id === NUEVA_ID);
  }

  private async responder(
    ruta: string,
    body: Record<string, unknown> | null,
    ifMatch: string | undefined,
  ): Promise<[number, unknown]> {
    const nueva = this.nueva();
    if (ruta === 'GET /v1/artifacts') {
      return [200, { items: [{ id: '1', artifactCode: definicion.artifact.artifactCode }] }];
    }
    if (ruta === 'GET /v1/artifacts/1') return [200, { versions: this.versiones }];
    if (ruta === `GET /v1/artifact-versions/${BASE_ID}/graph`) {
      // Por JSON, como por la red: los `undefined` desaparecen y los nulos se quedan.
      return [200, JSON.parse(JSON.stringify(lecturaDeLaBase()))];
    }
    if (ruta === `GET /v1/artifact-versions/${NUEVA_ID}/graph` && nueva && this.grafo) {
      return [200, JSON.parse(JSON.stringify(snapshotDeLoEscrito(this.grafo)))];
    }
    if (ruta === `POST /v1/artifact-versions/${BASE_ID}/clone`) {
      const clon = { id: NUEVA_ID, versionNumber: 2, status: 'DRAFT', lockVersion: 1 };
      this.versiones.push(clon);
      return [201, clon];
    }
    if (ruta === `PUT /v1/artifact-versions/${NUEVA_ID}/graph` && nueva) {
      if (nueva.status !== 'DRAFT') return [409, { code: 'VERSION_NOT_EDITABLE' }];
      if (ifMatch !== String(nueva.lockVersion)) return [412, { code: 'STALE_LOCK_VERSION' }];
      this.grafo = body;
      nueva.lockVersion += 1;
      return [200, { lockVersion: nueva.lockVersion }];
    }
    if (ruta === `POST /v1/artifact-versions/${NUEVA_ID}/validate-and-compile` && nueva) {
      nueva.status = 'COMPILED';
      return [201, { canonicalChecksum: 'checksum-de-prueba' }];
    }
    if (ruta === 'GET /v1/approval-requests') return [200, { items: this.solicitudes }];
    if (ruta === `GET /v1/artifact-versions/${NUEVA_ID}/test-suites`) {
      return [200, { items: this.suite ? [{ id: '50', suiteCode: this.suite.suiteCode }] : [] }];
    }
    if (ruta === `POST /v1/artifact-versions/${NUEVA_ID}/test-suites`) {
      this.suite = body;
      return [201, { id: '50' }];
    }
    if (ruta === 'POST /v1/test-suites/50/runs') return [201, { id: '60' }];
    if (ruta === 'GET /v1/test-runs/60') return [200, await this.correrSuite()];
    if (ruta === `POST /v1/artifact-versions/${NUEVA_ID}/submit-for-review` && nueva) {
      if (!this.suite?.isBlocking) return [409, { code: 'NO_BLOCKING_TEST_SUITE' }];
      const solicitud = { id: '77', artifactVersionId: NUEVA_ID, status: 'PENDING' };
      this.solicitudes.push(solicitud);
      nueva.status = 'IN_REVIEW';
      return [201, { id: solicitud.id }];
    }
    return [500, { code: 'RUTA_NO_SIMULADA', ruta }];
  }

  private async correrSuite(): Promise<unknown> {
    const { compilado } = compilar(this.grafo ?? {});
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
    this.veredicto = [];
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
      this.veredicto.push({ caseCode: caso.caseCode, resultStatus: evaluado.resultStatus });
    }
    const verde = this.veredicto.every((caso) => caso.resultStatus === 'PASS');
    return {
      status: verde ? 'PASSED' : 'FAILED',
      caseRuns: this.veredicto.map((caso) => ({
        resultStatus: caso.resultStatus,
        testCase: { caseCode: caso.caseCode },
      })),
    };
  }
}

interface Corrida {
  code: number | null;
  stdout: string;
  stderr: string;
}

function correr(motor: MotorFalso, argumentos: string[] = []): Promise<Corrida> {
  return new Promise((resolver, rechazar) => {
    const hijo = spawn(process.execPath, [SCRIPT, '--base', motor.url, ...argumentos], {
      env: { ...process.env, MANAGEMENT_API_KEY: 'clave-de-prueba' },
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

describe('PARTNER_KYB_REVIEW · la versión en la que REVISION_MANUAL abre caso (A12)', () => {
  jest.setTimeout(60_000);

  let motor: MotorFalso;
  let primera: Corrida;
  let compilado: CompiledDecisionArtifact;

  beforeAll(async () => {
    motor = new MotorFalso();
    await motor.iniciar();
    primera = await correr(motor);
    compilado = compilar(motor.grafo ?? {}).compilado;
  });
  afterAll(async () => motor.detener());

  describe('lo que el guion prepara', () => {
    it('clona la versión desplegada, la compila y la deja EN REVISIÓN, sin aprobar ni desplegar', () => {
      expect(primera.stderr).toBe('');
      expect(primera.code).toBe(0);
      expect(motor.versiones.find((v) => v.id === NUEVA_ID)?.status).toBe('IN_REVIEW');
      expect(motor.solicitudes).toEqual([
        { id: '77', artifactVersionId: NUEVA_ID, status: 'PENDING' },
      ]);
      // La base desplegada no se toca: se sigue ejecutando hasta que dos personas firmen la nueva.
      expect(motor.versiones.find((v) => v.id === BASE_ID)?.status).toBe('DEPLOYED_TO_TEST');
      expect(primera.stdout).toContain('QA_ANALYST');
      expect(primera.stdout).toContain('RISK_APPROVER');
    });

    it('no escribe nada fuera de preparar y enviar a revisión: ni aprobaciones, ni despliegues', () => {
      const permitidas = [
        `POST /v1/artifact-versions/${BASE_ID}/clone`,
        `PUT /v1/artifact-versions/${NUEVA_ID}/graph`,
        `POST /v1/artifact-versions/${NUEVA_ID}/validate-and-compile`,
        `POST /v1/artifact-versions/${NUEVA_ID}/test-suites`,
        'POST /v1/test-suites/50/runs',
        `POST /v1/artifact-versions/${NUEVA_ID}/submit-for-review`,
      ];
      const hechas = motor.escrituras.map((p) => `${p.method} ${p.path}`);
      expect(hechas.filter((ruta) => !permitidas.includes(ruta))).toEqual([]);
      expect(hechas.some((ruta) => /approv|deploy|binding/i.test(ruta))).toBe(false);
    });

    it('escribe con la versión que leyó y con cuerpos que la API acepta campo por campo', () => {
      const escritura = motor.peticiones.find((p) => p.method === 'PUT');
      expect(escritura?.ifMatch).toBe('1');
      expect(errores(ReplaceGraphDto, motor.grafo)).toEqual([]);
      expect(errores(CreateTestSuiteDto, motor.suite)).toEqual([]);
    });

    it('cambia SÓLO el nodo REVISAR: el resto del grafo es la base, byte a byte', () => {
      const escrito = plainToInstance(ReplaceGraphDto, motor.grafo);
      const base = lecturaDeLaBase();
      const porClave = new Map(escrito.nodes.map((n) => [n.key, n]));
      for (const nodo of base.nodes.filter((n) => n.key !== 'REVISAR')) {
        const suyo = porClave.get(nodo.key);
        expect({ key: suyo?.key, type: suyo?.type, config: suyo?.config }).toEqual({
          key: nodo.key,
          type: nodo.type,
          config: nodo.config,
        });
      }
      expect(escrito.nodes.map((n) => n.key)).toEqual(base.nodes.map((n) => n.key));
      expect(escrito.edges.map((e) => [e.key, e.from, e.to, e.priority])).toEqual(
        base.edges.map((e) => [e.key, e.from, e.to, e.priority]),
      );
      expect(escrito.conditions.map((c) => [c.code, c.expression])).toEqual(
        base.conditions.map((c) => [c.code, c.expression]),
      );
      expect(escrito.dependencies.map((d) => d.variableVersionId)).toEqual(
        base.variables.map((v) => v.variableVersionId),
      );
      expect(
        (escrito.outputContract ?? []).map((c) => [c.code, c.sourceKind, c.sourceRef]),
      ).toEqual(base.outputContract.map((c) => [c.code, c.sourceKind, c.sourceRef]));
    });

    it('REVISAR pasa a MANUAL_REVIEW en la cola MERCHANT_KYB y conserva sus salidas', () => {
      const revisar = plainToInstance(ReplaceGraphDto, motor.grafo).nodes.find(
        (n) => n.key === 'REVISAR',
      );
      const base = lecturaDeLaBase().nodes.find((n) => n.key === 'REVISAR');
      expect(revisar?.type).toBe('MANUAL_REVIEW');
      expect(revisar?.terminal).toBe(true);
      expect(revisar?.config).toMatchObject({
        // `mode` y `assignments` de la base: quien llama recibe `kyb_decision` igual que antes.
        mode: 'MAPPING',
        assignments: base?.config.assignments,
        queueCode: 'MERCHANT_KYB',
        priority: 80,
        slaMinutes: 240,
      });
    });

    it('compila con el validador y el compilador reales, con los mismos 3 caminos terminales', () => {
      const { reporte } = compilar(motor.grafo ?? {});
      expect(reporte.errors).toEqual([]);
      expect(reporte.valid).toBe(true);
      expect(reporte.metrics).toMatchObject({ nodeCount: 7, edgeCount: 6, terminalPathCount: 3 });
    });

    it('la suite bloqueante son los nueve casos de la base y queda entera en verde', () => {
      expect(motor.suite?.isBlocking).toBe(true);
      const casos = motor.suite?.cases as Array<{
        caseCode: string;
        expectedResult: Record<string, unknown>;
      }>;
      expect(casos.map((c) => c.caseCode)).toEqual(definicion.cases.map((c) => c.caseCode));
      // Los que acaban en revisión exigen ahora `outcome: MANUAL_REVIEW`; los demás, lo mismo que antes.
      for (const caso of casos) {
        const original = definicion.cases.find((c) => c.caseCode === caso.caseCode)!;
        if (original.expectedResult.kyb_decision === 'REVISION_MANUAL') {
          expect(caso.expectedResult).toEqual({
            ...original.expectedResult,
            outcome: 'MANUAL_REVIEW',
          });
        } else {
          expect(caso.expectedResult).toEqual(original.expectedResult);
        }
      }
      expect(motor.veredicto.filter((c) => c.resultStatus !== 'PASS')).toEqual([]);
      expect(primera.stdout).toContain(`${definicion.cases.length} en verde, 0 en rojo`);
    });

    it('correrlo otra vez no escribe nada: ya abre caso y ya está en revisión', async () => {
      const antes = motor.escrituras.length;
      const segunda = await correr(motor);
      expect(segunda.code).toBe(0);
      expect(segunda.stdout).toContain('ya abre caso en la cola MERCHANT_KYB');
      expect(segunda.stdout).toContain('Ya está en revisión');
      expect(motor.escrituras).toHaveLength(antes);
    });
  });

  describe('lo que decide la versión nueva, con el motor real', () => {
    it.each([
      ['correo sin verificar', { kyb_correo_verificado: false }],
      ['sin sucursales', { kyb_sucursales: 0 }],
      ['expediente de 121 días', { kyb_antiguedad_dias: 121 }],
    ])('REVISION_MANUAL por %s abre caso en MERCHANT_KYB', async (_motivo, cambios) => {
      const resultado = await engine.execute(compilado, expediente(cambios));
      // SUCCEEDED, no un estado de espera: AtlasBackend sólo acepta COMPLETED/SUCCESS/SUCCEEDED y
      // con cualquier otro responde 503 y deja el expediente como estaba.
      expect(resultado.status).toBe('SUCCEEDED');
      expect(resultado.terminalNodeKey).toBe('REVISAR');
      // AtlasBackend lee el desenlace de `kyb_decision`, no de `outcome`: sigue siendo el mismo.
      expect(resultado.output.kyb_decision).toBe('REVISION_MANUAL');
      expect(resultado.output.kyb_motivo).toBe('KYB_SENALES_OPERATIVAS');
      expect(resultado.outcome).toBe('MANUAL_REVIEW');
      expect(resultado.manualReview).toMatchObject({
        queueCode: 'MERCHANT_KYB',
        priority: 80,
        slaMinutes: 240,
      });
    });

    it('la evidencia del caso dice qué mirar sin volver a abrir el expediente', async () => {
      const resultado = await engine.execute(
        compilado,
        expediente({ kyb_correo_verificado: false }),
      );
      expect(resultado.manualReview?.evidence).toEqual({
        motivo: 'KYB_SENALES_OPERATIVAS',
        requisitosFaltantes: '0',
        senalesOperativas: '1',
        matricula: 'true',
        representanteAcreditado: 'true',
        qrNegocio: 'true',
        qrBancario: 'true',
        correoVerificado: 'false',
        sucursalesDeclaradas: '1',
        antiguedadDias: '20',
      });
    });

    it.each([
      ['completo y sin señales', {}, 'APROBADO'],
      ['sin QR bancario', { kyb_qr_bancario: false }, 'RECHAZADO'],
      [
        'sin QR del negocio y con señales',
        { kyb_qr_negocio: false, kyb_sucursales: 0 },
        'RECHAZADO',
      ],
    ])('%s: %s sin abrir caso, como antes', async (_nombre, cambios, decision) => {
      const resultado = await engine.execute(compilado, expediente(cambios));
      expect(resultado.output.kyb_decision).toBe(decision);
      expect(resultado.outcome).not.toBe('MANUAL_REVIEW');
      expect(resultado.manualReview).toBeUndefined();
    });
  });

  /*
   * El tramo que el hallazgo afirma roto: `manualReviewCaseCode` llegaba vacío a AtlasBackend. La
   * respuesta de `POST /v1/decisions/:code` lo publica como `manualReview.caseCode =
   * manualReviewCaseCode(execution.id)` sólo si el grafo devolvió `manualReview`, y el
   * `ExecutionWriterService` crea la fila del caso con ESE mismo código en la misma transacción.
   */
  describe('el caso y su código al persistir la ejecución', () => {
    async function persistir(cambios: Record<string, unknown>) {
      const resultado = await engine.execute(compilado, expediente(cambios));
      const creados: Array<{ modelo: string; data: Record<string, unknown> }> = [];
      const tx = new Proxy(
        {},
        {
          get: (_objetivo, modelo: string) => ({
            create: ({ data }: { data: Record<string, unknown> }) => {
              creados.push({ modelo, data });
              return Promise.resolve({ id: 88001n, decisionStatus: 'SUCCEEDED', ...data });
            },
            createMany: () => Promise.resolve({ count: 0 }),
          }),
        },
      ) as unknown as Prisma.TransactionClient;
      const writer = new ExecutionWriterService({} as PrismaService, hashes, new ConfigService({}));
      const decidedAt = new Date('2026-09-27T12:00:00Z');
      await writer.write(
        {
          tenantId: 1n,
          deployment: {
            deploymentId: 9n,
            artifactVersionId: BigInt(NUEVA_ID),
            environmentId: 3n,
            environmentCode: 'TEST',
            riskDomain: definicion.artifact.riskDomain,
          } as unknown as ResolvedDeployment,
          requestId: 'kyb-expediente-7',
          idempotencyKey: 'kyb-7-1',
          inputSnapshot: expediente(cambios),
          durationMs: 3,
          variableSnapshots: [],
          result: resultado,
          decidedAt,
        },
        tx,
      );
      return { resultado, creados, decidedAt };
    }

    it('REVISION_MANUAL crea el caso con el código que la respuesta anuncia', async () => {
      const { creados, decidedAt } = await persistir({ kyb_correo_verificado: false });
      const casos = creados.filter((c) => c.modelo === 'decisionManualReviewCase');
      expect(casos).toHaveLength(1);
      expect(casos[0].data).toMatchObject({
        executionId: 88001n,
        caseCode: manualReviewCaseCode(88001n),
        queueCode: 'MERCHANT_KYB',
        priority: 80,
        dueAt: new Date(decidedAt.getTime() + 240 * 60_000),
      });
      expect(casos[0].data.caseCode).toBe('MR-0000088001');
      const ejecucion = creados.find((c) => c.modelo === 'decisionExecution');
      expect(ejecucion?.data.businessOutcome).toBe('MANUAL_REVIEW');
      expect(ejecucion?.data.decisionStatus).toBe('SUCCEEDED');
    });

    it('APROBADO y RECHAZADO no abren caso', async () => {
      for (const cambios of [{}, { kyb_qr_bancario: false }]) {
        const { creados } = await persistir(cambios);
        expect(creados.filter((c) => c.modelo === 'decisionManualReviewCase')).toEqual([]);
      }
    });
  });
});

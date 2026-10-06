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
import definicion from '../scripts/lib/privacidad-solicitud-titular.definicion.json';

/**
 * La decisión sobre una solicitud del titular (`PRIVACIDAD_SOLICITUD_TITULAR`): corregir un dato o
 * borrar la cuenta.
 *
 * Comprueba —sin red— lo mismo que la prueba del KYB, de la que toma el arnés:
 *
 * 1. **Que el guion manda lo que la API acepta**, con los DTO reales y `forbidNonWhitelisted`.
 * 2. **Que el grafo compila** con el validador y el compilador reales.
 * 3. **Que la suite bloqueante pasa** con `TestCaseExecutorService`, sobre lo que el guion escribió.
 *
 * Y lo propio de esta política: que cada regla del plan (B1…B8, R1…R8) termina donde dice, que el
 * orden importa (un fraude con deuda va a una persona, no se rechaza), que ninguna combinación de
 * entradas acepta lo que no debe, y que nada de lo que viaja es un dato personal.
 */

const SCRIPT = join(__dirname, '..', 'scripts', 'privacidad-solicitud-titular.mjs');
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
          decisionKind: body?.decisionKind ?? 'ORIGINATION',
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

type Entrada = Record<string, unknown>;
type Caso = (typeof definicion.cases)[number];

const TERMINAL: Record<string, string> = {
  ACEPTAR: 'ACEPTAR',
  RECHAZAR: 'RECHAZAR',
  REVISION_HUMANA: 'REVISION_HUMANA',
};
const DOMICILIO = ['DIRECCION', 'ZONA', 'CIUDAD', 'REFERENCIA_DOMICILIO'];
const RECHAZOS_OBJETIVOS = ['DSR_YA_EN_CURSO', 'DSR_BORRADO_CON_DEUDA', 'DSR_USAR_AUTOSERVICIO'];

const permitidos = (codigo: string): string[] => {
  const variable = [...definicion.inputs, ...definicion.outputs].find((v) => v.code === codigo);
  return (
    (variable as { constraints?: { allowedValues?: string[] } })?.constraints?.allowedValues ?? []
  );
};

/** Generador determinista (mulberry32): la misma semilla, las mismas solicitudes en cada corrida. */
function aleatorio(semilla: number): () => number {
  let estado = semilla;
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function solicitudAlAzar(azar: () => number): Entrada {
  const si = (p = 0.5) => azar() < p;
  const de = <T>(lista: T[]) => lista[Math.floor(azar() * lista.length)];
  const tipo = de(['BORRADO', 'RECTIFICACION']);
  return {
    dsr_tipo: tipo,
    dsr_cuenta_operativa: si(0.85),
    dsr_identidad_verificada: si(0.7),
    dsr_evidencia_identidad: si(0.6),
    dsr_pin_confirmado: si(0.8),
    dsr_contacto_cambiado_7d: si(0.15),
    dsr_dispositivo_nuevo_7d: si(0.15),
    dsr_fraude_abierto: si(0.1),
    dsr_caso_abierto: si(0.15),
    dsr_solicitudes_iguales_abiertas: si(0.1) ? 1 : 0,
    dsr_saldo_pendiente: si(0.3) ? de([0.01, 25, 1200]) : 0,
    dsr_prestamos_activos: si(0.3) ? 1 : 0,
    dsr_cuotas_en_mora: si(0.1) ? 2 : 0,
    dsr_pagos_en_conciliacion: si(0.1) ? 1 : 0,
    dsr_tuvo_credito: si(0.5),
    dsr_extracto_en_revision: si(0.1),
    dsr_campo:
      tipo === 'BORRADO'
        ? 'NINGUNO'
        : de(permitidos('dsr_campo').filter((campo) => campo !== 'NINGUNO')),
    dsr_cambios_del_campo_365d: de([0, 1, 2, 3, 5]),
  };
}

describe('PRIVACIDAD_SOLICITUD_TITULAR · la política y el guion que la publica', () => {
  describe('la definición', () => {
    it('declara que no origina crédito: DATA_SUBJECT_RIGHTS, no el ORIGINATION por omisión', () => {
      expect(definicion.artifact.decisionKind).toBe('DATA_SUBJECT_RIGHTS');
    });

    it('ninguna entrada es un dato personal: sólo booleanos, números o códigos de una lista cerrada', () => {
      for (const entrada of definicion.inputs) {
        if (entrada.dataType === 'STRING') {
          expect({ code: entrada.code, permitidos: permitidos(entrada.code).length > 0 }).toEqual({
            code: entrada.code,
            permitidos: true,
          });
        } else {
          expect(['BOOLEAN', 'INTEGER', 'CURRENCY']).toContain(entrada.dataType);
        }
      }
    });

    it('la lista de datos corregibles es la de Atlas (más NINGUNO para un borrado)', () => {
      expect(permitidos('dsr_campo')).toEqual([
        'DIRECCION',
        'ZONA',
        'CIUDAD',
        'REFERENCIA_DOMICILIO',
        'OCUPACION',
        'EMPLEADOR',
        'INGRESO_DECLARADO',
        'NOMBRE',
        'APELLIDO',
        'FECHA_NACIMIENTO',
        'NUMERO_DOCUMENTO',
        'TELEFONO',
        'CORREO',
        'OTRO',
        'NINGUNO',
      ]);
    });

    it('la suite es bloqueante, tiene al menos 24 casos y usa cada motivo del catálogo', () => {
      expect(definicion.suite.isBlocking).toBe(true);
      expect(definicion.cases.length).toBeGreaterThanOrEqual(24);
      const usados = new Set(definicion.cases.map((caso) => caso.expectedResult.dsr_motivo));
      expect([...usados].sort()).toEqual([...permitidos('dsr_motivo')].sort());
    });

    it('la salida por defecto del nodo que decide es la revisión humana', () => {
      const porDefecto = definicion.edges.filter(
        (arista) => arista.from === 'DECIDIR' && arista.default,
      );
      expect(porDefecto.map((arista) => arista.to)).toEqual(['REVISION_HUMANA']);
    });

    it('no lleva identificadores de ninguna base', () => {
      expect(JSON.stringify(definicion)).not.toMatch(/"(id|versionId|variableVersionId)"\s*:/);
    });
  });

  describe('crear desde cero contra un Motor que responde como la API de gestión', () => {
    let motor: MotorFalso;
    let primera: Salida;

    beforeAll(async () => {
      motor = new MotorFalso(['STAGING']);
      await motor.iniciar();
      primera = await correr(motor, ['--environments', 'STAGING']);
    });
    afterAll(async () => motor.detener());

    it('termina bien y deja la versión en revisión, sin desplegar nada', () => {
      expect(primera.stderr).toBe('');
      expect(primera.code).toBe(0);
      expect(motor.artefacto?.versionStatus).toBe('IN_REVIEW');
      expect(motor.despliegues).toHaveLength(0);
      expect(primera.stdout).toContain('SEPARATION_OF_DUTIES_VIOLATION');
      expect(primera.stdout).toContain('SOMBRA');
      expect(primera.stdout).not.toContain('AVISO');
    });

    it('crea las 23 variables y el artefacto como DATA_SUBJECT_RIGHTS', () => {
      expect(motor.cuerposDe('POST', /^\/v1\/variables$/)).toHaveLength(
        definicion.inputs.length + definicion.outputs.length,
      );
      const altas = motor.cuerposDe('POST', /^\/v1\/artifacts$/);
      expect(altas).toHaveLength(1);
      expect(altas[0]).toMatchObject({ decisionKind: 'DATA_SUBJECT_RIGHTS' });
    });

    it('cada cuerpo pasa los DTO reales de la API, campo por campo', () => {
      for (const cuerpo of motor.cuerposDe('POST', /^\/v1\/variables$/)) {
        expect(errores(CreateVariableDefinitionDto, cuerpo)).toEqual([]);
      }
      const [alta] = motor.cuerposDe('POST', /^\/v1\/artifacts$/);
      expect(errores(CreateArtifactDto, alta)).toEqual([]);
      expect(alta).not.toHaveProperty('authoringNotes');
      expect(errores(ReplaceGraphDto, motor.grafo)).toEqual([]);
      const [suite] = motor.cuerposDe('POST', /\/test-suites$/);
      expect(errores(CreateTestSuiteDto, suite)).toEqual([]);
    });

    it('un tipo de decisión inventado no pasa el DTO', () => {
      const [alta] = motor.cuerposDe('POST', /^\/v1\/artifacts$/);
      expect(errores(CreateArtifactDto, { ...alta, decisionKind: 'PRIVACY' })).not.toEqual([]);
    });

    it('el grafo escrito compila con el validador y el compilador reales, con 3 caminos terminales', () => {
      const { reporte } = compilarLoEscrito(motor);
      expect(reporte.errors).toEqual([]);
      expect(reporte.valid).toBe(true);
      expect(reporte.metrics).toMatchObject({
        nodeCount: definicion.nodes.length,
        edgeCount: definicion.edges.length,
        terminalPathCount: 3,
      });
    });

    it('la suite bloqueante ejecutada sobre lo escrito queda entera en verde', () => {
      expect(motor.ultimoVeredicto).toHaveLength(definicion.cases.length);
      expect(motor.ultimoVeredicto.filter((caso) => caso.resultStatus !== 'PASS')).toEqual([]);
      expect(primera.stdout).toContain(`${definicion.cases.length} en verde, 0 en rojo`);
    });

    it('correrlo otra vez no escribe nada: ya está en revisión', async () => {
      const antes = motor.escrituras.length;
      const segunda = await correr(motor, ['--environments', 'STAGING']);
      expect(segunda.code).toBe(0);
      expect(segunda.stdout).toContain('Ya está en revisión');
      expect(motor.escrituras).toHaveLength(antes);
    });
  });

  describe('las reglas, ejecutadas con el motor real', () => {
    let compilado: CompiledDecisionArtifact;
    const ejecutar = async (entrada: Entrada) => engine.execute(compilado, entrada);

    beforeAll(async () => {
      const motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      await correr(motor, []);
      await motor.detener();
      compilado = compilarLoEscrito(motor).compilado;
    });

    it.each(definicion.cases.map((caso: Caso) => [caso.caseCode, caso] as const))(
      '%s',
      async (_codigo, caso) => {
        const resultado = await ejecutar(caso.input);
        expect(resultado.terminalNodeKey).toBe(TERMINAL[caso.expectedResult.dsr_decision]);
        expect(resultado.output).toMatchObject(caso.expectedResult);
      },
    );

    it('cuenta las señales de riesgo una por una', async () => {
      const base = definicion.cases.find((c) => c.caseCode === 'DSR-B8-NUNCA-OPERO-BORRA')!.input;
      const todas = await ejecutar({
        ...base,
        dsr_fraude_abierto: true,
        dsr_caso_abierto: true,
        dsr_contacto_cambiado_7d: true,
        dsr_dispositivo_nuevo_7d: true,
        dsr_pin_confirmado: false,
      });
      expect(todas.output.dsr_senales_riesgo).toBe(5);
    });

    /*
     * Las reglas de la tabla, dichas como invariantes y comprobadas sobre 600 solicitudes al azar
     * (semilla fija). Un caso de la suite prueba una fila; esto prueba que ninguna combinación de
     * filas acepta lo que no debe — que es el error caro: un borrado o una corrección indebidos.
     */
    it('ninguna combinación acepta lo que la política reserva a una persona, ni rechaza sin causa objetiva', async () => {
      const azar = aleatorio(20261004);
      const vistos = new Set<string>();
      for (let i = 0; i < 600; i += 1) {
        const entrada = solicitudAlAzar(azar);
        const { output } = await ejecutar(entrada);
        const decision = String(output.dsr_decision);
        vistos.add(decision);
        expect(['ACEPTAR', 'RECHAZAR', 'REVISION_HUMANA']).toContain(decision);

        if (decision === 'RECHAZAR') {
          expect(RECHAZOS_OBJETIVOS).toContain(output.dsr_motivo);
        }
        if (decision !== 'ACEPTAR') {
          if (decision === 'REVISION_HUMANA') expect(output.dsr_accion).toBe('NINGUNA');
          continue;
        }
        // Aceptar exige que la pidió el titular y que no hay señal de cuenta robada.
        expect(entrada).toMatchObject({
          dsr_pin_confirmado: true,
          dsr_fraude_abierto: false,
          dsr_contacto_cambiado_7d: false,
          dsr_dispositivo_nuevo_7d: false,
        });
        if (entrada.dsr_tipo === 'BORRADO') {
          expect(entrada).toMatchObject({
            dsr_caso_abierto: false,
            dsr_solicitudes_iguales_abiertas: 0,
            dsr_saldo_pendiente: 0,
            dsr_prestamos_activos: 0,
            dsr_cuotas_en_mora: 0,
            dsr_pagos_en_conciliacion: 0,
            dsr_extracto_en_revision: false,
            dsr_cuenta_operativa: true,
          });
          // Quien operó o verificó identidad no se borra entero: la ley obliga a retener.
          // ...ni quien subió evidencia de identidad aunque no la haya verificado (M-02): esa evidencia se retiene.
          const retiene =
            entrada.dsr_tuvo_credito ||
            entrada.dsr_identidad_verificada ||
            entrada.dsr_evidencia_identidad;
          expect(output.dsr_accion).toBe(retiene ? 'CERRAR_Y_ANONIMIZAR' : 'BORRAR_TODO');
        } else {
          // Una corrección tampoco se acepta sola en una cuenta no operativa ni con un reclamo abierto (M-01).
          expect(entrada).toMatchObject({ dsr_cuenta_operativa: true, dsr_caso_abierto: false });
          expect(DOMICILIO).toContain(entrada.dsr_campo);
          expect(entrada.dsr_identidad_verificada).toBe(true);
          expect(Number(entrada.dsr_cambios_del_campo_365d)).toBeLessThan(3);
          expect(output.dsr_accion).toBe('CORREGIR');
        }
      }
      // La muestra recorre los tres desenlaces: si no, el invariante no habría probado nada.
      expect([...vistos].sort()).toEqual(['ACEPTAR', 'RECHAZAR', 'REVISION_HUMANA']);
    });
  });

  describe('dry-run y tipo de decisión', () => {
    let motor: MotorFalso;

    afterEach(async () => motor.detener());

    it('--dry-run sólo lee: no crea variables, artefacto ni nada', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      const salida = await correr(motor, ['--dry-run']);
      expect(salida.code).toBe(0);
      expect(motor.escrituras).toEqual([]);
      expect(salida.stdout).toContain(
        '[dry-run] crearía el artefacto PRIVACIDAD_SOLICITUD_TITULAR',
      );
    });

    it('sin MANAGEMENT_API_KEY se niega antes de tocar la red', async () => {
      motor = new MotorFalso(['TEST']);
      await motor.iniciar();
      const salida = await correr(motor, [], false);
      expect(salida.code).toBe(1);
      expect(motor.peticiones).toEqual([]);
    });

    it('despliega en STAGING con el cuerpo que la API acepta', async () => {
      motor = new MotorFalso(['STAGING']);
      await motor.iniciar();
      const salida = await correr(motor, ['--deploy', VERSION_ID, '--environments', 'STAGING']);
      expect(salida.code).toBe(0);
      expect(motor.despliegues).toEqual([
        { environmentCode: 'STAGING', deploymentMode: 'DIRECT', traffic: [] },
      ]);
      expect(errores(DeployVersionDto, motor.despliegues[0])).toEqual([]);
    });
  });
});

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { CompilerService } from '../src/modules/graph/compiler.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import definicionJson from '../scripts/lib/extracto-capacidad-pago.definicion.json';
import type {
  ArtifactGraphSnapshot,
  CompiledDecisionArtifact,
  GraphValidationReport,
} from '../src/modules/graph/graph.types';

/**
 * Lo común a las dos pruebas de `EXTRACTO_CAPACIDAD_PAGO`: cargar lo que el guion envía y
 * convertirlo en lo que el Motor ejecuta, con las MISMAS piezas que usa el Motor.
 *
 * La cadena es la del servidor: el guion arma el cuerpo de `PUT …/graph`; el servidor lo guarda y
 * lo vuelve a leer como un snapshot (`ArtifactGraphReaderService`); `GraphValidatorService` lo
 * valida y `CompilerService` lo compila a lo que el motor de ejecución corre. Aquí se recorre
 * entera, de modo que un campo mal traducido de la forma de lectura a la de escritura falla EN
 * ESTA PRUEBA y no como un 400 del Motor con el guion ya lanzado.
 */

export interface VariableDefinicion {
  code: string;
  dataType: string;
  usageType?: 'OUTPUT' | 'OUTPUT_PRIMARY';
  name: string;
  description: string;
  unitCode?: string;
  constraints?: Record<string, unknown>;
  dataClassification: string;
  isSensitive: boolean;
  fallbackPolicy: string;
}

export interface CasoDefinicion {
  caseCode: string;
  testName: string;
  documento: string;
  cuota: number;
  expectedResult: Record<string, unknown>;
}

export interface Definicion {
  artifact: Record<string, string> & { artifactCode: string; ownerTeam: string };
  inputs: VariableDefinicion[];
  outputs: VariableDefinicion[];
  intermediates: Array<Record<string, unknown> & { code: string; producerNodeKey: string }>;
  conditions: Array<Record<string, unknown> & { code: string }>;
  actions: unknown[];
  nodes: Array<Record<string, unknown> & { key: string; type: string; terminal: boolean }>;
  edges: Array<Record<string, unknown> & { key: string; from: string; to: string }>;
  outputContract: Array<Record<string, unknown> & { code: string }>;
  suite: { suiteCode: string; name: string; suiteType: string; isBlocking: boolean };
  documentos: Record<string, Record<string, unknown>>;
  cases: CasoDefinicion[];
}

export const definicion = definicionJson as unknown as Definicion;

export interface CuerpoGrafo {
  dependencies: Array<{
    variableVersionId: string;
    usageType: string;
    dependencyPath: string;
    isRequired: boolean;
    fallbackPolicy: string;
  }>;
  conditions: Array<Record<string, unknown> & { code: string }>;
  actions: unknown[];
  nodes: Array<
    Record<string, unknown> & {
      key: string;
      type: string;
      label: string;
      config: Record<string, unknown>;
      terminal: boolean;
      order: number;
      actions: Array<{ actionCode: string; order: number }>;
    }
  >;
  edges: Array<
    Record<string, unknown> & {
      key: string;
      from: string;
      to: string;
      type: string;
      priority: number;
      default: boolean;
      conditions: Array<{ conditionCode: string; order: number }>;
    }
  >;
  intermediates: Array<Record<string, unknown> & { code: string }>;
  outputContract: Array<Record<string, unknown> & { code: string }>;
}

export interface CasoMaterializado {
  caseCode: string;
  testName: string;
  input: Record<string, unknown>;
  expectedResult: Record<string, unknown>;
}

export interface Cuerpos {
  cuerpoDeArtefacto(d: Definicion): Record<string, unknown>;
  cuerpoDeVariable(
    d: Definicion,
    variable: VariableDefinicion,
    direccion: 'input' | 'output',
  ): Record<string, unknown> & { initialVersion: Record<string, unknown> };
  cuerpoDelGrafo(d: Definicion, versiones: Map<string, string>): CuerpoGrafo;
  casosDeLaSuite(d: Definicion, opciones?: { hoy?: Date }): CasoMaterializado[];
}

/**
 * Los cuerpos de petición del guion. Es CommonJS (`.cjs`) a propósito: cargarlo con el `import()`
 * dinámico del repositorio (`importEsm`) funciona para UNA suite por proceso y la segunda falla con
 * «Test environment has been torn down»; `bank-statement-fixtures.spec.ts` ya es esa suite, y `yarn
 * test` corre todas en el mismo proceso. `createRequire` carga el módulo con el `require` real de
 * Node, sin pasar por el registro de Jest: es una función pura y no necesita dobles.
 */
export function cargarCuerpos(): Cuerpos {
  const requerir = createRequire(__filename);
  return requerir(
    join(__dirname, '..', 'scripts', 'lib', 'extracto-capacidad-pago.cuerpos.cjs'),
  ) as Cuerpos;
}

export interface ExtractoSintetico {
  base64: string;
  fileName: string;
  abonos: number;
  movimientos: number;
}

/** El generador de extractos de la suite (CommonJS por lo mismo que `cargarCuerpos`). */
export function cargarGenerador(): {
  construirExtractoSintetico(opciones: {
    hoy?: Date;
    ingresoMensual?: number;
    tipo?: 'tres-meses' | 'pocos-movimientos';
  }): ExtractoSintetico;
} {
  const requerir = createRequire(__filename);
  return requerir(join(__dirname, '..', 'scripts', 'lib', 'extracto-pdf-sintetico.cjs'));
}

/** `código → variableVersionId`, como lo dejaría `asegurarVariables()` tras crearlas. */
export function versionesSimuladas(): Map<string, string> {
  return new Map(
    [...definicion.inputs, ...definicion.outputs].map((variable, indice) => [
      variable.code,
      String(286 + indice),
    ]),
  );
}

/**
 * El grafo tal como lo devolvería `GET …/graph` DESPUÉS de que el servidor guardó el cuerpo del
 * guion. Es la traducción inversa de la escritura, y es donde se ven las asimetrías: la lectura
 * llama `required` a lo que la escritura pide `isRequired`, y `code` a lo que pide `conditionCode`.
 *
 * `sensitivityClass` de las variables es `INTERNAL` aunque el PDF sea sensible: la API de alta no
 * lo admite (sólo `isSensitive`), y el valor por defecto de la columna es INTERNAL.
 */
export function comoLoLeeLaApi(cuerpo: CuerpoGrafo): ArtifactGraphSnapshot {
  const metadatos = new Map(
    [...definicion.inputs, ...definicion.outputs].map((variable) => [variable.code, variable]),
  );
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
      id: '1',
      number: 1,
      semanticVersion: definicion.artifact.semanticVersion,
      status: 'DRAFT',
    },
    variables: cuerpo.dependencies.map((dependencia) => {
      const codigo = dependencia.dependencyPath.split('.')[1];
      const variable = metadatos.get(codigo)!;
      const esEntrada = dependencia.usageType === 'INPUT';
      return {
        variableVersionId: dependencia.variableVersionId,
        usageType: dependencia.usageType,
        dependencyPath: dependencia.dependencyPath,
        code: codigo,
        version: 1,
        dataType: variable.dataType,
        unitCode: variable.unitCode ?? null,
        nullable: false,
        validationSchema: variable.constraints ?? null,
        constraints: variable.constraints ?? null,
        displayName: variable.name,
        description: variable.description,
        expectedOrigin: esEntrada ? 'REQUEST' : 'DERIVED',
        contractVersion: '1',
        sensitivityClass: 'INTERNAL',
        decisionUseRestriction: 'NONE',
        validationRules: [],
        sources: [],
        required: dependencia.isRequired,
        fallbackPolicy: dependencia.fallbackPolicy,
        sensitive: variable.isSensitive,
      };
    }),
    intermediates: cuerpo.intermediates.map((item, indice) => ({
      id: String(indice + 1),
      ...item,
    })) as unknown as ArtifactGraphSnapshot['intermediates'],
    outputContract: cuerpo.outputContract.map((campo, indice) => ({
      id: String(indice + 1),
      ...campo,
    })) as unknown as ArtifactGraphSnapshot['outputContract'],
    conditions: cuerpo.conditions.map((condicion, indice) => ({
      id: String(indice + 1),
      ...condicion,
    })) as unknown as ArtifactGraphSnapshot['conditions'],
    actions: [],
    nodes: cuerpo.nodes.map((nodo) => ({
      id: nodo.key,
      key: nodo.key,
      type: nodo.type,
      label: nodo.label,
      config: nodo.config,
      x: nodo.x,
      y: nodo.y,
      order: nodo.order,
      terminal: nodo.terminal,
      conditions: [],
      actions: nodo.actions.map((accion) => ({ code: accion.actionCode, order: accion.order })),
      calculatedFieldCalls: [],
    })) as unknown as ArtifactGraphSnapshot['nodes'],
    edges: cuerpo.edges.map((arista) => ({
      id: arista.key,
      key: arista.key,
      from: arista.from,
      to: arista.to,
      type: arista.type,
      priority: arista.priority,
      default: arista.default,
      conditions: arista.conditions.map((condicion) => ({
        code: condicion.conditionCode,
        order: condicion.order,
      })),
    })),
  };
}

const config = new ConfigService({
  MAX_EXECUTION_STEPS: 64,
  SCRIPT_NODES_ENABLED: false,
  AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
});

export const motor = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);

export const resolvedor = new VariableResolutionService(
  config,
  new HashService(config),
  new MetricsService(),
);

export interface Compilado {
  snapshot: ArtifactGraphSnapshot;
  informe: GraphValidationReport;
  compilado: CompiledDecisionArtifact;
  cuerpo: CuerpoGrafo;
}

/** Cuerpo del guion → lectura → validación → compilación, con las piezas reales del Motor. */
export function compilarLoQueEnviaElGuion(): Compilado {
  const cuerpos = cargarCuerpos();
  const cuerpo = cuerpos.cuerpoDelGrafo(definicion, versionesSimuladas());
  const snapshot = comoLoLeeLaApi(cuerpo);
  const hashes = new HashService(config);
  const informe = new GraphValidatorService(new ExpressionEvaluator(), hashes).validate(snapshot);
  const terminales = snapshot.nodes.filter((nodo) => nodo.terminal).length;
  const { compiled } = new CompilerService(hashes).compile(snapshot, terminales);
  return { snapshot, informe, compilado: compiled, cuerpo };
}

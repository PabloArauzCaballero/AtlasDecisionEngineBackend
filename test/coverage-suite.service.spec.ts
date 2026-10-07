import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';
import {
  AUTO_SUITE_CODE,
  CoverageSuiteService,
} from '../src/modules/testing/coverage-suite.service';
import { TestCaseExecutorService } from '../src/modules/testing/test-case-executor.service';
import credito from '../scripts/lib/atlas-underwriting-v2.definicion.json';
import identidad from '../scripts/lib/identidad-carnet-movil.definicion.json';
import { compilarDefinicion } from './definicion-compilada';

/**
 * El generador de la suite de cobertura, de punta a punta: busca con el motor real, guarda, y lo
 * guardado —vuelto a ejecutar como lo hará el worker de corridas— PASA y recorre el grafo entero.
 * Es la propiedad que importa: una suite generada que luego falla al correr sería peor que ninguna.
 */
interface CasoGuardado {
  caseCode: string;
  testName: string;
  inputJson: Record<string, unknown>;
  expectedResultJson: Record<string, unknown>;
  isActive: boolean;
}

function montar(compilado: CompiledDecisionArtifact) {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 128 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
    new MetricsService(),
  );
  const executor = new TestCaseExecutorService(
    engine,
    // El contrato ya lo respeta el buscador; aquí la resolución deja pasar la entrada tal cual.
    {
      resolve: async (_contract: unknown, input: Record<string, unknown>) => ({
        valid: true,
        values: input,
        errors: [],
      }),
    } as never,
    { bind: () => undefined } as never,
    { bind: () => undefined } as never,
  );
  const estado: {
    suite: null | { id: bigint; name: string; isBlocking: boolean; suiteType: string };
    casos: CasoGuardado[];
  } = {
    suite: null,
    casos: [],
  };
  const tx = {
    decisionTestSuite: {
      findFirst: async () =>
        estado.suite
          ? { ...estado.suite, cases: estado.casos.map((c) => ({ caseCode: c.caseCode })) }
          : null,
      create: async ({
        data,
      }: {
        data: {
          name: string;
          isBlocking: boolean;
          suiteType: string;
          cases: { create: CasoGuardado[] };
        };
      }) => {
        estado.suite = {
          id: 7001n,
          name: data.name,
          isBlocking: data.isBlocking,
          suiteType: data.suiteType,
        };
        estado.casos.push(...data.cases.create);
        return estado.suite;
      },
      update: async ({ data }: { data: { name: string } }) => {
        if (estado.suite) estado.suite.name = data.name;
        return estado.suite;
      },
    },
    decisionTestCase: {
      updateMany: async () => {
        estado.casos.forEach((caso) => (caso.isActive = false));
        return { count: estado.casos.length };
      },
      createMany: async ({ data }: { data: CasoGuardado[] }) => {
        estado.casos.push(...data);
        return { count: data.length };
      },
    },
  };
  const prisma = {
    decisionCompiledArtifact: {
      findFirst: async () => ({
        compiledPayloadJson: compilado,
        artifactVersion: { artifact: { artifactCode: 'DEMO' } },
      }),
    },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const audit = { append: jest.fn() };
  const execution = { enqueueSuite: jest.fn().mockResolvedValue({ id: 8501n }) };
  const service = new CoverageSuiteService(
    prisma as never,
    audit as never,
    new ConfigService({}),
    executor,
    execution as never,
  );
  return { service, executor, estado, audit, execution };
}

const principal = {
  id: 'qa@atlas.bo',
  tenantId: 1n,
  roles: ['QA_ANALYST'],
  audience: 'management',
  requestId: 'r1',
  authMethod: 'jwt',
} as never;

describe('CoverageSuiteService · generar la suite de cobertura', () => {
  jest.setTimeout(60_000);

  it.each([
    ['crédito (puntaje calculado)', credito],
    ['identidad (nodo WORKER)', identidad],
  ])(
    '%s: lo generado pasa al ejecutarse y recorre el 100 %% de los nodos',
    async (_nombre, definicion) => {
      const compilado = compilarDefinicion(definicion);
      const { service, executor, estado, execution } = montar(compilado);

      const respuesta = await service.generate(1n, 8n, principal);

      expect(respuesta).toMatchObject({
        suiteCode: AUTO_SUITE_CODE,
        runId: '8501',
        complete: true,
        generation: 1,
      });
      expect(respuesta.nodes).toEqual({ percentage: 100, missing: [] });
      expect(estado.suite).toMatchObject({ isBlocking: true, suiteType: 'REGRESSION' });
      expect(execution.enqueueSuite).toHaveBeenCalledTimes(1);

      // Lo guardado, ejecutado como lo hará el worker de corridas.
      const recorridos = new Set<string>();
      for (const [indice, caso] of estado.casos.entries()) {
        expect(caso.caseCode).toMatch(/^[A-Z0-9_-]{2,100}$/);
        expect(Object.keys(caso.expectedResultJson).length).toBeGreaterThan(0);
        const corrido = await executor.execute({
          tenantId: 1n,
          artifactCode: 'DEMO',
          runId: 1n,
          payload: compilado,
          testCase: {
            id: BigInt(indice + 1),
            caseCode: caso.caseCode,
            inputJson: caso.inputJson,
            expectedResultJson: caso.expectedResultJson,
          },
        });
        expect({
          caso: caso.caseCode,
          estado: corrido.resultStatus,
          fallos: corrido.assertions.filter((a) => !a.passed),
        }).toEqual({
          caso: caso.caseCode,
          estado: 'PASS',
          fallos: [],
        });
        corrido.visitedNodeKeys.forEach((nodo) => recorridos.add(nodo));
      }
      expect([...recorridos].sort()).toEqual(Object.keys(compilado.nodes).sort());
    },
  );

  it('un grafo con WORKER guarda los dobles en la entrada del caso', async () => {
    const { service, estado } = montar(compilarDefinicion(identidad));

    await service.generate(1n, 5n, principal);

    expect(estado.casos.every((caso) => 'workerDoubles' in caso.inputJson)).toBe(true);
  });

  it('regenerar no duplica: desactiva la generación anterior y numera la nueva', async () => {
    const { service, estado, audit } = montar(compilarDefinicion(credito));

    const primera = await service.generate(1n, 8n, principal);
    const segunda = await service.generate(1n, 8n, principal);

    expect(segunda.generation).toBe(2);
    expect(estado.casos.filter((caso) => caso.isActive)).toHaveLength(segunda.cases);
    expect(estado.casos.filter((caso) => !caso.isActive)).toHaveLength(primera.cases);
    expect(new Set(estado.casos.map((caso) => caso.caseCode)).size).toBe(estado.casos.length);
    expect(audit.append).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ generated: true, generation: 2, nodeCoverage: 100 }),
      }),
      expect.anything(),
    );
  });

  it('sin artefacto compilado lo dice, en vez de generar contra nada', async () => {
    const { service } = montar(compilarDefinicion(credito));
    (
      service as unknown as {
        prisma: { decisionCompiledArtifact: { findFirst: () => Promise<null> } };
      }
    ).prisma.decisionCompiledArtifact.findFirst = async () => null;

    await expect(service.generate(1n, 8n, principal)).rejects.toMatchObject({
      code: 'COVERAGE_VERSION_NOT_COMPILED',
    });
  });
});

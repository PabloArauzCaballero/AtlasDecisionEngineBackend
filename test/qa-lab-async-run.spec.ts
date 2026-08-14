import { AuditService } from '../src/common/audit/audit.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { QaLabService } from '../src/modules/qa-lab/qa-lab.service';

/**
 * La corrida sobrevive a la petición que la lanzó (§10.4).
 *
 * Antes el lote se ejecutaba DENTRO del `POST`, y eso lo hacía inservible: un interceptor
 * global corta toda petición a los `REQUEST_TIMEOUT_MS` del despliegue —15 s de serie—,
 * así que doscientos casos morían siempre con `REQUEST_TIMEOUT` mientras el formulario
 * ofrecía un `timeoutMs` de hasta 600 000. Peor todavía: cortar la respuesta no cancela el
 * trabajo, así que la tanda seguía corriendo contra el motor y la fila quedaba en RUNNING
 * para siempre.
 *
 * Lo que se fija aquí es exactamente eso: que la respuesta sale ANTES de que el lote
 * termine, que la corrida se cierra sola después, y que un fallo de fondo se archiva en la
 * propia corrida en vez de perderse en el registro del servidor.
 *
 * Prisma va fingido: nada de esto necesita base de datos.
 */

const compiled = {
  runtimeSchemaVersion: '1.2',
  compilerVersion: 'test',
  artifact: {
    id: '1',
    tenantId: '1',
    code: 'DEMO',
    type: 'DECISION',
    name: 'Demo',
    riskDomain: '',
  },
  version: { id: '1', number: 1, semanticVersion: '1.0.0', status: 'COMPILED' },
  variables: [
    {
      code: 'score',
      dataType: 'INTEGER',
      usageType: 'INPUT',
      required: true,
      nullable: false,
      constraints: { min: 300, max: 900 },
    },
  ],
  intermediates: [],
  outputContract: [],
  startNodeKey: 'inicio',
  nodes: {
    inicio: {
      key: 'inicio',
      type: 'RESULT',
      label: 'Aprobado',
      config: {},
      x: 0,
      y: 0,
      order: 0,
      terminal: true,
      conditions: [],
      actions: [],
    },
  },
  edgesByNode: {},
  conditions: {},
  actions: {},
  totals: { nodes: 1, edges: 0, terminalPaths: 1 },
} as unknown as CompiledDecisionArtifact;

const principal = { id: 'qa-tester', requestId: 'req-1' } as unknown as AuthenticatedPrincipal;

/** Mezcla 100 % válida y sin casos por desenlace: aquí se mide el ciclo, no el generador. */
const dto = {
  environmentCode: 'DEV',
  caseCount: 6,
  validPercent: 100,
  boundaryPercent: 0,
  invalidPercent: 0,
  concurrency: 2,
  coverOutcomes: false,
};

type Fila = Record<string, unknown> & { id: bigint; status: string };

function build({ engineFails = false } = {}) {
  const filas = new Map<bigint, Fila>();
  let siguienteId = 1n;

  let ejecutados = 0;
  let liberar = () => {};
  const compuerta = new Promise<void>((resolve) => {
    liberar = resolve;
  });

  const prisma = {
    decisionCompiledArtifact: {
      findFirst: jest.fn(async () => ({ compiledPayloadJson: compiled })),
    },
    qaGenerationRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const fila: Fila = {
          ...data,
          id: siguienteId,
          status: String(data.status),
          totalCases: 0,
          passedCases: 0,
          failedCases: 0,
          erroredCases: 0,
          durationMs: 0,
          summaryJson: null,
          startedAt: new Date(),
          finishedAt: null,
          artifactVersionId: 4001n,
        };
        filas.set(siguienteId, fila);
        siguienteId += 1n;
        return fila;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: bigint }; data: Fila }) => {
        const fila = filas.get(where.id);
        if (!fila) throw new Error('fila inexistente');
        Object.assign(fila, data, { status: String(data.status ?? fila.status) });
        return fila;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    qaCounterexample: { create: jest.fn(async () => ({ id: 1n })) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  } as unknown as PrismaService & { qaGenerationRun: { create: jest.Mock } };

  const variables = {
    resolve: jest.fn(async (_contract: unknown, input: Record<string, unknown>) => ({
      valid: true,
      values: input,
      errors: [],
    })),
  } as unknown as VariableResolutionService;

  const engine = {
    execute: jest.fn(async () => {
      ejecutados += 1;
      await compuerta;
      if (engineFails) throw new Error('el motor se cayó a mitad de la tanda');
      return { output: {}, status: 'SUCCEEDED' };
    }),
  } as unknown as ExecutionEngineService;

  const audit = { append: jest.fn(async () => undefined) } as unknown as AuditService;

  const service = new QaLabService(prisma, audit, new MetricsService(), variables, engine);
  return {
    service,
    prisma,
    filas,
    liberar,
    ejecutados: () => ejecutados,
    fila: () => [...filas.values()][0],
  };
}

/** Espera activa corta: la tanda vive en una promesa que nadie exporta. */
async function esperar(condicion: () => boolean, que: string): Promise<void> {
  for (let intento = 0; intento < 200 && !condicion(); intento += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!condicion()) throw new Error(`nunca se cumplió: ${que}`);
}

describe('la corrida del QA Lab no se ejecuta dentro de la petición', () => {
  it('responde con la corrida en marcha, antes de haber ejecutado el lote', async () => {
    const banco = build();
    const respuesta = await banco.service.run(1n, 4001n, dto as never, principal);

    expect(respuesta.status).toBe('RUNNING');
    // Los contadores llegan a cero A PROPÓSITO: todavía no se ha ejecutado nada.
    expect(respuesta.totalCases).toBe(0);
    expect(respuesta.counterexamples).toEqual([]);
    // Si esto fuera mayor o igual a 6, la respuesta habría esperado al lote entero.
    expect(banco.ejecutados()).toBeLessThan(6);

    banco.liberar();
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se cierra sola');
  });

  it('archiva cuántos casos va a ejecutar, para poder dibujar el avance', async () => {
    const banco = build();
    await banco.service.run(1n, 4001n, dto as never, principal);

    const config = banco.fila().configJson as Record<string, unknown>;
    // `totalCases` sólo cuenta lo ya ejecutado: sin este dato no se puede decir «40 de 200».
    expect(config.plannedCases).toBe(6);

    banco.liberar();
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida termina');
  });

  it('cierra la corrida con sus contadores cuando la tanda termina', async () => {
    const banco = build();
    await banco.service.run(1n, 4001n, dto as never, principal);
    banco.liberar();
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se completa');

    const fila = banco.fila();
    expect(fila.totalCases).toBe(6);
    expect(fila.passedCases).toBe(6);
    expect(fila.failedCases).toBe(0);
    expect(fila.finishedAt).toBeInstanceOf(Date);
  });

  it('un fallo de fondo queda archivado en la corrida, no sólo en el registro', async () => {
    const banco = build({ engineFails: true });
    await banco.service.run(1n, 4001n, dto as never, principal);
    banco.liberar();

    // Un motor que revienta produce contraejemplos, no una corrida FALLIDA: la excepción
    // ES el hallazgo. Lo que se comprueba es que la corrida CIERRA igualmente —quedarse en
    // RUNNING dejaría al portal sondeando para siempre—.
    await esperar(
      () => ['COMPLETED', 'FAILED'].includes(banco.fila().status),
      'la corrida no se queda colgada en RUNNING',
    );
    expect(banco.fila().finishedAt).toBeInstanceOf(Date);
  });
});

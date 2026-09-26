import { AuditService } from '../src/common/audit/audit.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { QA_LAB_ENVIRONMENT, QaLabService } from '../src/modules/qa-lab/qa-lab.service';
import { parseReplayKind, readRunSummary } from '../src/modules/qa-lab/qa-run-summary';

/**
 * Tres promesas del QA Lab que la pantalla hacía y el motor no cumplía:
 *
 * 1. «Volver a ejecutar» un contraejemplo lo reejecutaba SIEMPRE como caso válido y una sola
 *    vez, así que un «inválido aceptado» o un fallo de determinismo no se reproducían nunca y
 *    la pantalla anunciaba que la versión actual los había corregido.
 * 2. Una corrida cortada por tiempo o por «parar en el primer contraejemplo» se cerraba como
 *    COMPLETED sin decirlo: se leía como «recorrió todo».
 * 3. «Reproducir» necesita la configuración archivada, no sólo la semilla.
 *
 * Prisma, el resolvedor y el motor van fingidos: aquí se prueba el QA Lab, no el motor.
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

const principal = { id: 'qa', requestId: 'req-1' } as unknown as AuthenticatedPrincipal;

interface Options {
  /** El resolvedor acepta toda entrada (incluida la inválida). */
  accepts?: boolean;
  /** Cada ejecución devuelve una salida distinta. */
  flaky?: boolean;
  /** Retraso por ejecución, en ms. */
  delayMs?: number;
  counterexample?: Record<string, unknown>;
}

function build(options: Options = {}) {
  const filas = new Map<bigint, Record<string, unknown>>();
  let calls = 0;
  const prisma = {
    decisionCompiledArtifact: {
      findFirst: jest.fn(async () => ({ compiledPayloadJson: compiled })),
    },
    qaCounterexample: {
      findFirst: jest.fn(async () => options.counterexample ?? null),
      create: jest.fn(async () => ({
        id: 1n,
        property: 'P',
        failureCode: 'F',
        failureMessage: 'm',
      })),
    },
    qaGenerationRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const fila = {
          ...data,
          id: 1n,
          artifactVersionId: 4001n,
          totalCases: 0,
          passedCases: 0,
          failedCases: 0,
          erroredCases: 0,
          durationMs: 0,
          summaryJson: null,
          startedAt: new Date(),
          finishedAt: null,
        };
        filas.set(1n, fila);
        return fila;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        Object.assign(filas.get(1n) as object, data),
      ),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findFirst: jest.fn(async () => ({ ...filas.get(1n), counterexamples: [] })),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  } as unknown as PrismaService;

  const variables = {
    resolve: jest.fn(async (_contract: unknown, input: Record<string, unknown>) =>
      options.accepts === false
        ? { valid: false, values: {}, errors: [{ variable: 'score', code: 'OUT_OF_RANGE' }] }
        : { valid: true, values: input, errors: [] },
    ),
  } as unknown as VariableResolutionService;

  const engine = {
    execute: jest.fn(async () => {
      calls += 1;
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return { output: options.flaky ? { n: calls } : { n: 1 }, status: 'SUCCEEDED' };
    }),
  } as unknown as ExecutionEngineService;

  const service = new QaLabService(
    prisma,
    { append: jest.fn(async () => undefined) } as unknown as AuditService,
    new MetricsService(),
    variables,
    engine,
  );
  return { service, fila: () => filas.get(1n) as Record<string, unknown>, calls: () => calls };
}

async function esperar(condicion: () => boolean, que: string): Promise<void> {
  for (let intento = 0; intento < 300 && !condicion(); intento += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!condicion()) throw new Error(`nunca se cumplió: ${que}`);
}

describe('volver a ejecutar un contraejemplo usa su clase y su propiedad originales', () => {
  it('un inválido aceptado se reproduce como INVÁLIDO', async () => {
    const { service } = build({
      accepts: true,
      counterexample: {
        id: 7n,
        property: 'INPUT_CONTRACT_ENFORCED',
        failureCode: 'INVALID_INPUT_ACCEPTED',
        replayPath: '12/INVALID/score: justo por encima del máximo',
        shrunkInputJson: { score: 901 },
        qaRun: { artifactVersionId: 4001n },
      },
    });
    const result = await service.replay(1n, 7n);
    expect(result.kind).toBe('INVALID');
    // Antes se reejecutaba como VÁLIDO y esto salía `false`: «ya no se reproduce».
    expect(result.reproduced).toBe(true);
  });

  it('un fallo de determinismo se reejecuta varias veces y se compara', async () => {
    const { service, calls } = build({
      flaky: true,
      counterexample: {
        id: 8n,
        property: 'DETERMINISM',
        failureCode: 'NON_DETERMINISTIC_RESULT',
        replayPath: '3/VALID',
        shrunkInputJson: { score: 500 },
        qaRun: { artifactVersionId: 4001n },
      },
    });
    const result = await service.replay(1n, 8n);
    expect(result.property).toBe('DETERMINISM');
    expect(result.executions).toBeGreaterThan(1);
    expect(calls()).toBe(result.executions);
    expect(result.violations.map((violation) => violation.property)).toContain('DETERMINISM');
    expect(result.reproduced).toBe(true);
  });

  it('un motor estable NO reproduce el fallo de determinismo', async () => {
    const { service } = build({
      counterexample: {
        id: 9n,
        property: 'DETERMINISM',
        failureCode: 'NON_DETERMINISTIC_RESULT',
        replayPath: '3/VALID',
        shrunkInputJson: { score: 500 },
        qaRun: { artifactVersionId: 4001n },
      },
    });
    const result = await service.replay(1n, 9n);
    expect(result.reproduced).toBe(false);
  });

  it('lee la clase del replayPath y cae a VÁLIDO en lo desconocido', () => {
    expect(parseReplayKind('4/BOUNDARY/edad: min exacto')).toBe('BOUNDARY');
    expect(parseReplayKind('0/VALID/desenlace: Aprobado')).toBe('VALID');
    expect(parseReplayKind('x')).toBe('VALID');
    expect(parseReplayKind(null)).toBe('VALID');
  });
});

describe('una corrida cortada lo dice', () => {
  const dto = {
    caseCount: 6,
    validPercent: 100,
    boundaryPercent: 0,
    invalidPercent: 0,
    concurrency: 1,
    coverOutcomes: false,
  };

  it('parar en el primer contraejemplo archiva FIRST_FAILURE y los casos ejecutados', async () => {
    const banco = build({ accepts: false });
    await banco.service.run(1n, 4001n, { ...dto, stopOnFirstFailure: true } as never, principal);
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se cierra');

    const summary = readRunSummary(banco.fila().summaryJson as never);
    expect(summary.stoppedReason).toBe('FIRST_FAILURE');
    expect(summary.executedCases).toBe(1);
    expect(summary.summary).toEqual({ INPUT_CONTRACT_ENFORCED: 1 });

    const detalle = await banco.service.getRun(1n, 1n);
    expect(detalle).toMatchObject({
      stoppedReason: 'FIRST_FAILURE',
      executedCases: 1,
      plannedCases: 6,
    });
    // `summary` conserva su forma de siempre: el conteo por propiedad.
    expect(detalle.summary).toEqual({ INPUT_CONTRACT_ENFORCED: 1 });
  });

  it('agotar el tiempo máximo archiva TIMEOUT', async () => {
    const banco = build({ delayMs: 15 });
    await banco.service.run(1n, 4001n, { ...dto, timeoutMs: 1 } as never, principal);
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se cierra');
    const summary = readRunSummary(banco.fila().summaryJson as never);
    expect(summary.stoppedReason).toBe('TIMEOUT');
    expect(summary.executedCases).toBeLessThan(6);
  });

  it('una corrida completa no lleva motivo de corte', async () => {
    const banco = build();
    await banco.service.run(1n, 4001n, dto as never, principal);
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se cierra');
    expect(readRunSummary(banco.fila().summaryJson as never)).toMatchObject({
      stoppedReason: null,
      executedCases: 6,
    });
  });

  it('las corridas antiguas (conteo plano) se siguen leyendo', () => {
    expect(readRunSummary({ DETERMINISM: 2 })).toEqual({
      summary: { DETERMINISM: 2 },
      stoppedReason: null,
      executedCases: null,
    });
    expect(readRunSummary(null).summary).toBeNull();
  });
});

describe('la corrida archiva lo necesario para reproducirla', () => {
  it('publica la configuración completa, sin ambiente elegible, y de dónde salieron los datos', async () => {
    const banco = build();
    const respuesta = await banco.service.run(
      1n,
      4001n,
      {
        caseCount: 4,
        seed: 'qa-base',
        validPercent: 50,
        boundaryPercent: 25,
        invalidPercent: 25,
        coverOutcomes: false,
        environmentCode: 'TEST',
      } as never,
      principal,
    );
    expect(respuesta.environmentCode).toBe(QA_LAB_ENVIRONMENT);
    expect(respuesta.config).toMatchObject({
      caseCount: 4,
      seed: 'qa-base',
      mix: { validPercent: 50, boundaryPercent: 25, invalidPercent: 25 },
      coverOutcomes: false,
    });
    // Sin servicio de fakers en este proceso: el lote es local y la corrida lo dice.
    expect(respuesta.fakers).toMatchObject({ source: 'local-fallback' });
    expect(respuesta.tooling).toMatchObject({ fakers: null });
    expect(respuesta.tooling).not.toHaveProperty('fastCheck');
    await esperar(() => banco.fila().status === 'COMPLETED', 'la corrida se cierra');
  });

  it('sigue rechazando PROD aunque el ambiente ya no se elija', async () => {
    const banco = build();
    await expect(
      banco.service.run(1n, 4001n, { caseCount: 1, environmentCode: 'prod' } as never, principal),
    ).rejects.toMatchObject({ code: 'QA_RUN_PROD_FORBIDDEN' });
  });
});

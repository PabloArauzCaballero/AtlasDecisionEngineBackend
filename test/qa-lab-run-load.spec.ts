import { AuditService } from '../src/common/audit/audit.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { QaLabService } from '../src/modules/qa-lab/qa-lab.service';

/**
 * El listado de corridas publica la CARGA con la que se corrió cada una.
 *
 * Sin ella el listado da duración y número de casos, y cualquiera puede dividir para obtener
 * un «milisegundos por caso» que NO es comparable entre corridas: con concurrencia 1 el motor
 * despacha de uno en uno y con la de serie ocho a la vez, y con `checkDeterminism` cada caso
 * se ejecuta dos veces. Dos corridas de la misma versión pueden diferir en un orden de
 * magnitud sin que el motor se haya degradado nada — y ese número, puesto en una pantalla de
 * monitoreo, es exactamente el que alguien citaría para decidir capacidad.
 *
 * Prisma va fingido: esto es forma de respuesta, no persistencia.
 */
function build(rows: Array<Record<string, unknown>>) {
  const filas = rows.map((row, index) => ({
    id: BigInt(index + 1),
    artifactVersionId: 4001n,
    environmentCode: 'DEV',
    status: 'COMPLETED',
    seed: 'qa-semilla',
    generatorVersion: '1.0',
    totalCases: 100,
    passedCases: 100,
    failedCases: 0,
    erroredCases: 0,
    durationMs: 1000,
    startedAt: new Date('2026-08-15T10:00:00.000Z'),
    finishedAt: new Date('2026-08-15T10:00:01.000Z'),
    _count: { counterexamples: 0 },
    ...row,
  }));

  const prisma = {
    qaGenerationRun: {
      findMany: jest.fn(async () => filas),
      count: jest.fn(async () => filas.length),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  } as unknown as PrismaService;

  return new QaLabService(
    prisma,
    { append: jest.fn() } as unknown as AuditService,
    new MetricsService(),
    {} as unknown as VariableResolutionService,
    {} as unknown as ExecutionEngineService,
  );
}

describe('el listado de corridas de QA publica la carga archivada', () => {
  it('devuelve concurrencia, determinismo y casos planificados', async () => {
    const service = build([
      { configJson: { concurrency: 1, checkDeterminism: true, plannedCases: 512 } },
    ]);

    const pagina = (await service.listRuns(1n, {} as never)) as {
      items: Array<Record<string, unknown>>;
    };

    expect(pagina.items[0]).toMatchObject({
      concurrency: 1,
      checkDeterminism: true,
      plannedCases: 512,
    });
  });

  it('una corrida sin carga archivada la publica como null, no como el valor de serie', async () => {
    /*
     * Las corridas anteriores a este campo no llevan concurrencia. Rellenarla con el 8 de
     * serie inventaría una medición: diría que aquella tanda fue a ocho en paralelo sin que
     * nadie lo sepa, y la comparación con una corrida nueva saldría con toda naturalidad.
     */
    const service = build([{ configJson: { plannedCases: 200 } }, { configJson: null }]);

    const pagina = (await service.listRuns(1n, {} as never)) as {
      items: Array<Record<string, unknown>>;
    };

    expect(pagina.items[0]).toMatchObject({
      concurrency: null,
      checkDeterminism: null,
      plannedCases: 200,
    });
    expect(pagina.items[1]).toMatchObject({
      concurrency: null,
      checkDeterminism: null,
      plannedCases: 0,
    });
  });

  it('descarta un valor que no es del tipo esperado', async () => {
    // La configuración es JSON libre en la fila: nada impide que llegue con otra forma, y un
    // `"8"` de texto colado como número dejaría de ser comparable sin que nada avisara.
    const service = build([
      { configJson: { concurrency: '8', checkDeterminism: 'sí', plannedCases: 'muchos' } },
    ]);

    const pagina = (await service.listRuns(1n, {} as never)) as {
      items: Array<Record<string, unknown>>;
    };

    expect(pagina.items[0]).toMatchObject({
      concurrency: null,
      checkDeterminism: null,
      plannedCases: 0,
    });
  });
});

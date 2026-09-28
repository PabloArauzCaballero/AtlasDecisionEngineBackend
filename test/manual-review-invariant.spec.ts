import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { HashService } from '../src/common/crypto/hash.service';
import { DomainException } from '../src/common/errors/domain-exception';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { ResolvedDeployment } from '../src/modules/deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../src/modules/graph/graph.types';
import { ExecutionWriterService } from '../src/modules/runtime/execution-writer.service';
import {
  isManualReviewOutcome,
  manualReviewCaseCode,
} from '../src/modules/runtime/manual-review-case-code';

/**
 * Estados imposibles de la revisión manual, y que la escritura sea atómica.
 *
 * Antes de este guardia el motor podía dejar una ejecución SUCCEEDED con desenlace «REVISION_MANUAL»
 * y ninguna fila en `decision_manual_review_case` (A12: un nodo RESULT devolvía el rótulo sin abrir
 * caso). El cliente veía «a revisión» y ningún analista tenía nada en la bandeja. Aquí se demuestra
 * que ese estado ya no se puede escribir, que el inverso tampoco, que el guardia salta ANTES de
 * escribir nada (atomicidad: ni ejecución, ni variables, ni caso), y que un fallo al persistir el caso
 * dentro de la transacción no deja la ejecución escrita por su cuenta.
 */
describe('invariante: revisión manual ⇔ caso en cola', () => {
  const hashes = new HashService(new ConfigService({ SUBJECT_HMAC_SECRET: 'x'.repeat(48) }));

  function resultado(cambios: Partial<EngineExecutionResult>): EngineExecutionResult {
    return {
      status: 'SUCCEEDED',
      outcome: 'APROBADO',
      output: {},
      reasons: [],
      trace: [],
      visitedNodeKeys: [],
      traversedEdgeKeys: [],
      nestedExecutions: [],
      ...cambios,
    } as unknown as EngineExecutionResult;
  }

  const caso = {
    queueCode: 'MERCHANT_KYB',
    priority: 80,
    slaMinutes: 240,
    evidence: { motivo: 'correo sin verificar' },
  };

  function escritor(opciones: { fallarCaso?: boolean } = {}) {
    const creados: Array<{ modelo: string; data: Record<string, unknown> }> = [];
    const tx = new Proxy(
      {},
      {
        get: (_objetivo, modelo: string) => ({
          create: ({ data }: { data: Record<string, unknown> }) => {
            if (opciones.fallarCaso && modelo === 'decisionManualReviewCase') {
              return Promise.reject(new Error('la base rechazó el caso'));
            }
            creados.push({ modelo, data });
            return Promise.resolve({ id: 501n, decisionStatus: 'SUCCEEDED', ...data });
          },
          createMany: () => Promise.resolve({ count: 0 }),
        }),
      },
    ) as unknown as Prisma.TransactionClient;
    const writer = new ExecutionWriterService({} as PrismaService, hashes, new ConfigService({}));
    const escribir = (result: EngineExecutionResult, statusOverride?: 'NO_DECISION') =>
      writer.write(
        {
          tenantId: 1n,
          deployment: {
            deploymentId: 9n,
            artifactVersionId: 77n,
            environmentId: 3n,
            environmentCode: 'TEST',
            riskDomain: 'KYB',
          } as unknown as ResolvedDeployment,
          requestId: 'req-1',
          idempotencyKey: 'idem-1',
          inputSnapshot: {},
          durationMs: 1,
          variableSnapshots: [],
          result,
          ...(statusOverride ? { statusOverride } : {}),
        },
        tx,
      );
    return { creados, escribir };
  }

  it.each(['REVISION_MANUAL', 'MANUAL_REVIEW', 'REVISAR', 'revision_manual '])(
    'un desenlace «%s» sin caso no se escribe: 422 MANUAL_REVIEW_WITHOUT_CASE y cero filas',
    async (outcome) => {
      const { creados, escribir } = escritor();
      await expect(escribir(resultado({ outcome }))).rejects.toMatchObject({
        code: 'MANUAL_REVIEW_WITHOUT_CASE',
        status: 422,
      });
      expect(creados).toEqual([]);
    },
  );

  it('un caso abierto con un desenlace que no es revisión tampoco se escribe', async () => {
    const { creados, escribir } = escritor();
    const error = await escribir(resultado({ outcome: 'APROBADO', manualReview: caso })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).code).toBe('MANUAL_REVIEW_CASE_WITHOUT_OUTCOME');
    expect(creados).toEqual([]);
  });

  it('el estado coherente se escribe entero: ejecución + caso con el código anunciado', async () => {
    const { creados, escribir } = escritor();
    await escribir(resultado({ outcome: 'MANUAL_REVIEW', manualReview: caso }));
    const modelos = creados.map((c) => c.modelo);
    expect(modelos).toContain('decisionExecution');
    expect(modelos).toContain('decisionManualReviewCase');
    const fila = creados.find((c) => c.modelo === 'decisionManualReviewCase');
    expect(fila?.data.caseCode).toBe(manualReviewCaseCode(501n));
  });

  it('APROBADO y RECHAZADO sin caso siguen escribiéndose', async () => {
    for (const outcome of ['APROBADO', 'RECHAZADO']) {
      const { creados, escribir } = escritor();
      await escribir(resultado({ outcome }));
      expect(creados.map((c) => c.modelo)).toEqual(['decisionExecution']);
    }
  });

  it('NO_DECISION forzado por el runtime no abre caso ni dispara el guardia', async () => {
    // El runtime quita el caso a propósito cuando la salida económica es inválida (statusOverride).
    const { creados, escribir } = escritor();
    await escribir(
      resultado({ outcome: 'REVISION_MANUAL', manualReview: undefined }),
      'NO_DECISION',
    );
    expect(creados.map((c) => c.modelo)).toEqual(['decisionExecution']);
    expect(creados[0].data.decisionStatus).toBe('NO_DECISION');
  });

  it('si la base rechaza el caso, el error sale de la transacción: la ejecución no queda como procesada', async () => {
    // Con Prisma la transacción real deshace la fila de `decisionExecution`; aquí se comprueba lo
    // que el writer puede garantizar por sí mismo: propaga el fallo en vez de tragárselo.
    const { escribir } = escritor({ fallarCaso: true });
    await expect(
      escribir(resultado({ outcome: 'MANUAL_REVIEW', manualReview: caso })),
    ).rejects.toThrow('la base rechazó el caso');
  });

  it('isManualReviewOutcome reconoce los tres rótulos y nada más', () => {
    expect(
      ['MANUAL_REVIEW', 'REVISION_MANUAL', 'REVISAR', ' revisar '].every(isManualReviewOutcome),
    ).toBe(true);
    expect(
      ['APROBADO', 'RECHAZADO', 'NO_DECISION', undefined, null, 7].some(isManualReviewOutcome),
    ).toBe(false);
  });
});

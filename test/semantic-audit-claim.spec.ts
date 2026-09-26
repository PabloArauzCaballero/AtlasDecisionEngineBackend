import { WorkerRunStatus } from '@prisma/client';
import { PrismaSemanticAuditRepository } from '../src/modules/workers/semantic-analysis/adapters/prisma-audit.repository';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { SemanticAnalysisRequest } from '../src/modules/workers/semantic-analysis/core/domain/semantic-analysis.types';

/**
 * El reclamo de un análisis semántico, que estuvo bloqueando el worker entero.
 *
 * `claim()` decide si este intento puede analizar o si debe devolver un
 * resultado ya existente. Busca la fila por `requestId` — la MISMA que el worker
 * acaba de tomar de la cola poniéndola en `RUNNING`—, así que interpretar ese
 * estado como «otro la está haciendo» hacía que el procesador se saltara su
 * propio trabajo. Con el worker encendido, ninguna solicitud llegaba nunca a
 * analizarse: volvían a `RUNNING`, vencía el lease, se recuperaban y otra vez.
 *
 * Estas pruebas fijan las tres decisiones para que el bloqueo no pueda volver.
 */

const REQUEST: SemanticAnalysisRequest = {
  requestId: 'req-1',
  idempotencyKey: 'clave-1',
  text: 'Un cobro que no reconozco.',
  tenantId: '1',
  requestedBy: 'pruebas',
};

function repositorioCon(row: unknown): PrismaSemanticAuditRepository {
  const prisma = {
    semanticAnalysisRun: { findFirst: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
  return new PrismaSemanticAuditRepository(prisma);
}

const RESULTADO_VALIDO = {
  requestId: 'req-1',
  status: 'MATCH',
  matches: [],
  entities: [],
  tierUsed: 'FAST',
  model: 'modelo-x',
  modelVersion: 'modelo-x',
  normalizedText: 'un cobro que no reconozco',
  processingTimeMs: 12,
  evaluatedCategoryCodes: [],
};

describe('PrismaSemanticAuditRepository.claim', () => {
  it('reclama una fila que el worker acaba de poner en RUNNING', async () => {
    // Es el caso que bloqueaba el worker: la fila en RUNNING es este mismo
    // intento, no uno ajeno.
    const claim = await repositorioCon({
      status: WorkerRunStatus.RUNNING,
      resultJson: null,
    }).claim(REQUEST);

    expect(claim.state).toBe('ACQUIRED');
  });

  it('reclama una fila todavía en cola', async () => {
    const claim = await repositorioCon({
      status: WorkerRunStatus.QUEUED,
      resultJson: null,
    }).claim(REQUEST);

    expect(claim.state).toBe('ACQUIRED');
  });

  it('devuelve el resultado existente cuando el análisis ya terminó', async () => {
    // Es lo que la idempotencia promete: repetir la solicitud no vuelve a
    // gastar una llamada al modelo.
    const claim = await repositorioCon({
      status: WorkerRunStatus.SUCCEEDED,
      resultJson: RESULTADO_VALIDO,
    }).claim(REQUEST);

    expect(claim.state).toBe('COMPLETED');
    expect(claim.state === 'COMPLETED' && claim.result.requestId).toBe('req-1');
  });

  it('vuelve a reclamar si el estado es terminal pero el resultado no es legible', async () => {
    // Una fila escrita a medias no puede devolverse como si fuera un análisis:
    // se rehace en vez de inventar una respuesta.
    const claim = await repositorioCon({
      status: WorkerRunStatus.SUCCEEDED,
      resultJson: { esto: 'no es un resultado' },
    }).claim(REQUEST);

    expect(claim.state).toBe('ACQUIRED');
  });

  it('reclama cuando no hay fila todavía', async () => {
    expect((await repositorioCon(null).claim(REQUEST)).state).toBe('ACQUIRED');
  });
});

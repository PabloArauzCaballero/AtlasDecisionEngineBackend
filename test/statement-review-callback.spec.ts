import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import type { AuditService } from '../src/common/audit/audit.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { AtlasCallbackService } from '../src/modules/atlas-callback/atlas-callback.service';
import {
  RUTA_DE_CALLBACK_DE_EXTRACTOS,
  StatementReviewService,
} from '../src/modules/workers/bank-statement/review/statement-review.service';
import type { ResolveStatementReviewDto } from '../src/modules/workers/bank-statement/review/statement-review.dto';

/**
 * Resolver un extracto en la bandeja del motor avisa a AtlasBackend (A6).
 *
 * Sin el aviso, la revisión del cliente en Atlas se quedaba `processing` para siempre y le
 * impedía subir otro extracto (`409 BANK_STATEMENT_REVIEW_ALREADY_OPEN`).
 */
describe('StatementReviewService.resolve · aviso a AtlasBackend', () => {
  const analista = {
    id: 'ana',
    requestId: 'req-7',
    roles: [],
  } as unknown as AuthenticatedPrincipal;

  function montar(run: Record<string, unknown> | null) {
    const avisos: Array<{ tx: unknown; aviso: Record<string, unknown> }> = [];
    const orden: string[] = [];
    const tx = {
      bankStatementRun: {
        update: jest.fn(async () => {
          orden.push('update');
          return {};
        }),
      },
    };
    const prisma = {
      bankStatementRun: {
        findFirst: jest.fn(async () => run),
        findFirstOrThrow: jest.fn(async () => ({ requestId: 'bs-1' })),
      },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService;
    const audit = {
      append: jest.fn(async () => {
        orden.push('audit');
        return {};
      }),
    } as unknown as AuditService;
    const callbacks = {
      solicitar: jest.fn(async (client: unknown, aviso: Record<string, unknown>) => {
        orden.push('aviso');
        avisos.push({ tx: client, aviso });
      }),
    } as unknown as AtlasCallbackService;
    const service = new StatementReviewService(
      prisma,
      audit,
      new ConfigService({}),
      { notify: jest.fn() } as unknown as JobSignalService,
      callbacks,
    );
    return { service, avisos, tx, orden };
  }

  const reclamado = {
    status: WorkerRunStatus.IN_REVIEW,
    reviewReason: 'UNKNOWN_BANK',
    reviewClaimedBy: 'ana',
    transactionCount: 40,
  };

  it('encola el aviso en la transacción de la resolución, antes de la auditoría', async () => {
    const { service, avisos, tx, orden } = montar(reclamado);

    await service.resolve(3n, 'bs-1', { action: 'APPROVE' } as ResolveStatementReviewDto, analista);

    expect(avisos).toHaveLength(1);
    expect(avisos[0].tx).toBe(tx);
    expect(avisos[0].aviso).toMatchObject({
      tenantId: 3n,
      ruta: RUTA_DE_CALLBACK_DE_EXTRACTOS,
      cuerpo: {
        requestId: 'bs-1',
        status: WorkerRunStatus.SUCCEEDED,
        action: 'APPROVE',
        resolvedByInternalUserId: 'ana',
      },
      aggregateType: 'BankStatementRun',
      aggregateId: 'bs-1',
    });
    // La auditoría toma el cerrojo de la cadena: va la última.
    expect(orden).toEqual(['update', 'aviso', 'audit']);
    expect(RUTA_DE_CALLBACK_DE_EXTRACTOS).toBe('/internal/credit/bank-statement-review-callback');
  });

  it('marcar como no válido también avisa, con el desenlace', async () => {
    const { service, avisos } = montar(reclamado);

    await service.resolve(
      3n,
      'bs-1',
      {
        action: 'MARK_INVALID',
        rejectionReason: 'NOT_BANK_STATEMENT',
      } as ResolveStatementReviewDto,
      analista,
    );

    expect(avisos[0].aviso).toMatchObject({
      cuerpo: expect.objectContaining({
        status: WorkerRunStatus.PDF_INVALID,
        action: 'MARK_INVALID',
      }),
    });
  });

  it('una resolución que no pasa la segregación no avisa', async () => {
    const { service, avisos } = montar({ ...reclamado, reviewClaimedBy: 'beto' });

    await expect(
      service.resolve(3n, 'bs-1', { action: 'APPROVE' } as ResolveStatementReviewDto, analista),
    ).rejects.toMatchObject({ code: 'BANK_STATEMENT_REVIEW_ASSIGNEE_MISMATCH' });
    expect(avisos).toHaveLength(0);
  });
});

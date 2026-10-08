import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainException } from '../src/common/errors/domain-exception';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { AtlasCallbackService } from '../src/modules/atlas-callback/atlas-callback.service';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';
import type { ResolveManualReviewDto } from '../src/modules/manual-review/manual-review.dto';

/**
 * Dos resoluciones simultáneas leían el caso ASSIGNED fuera de la transacción y las dos
 * escribían y encolaban su aviso: AtlasBackend recibía APPROVE y DECLINE de la misma ejecución.
 * El mock imita la fila: `update` con `status` en el `where` falla con P2025 si la fila ya no
 * cumple, que es lo que hace Postgres tras el bloqueo de fila.
 */
describe('ManualReviewService.resolve — resoluciones concurrentes', () => {
  const CASE = 7n;
  const ana = { id: 'ana', requestId: 'r-1', roles: ['FRAUD_ANALYST'] } as AuthenticatedPrincipal;
  const jefe = { id: 'jefa', requestId: 'r-2', roles: ['OPERATIONS'] } as AuthenticatedPrincipal;

  function make() {
    const row = {
      id: CASE,
      status: 'ASSIGNED',
      assignedTo: 'ana',
      queueCode: 'IDENTIDAD',
      executionId: 3n,
    };
    const avisos: Array<Record<string, unknown>> = [];
    const audited: string[] = [];
    const tx = {
      decisionManualReviewCase: {
        update: async (args: {
          where: { status?: { in: string[] } };
          data: Record<string, unknown>;
        }) => {
          // Cede el turno: las dos llamadas ya han leído ASSIGNED antes de que ninguna escriba.
          await Promise.resolve();
          if (args.where.status && !args.where.status.in.includes(row.status)) {
            throw new Prisma.PrismaClientKnownRequestError('not found', {
              code: 'P2025',
              clientVersion: 'test',
            });
          }
          Object.assign(row, args.data);
          return { ...row };
        },
      },
      decisionExecution: {
        findUnique: () => Promise.resolve({ requestId: 'q', correlationId: 'c' }),
      },
    };
    const prisma = {
      decisionManualReviewCase: { findFirst: async () => ({ ...row }) },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService;
    const audit = {
      append: (input: { eventType: string }) => {
        audited.push(input.eventType);
        return Promise.resolve({});
      },
    } as unknown as AuditService;
    const callbacks = {
      solicitar: (_tx: unknown, aviso: Record<string, unknown>) => {
        avisos.push(aviso);
        return Promise.resolve();
      },
    } as unknown as AtlasCallbackService;
    const service = new ManualReviewService(prisma, audit, new ConfigService({}), callbacks);
    return { service, avisos, audited, row };
  }

  const dto = (decision: string) => ({ decision, reason: 'motivo' }) as ResolveManualReviewDto;

  it('con dos resoluciones a la vez gana una y la otra recibe 409 sin encolar aviso', async () => {
    const { service, avisos, audited, row } = make();

    const results = await Promise.allSettled([
      service.resolve(1n, CASE, dto('APPROVE'), ana),
      service.resolve(1n, CASE, dto('DECLINE'), jefe),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DomainException);
    expect((rejected[0].reason as DomainException).code).toBe('MANUAL_REVIEW_CLOSED');
    expect((rejected[0].reason as DomainException).status).toBe(409);
    expect(avisos).toHaveLength(1);
    expect(audited.filter((e) => e === 'MANUAL_REVIEW_RESOLVED')).toHaveLength(1);
    expect(row.status).toBe('RESOLVED_APPROVED');
  });
});

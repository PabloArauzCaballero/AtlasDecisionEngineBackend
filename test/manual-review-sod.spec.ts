import { ConfigService } from '@nestjs/config';
import { ManualReviewStatus } from '@prisma/client';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';
import { DomainException } from '../src/common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

// Segregation of duties on manual-review resolution: a fraud/AML/credit review must be
// explicitly assigned first and may only be resolved by its assignee. Without this, any single
// analyst could open and close a case unilaterally (collusion/self-approval risk).
describe('ManualReviewService.resolve — segregation of duties', () => {
  const principal = (id: string): AuthenticatedPrincipal =>
    ({ id, requestId: 'req-1', roles: ['FRAUD_ANALYST'] }) as unknown as AuthenticatedPrincipal;

  function makeService(review: { id: bigint; status: ManualReviewStatus; assignedTo: string | null }) {
    const updateCalls: unknown[] = [];
    const prisma = {
      decisionManualReviewCase: {
        findFirst: async () => review,
      },
      $transaction: async (cb: (tx: unknown) => unknown) =>
        cb({
          decisionManualReviewCase: {
            update: async (args: unknown) => {
              updateCalls.push(args);
              return { ...review, status: ManualReviewStatus.RESOLVED_APPROVED };
            },
          },
        }),
    };
    const audit = { append: async () => ({}) };
    const service = new ManualReviewService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      new ConfigService({}),
    );
    return { service, updateCalls };
  }

  const resolveDto = { decision: 'APPROVE' as const, reason: 'ok' };

  it('rejects resolving an unassigned (OPEN) case instead of auto-self-assigning', async () => {
    const { service, updateCalls } = makeService({
      id: 1n,
      status: ManualReviewStatus.OPEN,
      assignedTo: null,
    });
    await expect(service.resolve(1n, 1n, resolveDto, principal('analyst-a'))).rejects.toMatchObject({
      code: 'MANUAL_REVIEW_NOT_ASSIGNED',
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('rejects a resolver who is not the assignee', async () => {
    const { service, updateCalls } = makeService({
      id: 1n,
      status: ManualReviewStatus.ASSIGNED,
      assignedTo: 'analyst-a',
    });
    await expect(
      service.resolve(1n, 1n, resolveDto, principal('analyst-b')),
    ).rejects.toBeInstanceOf(DomainException);
    await expect(
      service.resolve(1n, 1n, resolveDto, principal('analyst-b')),
    ).rejects.toMatchObject({ code: 'MANUAL_REVIEW_ASSIGNEE_MISMATCH' });
    expect(updateCalls).toHaveLength(0);
  });

  it('allows the assigned analyst to resolve their own case', async () => {
    const { service, updateCalls } = makeService({
      id: 1n,
      status: ManualReviewStatus.ASSIGNED,
      assignedTo: 'analyst-a',
    });
    await expect(
      service.resolve(1n, 1n, resolveDto, principal('analyst-a')),
    ).resolves.toMatchObject({ status: ManualReviewStatus.RESOLVED_APPROVED });
    expect(updateCalls).toHaveLength(1);
  });
});

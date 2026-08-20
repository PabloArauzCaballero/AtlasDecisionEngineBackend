import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type {
  AssignManualReviewDto,
  ResolveManualReviewDto,
} from '../src/modules/manual-review/manual-review.dto';

/**
 * Resolver una revisión manual de fraude, prevención de blanqueo o crédito es una decisión de
 * una sola persona con consecuencia financiera real. La segregación de funciones que la
 * protege es sencilla y por eso fácil de romper sin querer:
 *
 *  1. hace falta un `assign()` **previo y explícito** — resolver nunca se auto-asigna;
 *  2. solo el analista asignado puede resolver;
 *  3. un caso ya cerrado no se reabre por la vía de volver a resolverlo.
 *
 * Sin la primera, cualquier principal con el rol de revisión abriría y cerraría un caso en una
 * sola llamada, que es exactamente lo que la segregación existe para impedir.
 */
describe('ManualReviewService — segregación de funciones', () => {
  const TENANT = 9n;
  const CASE = 77n;
  const analista = { id: 'ana', requestId: 'req-1' } as AuthenticatedPrincipal;
  const otro = { id: 'beto', requestId: 'req-2' } as AuthenticatedPrincipal;

  function make(review: Record<string, unknown> | null) {
    const audited: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const audit = {
      append: (input: { eventType: string }) => {
        audited.push(input.eventType);
        return Promise.resolve({});
      },
    } as unknown as AuditService;
    const tx = {
      decisionManualReviewCase: {
        update: (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({ id: CASE, ...args.data });
        },
      },
    };
    const prisma = {
      decisionManualReviewCase: { findFirst: () => Promise.resolve(review) },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService;
    return {
      service: new ManualReviewService(prisma, audit, new ConfigService({})),
      audited,
      updates,
    };
  }

  const assignDto = { assignedTo: 'ana' } as AssignManualReviewDto;
  const resolveDto = (decision: string) =>
    ({ decision, reason: 'motivo' }) as unknown as ResolveManualReviewDto;

  describe('assign()', () => {
    it('404 cuando el caso no es de este tenant', async () => {
      const { service } = make(null);
      const error = await service
        .assign(TENANT, CASE, assignDto, analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_NOT_FOUND');
      expect((error as DomainException).status).toBe(404);
    });

    it('asigna un caso abierto y deja la evidencia en la misma transacción', async () => {
      const { service, audited, updates } = make({ id: CASE, status: 'OPEN', assignedTo: null });
      await service.assign(TENANT, CASE, assignDto, analista);
      expect(updates[0]).toMatchObject({ assignedTo: 'ana', status: 'ASSIGNED' });
      expect(audited).toEqual(['MANUAL_REVIEW_ASSIGNED']);
    });

    it('permite reasignar un caso que ya estaba asignado', async () => {
      // Un analista de baja tiene que poder ceder su caso; lo que no se permite es tocarlo
      // una vez cerrado.
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'beto' });
      await service.assign(TENANT, CASE, assignDto, analista);
      expect(updates[0]).toMatchObject({ assignedTo: 'ana' });
    });

    it('un caso ya resuelto no se puede reasignar', async () => {
      const { service, audited } = make({
        id: CASE,
        status: 'RESOLVED_APPROVED',
        assignedTo: 'ana',
      });
      const error = await service
        .assign(TENANT, CASE, assignDto, analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_CLOSED');
      expect((error as DomainException).status).toBe(409);
      expect(audited).toEqual([]);
    });
  });

  describe('resolve()', () => {
    it('exige asignación previa: nadie abre y cierra en una sola llamada', async () => {
      const { service, audited } = make({ id: CASE, status: 'OPEN', assignedTo: null });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_NOT_ASSIGNED');
      expect((error as DomainException).status).toBe(409);
      expect(audited).toEqual([]);
    });

    it('solo el analista asignado puede resolver', async () => {
      const { service } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), otro)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGNEE_MISMATCH');
      // 403 y no 404: el caso existe y el solicitante puede verlo; lo que no puede es cerrarlo.
      expect((error as DomainException).status).toBe(403);
    });

    it('un caso cerrado no se resuelve dos veces', async () => {
      const { service } = make({ id: CASE, status: 'CANCELLED', assignedTo: 'ana' });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_CLOSED');
    });

    it('404 cuando el caso no es de este tenant', async () => {
      const { service } = make(null);
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_NOT_FOUND');
    });

    it.each([
      ['APPROVE', 'RESOLVED_APPROVED'],
      ['DECLINE', 'RESOLVED_DECLINED'],
      ['CANCEL', 'CANCELLED'],
    ])('la decisión %s deja el caso en %s', async (decision, expected) => {
      const { service, updates, audited } = make({
        id: CASE,
        status: 'ASSIGNED',
        assignedTo: 'ana',
      });
      await service.resolve(TENANT, CASE, resolveDto(decision), analista);
      expect(updates[0].status).toBe(expected);
      expect(audited).toHaveLength(1);
    });

    it('la resolución guarda quién la tomó, no solo qué se decidió', async () => {
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      await service.resolve(TENANT, CASE, resolveDto('DECLINE'), analista);
      expect(updates[0].resolutionJson).toMatchObject({
        decision: 'DECLINE',
        reason: 'motivo',
        resolvedBy: 'ana',
      });
      expect(updates[0].resolvedAt).toBeInstanceOf(Date);
    });
  });
});

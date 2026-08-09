import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { GovernanceService } from '../src/modules/governance/governance.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { VersionStateService } from '../src/modules/artifacts/version-state.service';
import type { TestExecutionService } from '../src/modules/testing/test-execution.service';
import type { SecurityReviewService } from '../src/modules/security-review/security-review.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { RecordApprovalDecisionDto } from '../src/modules/governance/governance.dto';

/**
 * La puerta de aprobación es lo único que separa «alguien escribió una regla» de «esa regla
 * decide sobre dinero real». Sus guardas se comprueban una a una porque cada una tapa una
 * forma distinta de saltársela, y todas fallan en silencio si se rompen: la versión sigue
 * pareciendo aprobada.
 *
 * El orden en que se evalúan también importa y por eso se prueba: quien no tiene el rol no
 * debe enterarse de si el paso está abierto o de quién lo firmó.
 */
describe('GovernanceService — guardas de aprobación', () => {
  const TENANT = 8n;
  const STEP = 42n;

  const principal = (id: string, roles: string[]) =>
    ({ id, roles, requestId: 'req-1' }) as AuthenticatedPrincipal;

  const audit = { append: () => Promise.resolve({}) } as unknown as AuditService;
  const outbox = { publish: () => Promise.resolve({}) } as unknown as OutboxPublisherService;
  const states = { transition: () => Promise.resolve({}) } as unknown as VersionStateService;
  // Ninguna de las guardas que se prueban aquí llega a usarlos: se declaran para satisfacer
  // el constructor sin fingir comportamiento que no se ejercita.
  const tests = {} as unknown as TestExecutionService;
  const securityReview = {} as unknown as SecurityReviewService;

  function step(overrides: Record<string, unknown> = {}) {
    return {
      id: STEP,
      stepOrder: 1,
      status: 'PENDING',
      requiredRole: 'RISK_APPROVER',
      separationOfDuties: true,
      decisions: [],
      approvalRequest: {
        id: 1n,
        status: 'IN_REVIEW',
        artifactVersion: {
          id: 5n,
          createdBy: 'autor',
          versionNumber: 1,
          artifact: { artifactCode: 'CREDIT', tenantId: TENANT },
        },
        steps: [{ stepOrder: 1, status: 'PENDING' }],
      },
      ...overrides,
    };
  }

  function service(found: Record<string, unknown> | null) {
    const prisma = {
      decisionApprovalStep: { findFirst: () => Promise.resolve(found) },
      decisionArtifactVersion: { findFirst: () => Promise.resolve(null) },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          decisionApprovalDecision: { create: () => Promise.resolve({ id: 1n }) },
          decisionApprovalStep: { update: () => Promise.resolve({}) },
          decisionApprovalRequest: { update: () => Promise.resolve({}) },
        }),
    } as unknown as PrismaService;
    return new GovernanceService(
      prisma,
      tests,
      states,
      audit,
      outbox,
      securityReview,
      new ConfigService({}),
    );
  }

  const dto = { decision: 'APPROVE', comments: 'ok' } as RecordApprovalDecisionDto;

  const decide = (found: Record<string, unknown> | null, who: AuthenticatedPrincipal) =>
    service(found)
      .recordDecision(TENANT, STEP, dto, who)
      .catch((caught: unknown) => caught);

  it('un paso de otro tenant es 404', async () => {
    const error = await decide(null, principal('ana', ['RISK_APPROVER']));
    expect((error as DomainException).code).toBe('APPROVAL_STEP_NOT_FOUND');
    expect((error as DomainException).status).toBe(404);
  });

  it('un paso ya decidido no se vuelve a decidir', async () => {
    const error = await decide(step({ status: 'APPROVED' }), principal('ana', ['RISK_APPROVER']));
    expect((error as DomainException).code).toBe('APPROVAL_STEP_CLOSED');
    expect((error as DomainException).status).toBe(409);
  });

  it('una solicitud que ya no está en revisión cierra todos sus pasos', async () => {
    const cerrada = step();
    (cerrada.approvalRequest as { status: string }).status = 'APPROVED';
    const error = await decide(cerrada, principal('ana', ['RISK_APPROVER']));
    expect((error as DomainException).code).toBe('APPROVAL_STEP_CLOSED');
  });

  it('no se puede firmar el paso 2 antes que el 1', async () => {
    const fuera = step({
      stepOrder: 2,
      approvalRequest: {
        ...step().approvalRequest,
        steps: [
          { stepOrder: 1, status: 'PENDING' },
          { stepOrder: 2, status: 'PENDING' },
        ],
      },
    });
    const error = await decide(fuera, principal('ana', ['RISK_APPROVER']));
    // Sin esto, el flujo de dos ojos se reduce a uno: basta con firmar el último paso.
    expect((error as DomainException).code).toBe('APPROVAL_STEP_OUT_OF_ORDER');
    expect((error as DomainException).status).toBe(409);
  });

  it('un paso anterior RECHAZADO tampoco deja seguir', async () => {
    const fuera = step({
      stepOrder: 2,
      approvalRequest: {
        ...step().approvalRequest,
        steps: [
          { stepOrder: 1, status: 'REJECTED' },
          { stepOrder: 2, status: 'PENDING' },
        ],
      },
    });
    const error = await decide(fuera, principal('ana', ['RISK_APPROVER']));
    expect((error as DomainException).code).toBe('APPROVAL_STEP_OUT_OF_ORDER');
  });

  it('hace falta exactamente el rol que el paso pide', async () => {
    const error = await decide(step(), principal('ana', ['QA_ANALYST']));
    expect((error as DomainException).code).toBe('APPROVAL_ROLE_REQUIRED');
    expect((error as DomainException).status).toBe(403);
    expect((error as DomainException).message).toContain('RISK_APPROVER');
  });

  /*
   * Los dos casos que SÍ pasan las guardas se afirman por lo que no ocurre.
   *
   * Comprobar que la llamada termina exigiría modelar el flujo entero —transición de estado,
   * outbox, notificación—, y entonces la prueba dejaría de hablar de la guarda para hablar de
   * lo que hay detrás. Lo que aquí importa es que el rechazo NO se produce.
   */
  const guardaQueSalta = async (who: AuthenticatedPrincipal, found = step()) => {
    const result = await decide(found, who);
    return result instanceof DomainException ? result.code : null;
  };

  it('PLATFORM_ADMIN no queda bloqueado por el rol del paso', async () => {
    expect(await guardaQueSalta(principal('admin', ['PLATFORM_ADMIN']))).not.toBe(
      'APPROVAL_ROLE_REQUIRED',
    );
  });

  it('el autor de la versión no la aprueba cuando el paso exige segregación', async () => {
    const error = await decide(step(), principal('autor', ['RISK_APPROVER']));
    expect((error as DomainException).code).toBe('SEPARATION_OF_DUTIES_VIOLATION');
    expect((error as DomainException).status).toBe(403);
  });

  it('sin segregación declarada, el autor no queda bloqueado en ese paso', async () => {
    // Hay pasos —una revisión de QA sobre el propio trabajo— donde no aplica; la regla la
    // fija el paso, no el servicio.
    expect(
      await guardaQueSalta(
        principal('autor', ['RISK_APPROVER']),
        step({ separationOfDuties: false }),
      ),
    ).not.toBe('SEPARATION_OF_DUTIES_VIOLATION');
  });

  it('nadie firma dos veces el mismo paso', async () => {
    const error = await decide(
      step({ decisions: [{ decidedBy: 'ana' }] }),
      principal('ana', ['RISK_APPROVER']),
    );
    // Firmar dos veces convertiría un paso que exige dos revisores en uno con una sola
    // persona pulsando dos veces.
    expect((error as DomainException).code).toBe('DUPLICATE_APPROVAL_DECISION');
    expect((error as DomainException).status).toBe(409);
  });

  it('el rol se comprueba ANTES que la segregación: no se filtra quién es el autor', async () => {
    // Quien no tiene el rol recibe siempre el mismo error, tenga o no relación con la
    // versión. Invertir el orden convertiría el mensaje en un oráculo de autoría.
    const error = await decide(step(), principal('autor', ['QA_ANALYST']));
    expect((error as DomainException).code).toBe('APPROVAL_ROLE_REQUIRED');
  });
});

describe('GovernanceService.assertApproved — la puerta que mira el despliegue', () => {
  const TENANT = 8n;
  const audit = { append: () => Promise.resolve({}) } as unknown as AuditService;
  const outbox = { publish: () => Promise.resolve({}) } as unknown as OutboxPublisherService;
  const states = { transition: () => Promise.resolve({}) } as unknown as VersionStateService;
  const tests = {} as unknown as TestExecutionService;
  const securityReview = {} as unknown as SecurityReviewService;

  const service = (version: Record<string, unknown> | null) => {
    const prisma = {
      decisionArtifactVersion: { findFirst: () => Promise.resolve(version) },
    } as unknown as PrismaService;
    return new GovernanceService(
      prisma,
      tests,
      states,
      audit,
      outbox,
      securityReview,
      new ConfigService({}),
    );
  };

  it.each([
    'APPROVED',
    'DEPLOYED_TO_DEV',
    'DEPLOYED_TO_STAGING',
    'DEPLOYED_TO_TEST',
    'DEPLOYED_TO_PROD',
  ])('deja pasar una versión en estado %s', async (status) => {
    await expect(
      service({ status, approvedAt: new Date() }).assertApproved(TENANT, 1n),
    ).resolves.toBeUndefined();
  });

  it.each(['DRAFT', 'IN_REVIEW', 'REJECTED', 'SUSPENDED', 'ARCHIVED'])(
    'bloquea una versión en estado %s',
    async (status) => {
      const error = await service({ status, approvedAt: null })
        .assertApproved(TENANT, 1n)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('VERSION_NOT_APPROVED');
      expect((error as DomainException).status).toBe(409);
    },
  );

  it('una versión de otro tenant se trata como no aprobada', async () => {
    // Mismo error que una versión sin aprobar: un 404 distinto confirmaría que el id existe.
    const error = await service(null)
      .assertApproved(TENANT, 1n)
      .catch((caught: unknown) => caught);
    expect((error as DomainException).code).toBe('VERSION_NOT_APPROVED');
  });
});

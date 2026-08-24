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
 *  2. sólo el analista asignado puede resolver;
 *  3. un caso ya cerrado no se reabre por la vía de volver a resolverlo;
 *  4. y la regla 2 no se esquiva por `assign()`: un caso ajeno sólo lo mueve quien supervisa.
 *
 * Sin la primera, cualquier principal con el rol de revisión abriría y cerraría un caso en una
 * sola llamada, que es exactamente lo que la segregación existe para impedir. Sin la cuarta, las
 * tres anteriores son decorativas: dos llamadas —reasignarse el caso ajeno y resolverlo— bastaban.
 *
 * La excepción de supervisión existe porque un analista que se va deja su caso bloqueado para
 * siempre, y se comprueba aquí que quede REGISTRADA: permitirla sin poder contarla después es lo
 * mismo que no tener la regla.
 */
describe('ManualReviewService — segregación de funciones', () => {
  const TENANT = 9n;
  const CASE = 77n;
  // `roles` va siempre: lo rellena `AuthenticationGuard` antes de que el servicio vea nada, y las
  // reglas de supervisión lo leen. Un fixture sin roles probaría un principal que no existe.
  const analista = {
    id: 'ana',
    requestId: 'req-1',
    roles: ['FRAUD_ANALYST'],
  } as AuthenticatedPrincipal;
  const otro = {
    id: 'beto',
    requestId: 'req-2',
    roles: ['FRAUD_ANALYST'],
  } as AuthenticatedPrincipal;
  const supervisora = {
    id: 'olga',
    requestId: 'req-3',
    roles: ['OPERATIONS'],
    authMethod: 'jwt',
  } as AuthenticatedPrincipal;
  // `PLATFORM_ADMIN` es un comodín global: vale sobre identidad firmada y NO sobre una clave de
  // API, que ningún humano custodia. Los dos principales de abajo sólo se diferencian en eso.
  const adminFirmada = {
    id: 'raiz',
    requestId: 'req-4',
    roles: ['PLATFORM_ADMIN', 'FRAUD_ANALYST'],
    authMethod: 'identity_provider',
  } as AuthenticatedPrincipal;
  const claveApiAdmin = {
    id: 'integracion',
    requestId: 'req-5',
    roles: ['PLATFORM_ADMIN', 'FRAUD_ANALYST'],
    authMethod: 'api_key',
  } as AuthenticatedPrincipal;

  function make(review: Record<string, unknown> | null) {
    const audited: string[] = [];
    const payloads: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const audit = {
      append: (input: { eventType: string; payload?: Record<string, unknown> }) => {
        audited.push(input.eventType);
        payloads.push(input.payload ?? {});
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
      payloads,
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

    it('sin `assignedTo` el caso queda a nombre de quien lo toma', async () => {
      // «Asignármelo» no nombra a nadie. Cuando el campo era obligatorio este gesto moría en un
      // 400 y el caso no se podía tomar desde la pantalla, con la cola entera inoperable detrás.
      const { service, updates } = make({ id: CASE, status: 'OPEN', assignedTo: null });
      await service.assign(TENANT, CASE, {} as AssignManualReviewDto, analista);
      expect(updates[0]).toMatchObject({ assignedTo: 'ana', status: 'ASSIGNED' });
    });

    it('un analista puede ceder su propio caso a un compañero', async () => {
      // Ceder ENTREGA la decisión, no se la apropia: no hay nada que proteger aquí.
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'beto' });
      await service.assign(TENANT, CASE, { assignedTo: 'ana' } as AssignManualReviewDto, otro);
      expect(updates[0]).toMatchObject({ assignedTo: 'ana' });
    });

    it('un analista NO puede quitarle el caso a otro y quedárselo', async () => {
      // Este es el atajo que dejaba en nada la segregación de `resolve()`: reasignarse el caso
      // ajeno y cerrarlo a continuación son dos llamadas que el rol de revisión ya permitía.
      const { service, audited } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'beto' });
      const error = await service
        .assign(TENANT, CASE, assignDto, analista)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGN_FORBIDDEN');
      expect((error as DomainException).status).toBe(403);
      expect(audited).toEqual([]);
    });

    it('supervisión sí puede reasignar el caso de otro, y consta de quién venía', async () => {
      // El caso del analista que se fue de vacaciones tiene que poder desatascarse. Y como la
      // escritura pisa `assignedTo`, si el asignado anterior no se guarda en la auditoría deja de
      // existir: «a quién se lo quitaron» pasa a ser una pregunta sin respuesta.
      const { service, updates, payloads } = make({
        id: CASE,
        status: 'ASSIGNED',
        assignedTo: 'beto',
      });
      await service.assign(TENANT, CASE, assignDto, supervisora);
      expect(updates[0]).toMatchObject({ assignedTo: 'ana' });
      expect(payloads[0]).toMatchObject({ assignedTo: 'ana', previousAssignee: 'beto' });
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
        assignedTo: 'ana',
        supervisorOverride: false,
      });
      expect(updates[0].resolvedAt).toBeInstanceOf(Date);
    });

    it('supervisión puede cerrar un caso ajeno y queda marcado como tal', async () => {
      // Sin `supervisorOverride` en la fila, un cierre por supervisión y uno normal se leen igual:
      // habría que ir a buscar a quién estaba asignado el caso, y esta misma escritura acaba de
      // sobrescribir ese dato. La excepción sólo es aceptable si después se puede contar.
      const { service, updates, audited } = make({
        id: CASE,
        status: 'ASSIGNED',
        assignedTo: 'ana',
      });
      await service.resolve(TENANT, CASE, resolveDto('APPROVE'), supervisora);
      expect(updates[0].resolutionJson).toMatchObject({
        resolvedBy: 'olga',
        assignedTo: 'ana',
        supervisorOverride: true,
      });
      expect(audited).toEqual(['MANUAL_REVIEW_RESOLVED']);
    });

    it('el comodín PLATFORM_ADMIN vale sobre identidad firmada', async () => {
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      await service.resolve(TENANT, CASE, resolveDto('APPROVE'), adminFirmada);
      expect(updates[0].resolutionJson).toMatchObject({ supervisorOverride: true });
    });

    it('el comodín PLATFORM_ADMIN NO vale sobre una clave de API', async () => {
      // `RolesGuard` se niega a honrar el comodín en una clave, así que la clave entra a la ruta
      // por `FRAUD_ANALYST` —un rol concreto— y aquí no puede recoger por la puerta de atrás la
      // supervisión que el guard le acaba de negar. Sin esta comprobación, la condición replicada
      // en el servicio se pierde en el primer refactor y nadie se entera.
      const { service } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), claveApiAdmin)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGNEE_MISMATCH');
      expect((error as DomainException).status).toBe(403);
    });
  });
});

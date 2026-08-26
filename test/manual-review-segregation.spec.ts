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
  /*
   * Los principales llevan su lista de roles, aunque esté vacía.
   *
   * Se escribían sin ella y el `as` la tapaba. `resolve()` la lee para decidir si quien llama puede
   * SUPERVISAR, así que sobre un principal sin lista lanzaba un `TypeError` antes de llegar al
   * control: la prueba de segregación recibía un error sin código y el propio control quedaba sin
   * ejercer. Un doble que no se parece al dato real no prueba nada — sólo que el `as` compila.
   */
  const analista = { id: 'ana', requestId: 'req-1', roles: [] } as unknown as AuthenticatedPrincipal;
  const otro = { id: 'beto', requestId: 'req-2', roles: [] } as unknown as AuthenticatedPrincipal;
  /** Quien puede desatascar la cola: operaciones, administración o plataforma. */
  const supervisora = {
    id: 'carla',
    requestId: 'req-3',
    roles: ['OPERATIONS'],
    authMethod: 'jwt',
  } as unknown as AuthenticatedPrincipal;
  /**
   * Una CLAVE DE API con el comodín global.
   *
   * `RolesGuard` se niega a honrar `PLATFORM_ADMIN` sobre una clave de API —ningún humano la
   * custodia— y este servicio tiene que negarse igual. Sin repetir la condición, una clave con el
   * comodín entraba por su rol concreto en la ruta y recogía la supervisión por el comodín, justo
   * lo que el guard acababa de negarle una capa más arriba.
   */
  const claveConComodin = {
    id: 'integracion',
    requestId: 'req-5',
    roles: ['PLATFORM_ADMIN', 'FRAUD_ANALYST'],
    authMethod: 'api_key',
  } as unknown as AuthenticatedPrincipal;
  /** Un principal SIN lista de roles: el que hacía estallar el control. */
  const sinRoles = { id: 'dani', requestId: 'req-4' } as unknown as AuthenticatedPrincipal;

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

    it('permite CEDER un caso que ya estaba asignado', async () => {
      /*
       * El comentario de esta prueba siempre dijo «un analista de baja tiene que poder ceder su
       * caso», y su cuerpo hacía lo contrario: Ana le QUITABA el caso a Beto. Escrita así fijaba
       * como correcto justo el camino que esquivaba la segregación —reasignarse el caso ajeno y
       * resolverlo—, y por eso el agujero podía convivir con la batería en verde.
       *
       * Ahora hace lo que dice: Beto cede SU caso a Ana. La intención era legítima; lo que estaba
       * mal era el sujeto.
       */
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'beto' });
      await service.assign(TENANT, CASE, assignDto, otro);
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

  describe('assign() · quitarle el caso a otro', () => {
    /*
     * Sin este control, la segregación de `resolve()` es DECORATIVA.
     *
     * Bastaban dos llamadas que cualquier rol de la ruta podía hacer: reasignarse el caso ajeno y
     * resolverlo a continuación. La prueba de «sólo el analista asignado puede resolver» seguía en
     * verde mientras el camino para esquivarla estaba abierto al lado.
     */
    it('un caso que ya es de otra persona NO lo mueve un par', async () => {
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      const error = await service
        .assign(TENANT, CASE, { assignedTo: 'beto' } as AssignManualReviewDto, otro)
        .catch((caught: unknown) => caught);

      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGN_FORBIDDEN');
      expect((error as DomainException).status).toBe(403);
      expect(updates).toEqual([]);
    });

    it('quien supervisa SÍ puede reasignarlo', async () => {
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });

      await service.assign(TENANT, CASE, { assignedTo: 'beto' } as AssignManualReviewDto, supervisora);

      expect(updates[0]?.assignedTo).toBe('beto');
    });

    it('CEDER el caso propio sigue abierto a cualquiera', async () => {
      /*
       * Lo que se prohíbe es QUITAR, no dar. Ceder el caso propio a un compañero entrega la
       * decisión en vez de apropiársela, así que no hay nada que proteger — y prohibirlo obligaría
       * a molestar a un supervisor para el gesto más normal de una cola.
       */
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });

      await service.assign(TENANT, CASE, { assignedTo: 'beto' } as AssignManualReviewDto, analista);

      expect(updates[0]?.assignedTo).toBe('beto');
    });

    it('un caso de NADIE lo toma cualquiera', async () => {
      const { service, updates } = make({ id: CASE, status: 'OPEN', assignedTo: null });

      await service.assign(TENANT, CASE, {} as AssignManualReviewDto, otro);

      expect(updates[0]?.assignedTo).toBe('beto');
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

    /*
     * La supervisión existe y NO tenía ni una prueba.
     *
     * Se añadió para que un caso asignado a quien se fue de vacaciones —o de la empresa— no quede
     * bloqueado para siempre con un cliente esperando al otro lado. Es una decisión razonable y es
     * también un DEBILITAMIENTO deliberado de la segregación de funciones: exactamente la clase de
     * regla que no puede vivir sin cobertura, porque el día que alguien amplíe `SUPERVISION_ROLES`
     * nada se pondrá rojo.
     */
    it('quien supervisa SÍ puede resolver un caso asignado a otra persona', async () => {
      const { service, updates } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });

      await service.resolve(TENANT, CASE, resolveDto('APPROVE'), supervisora);

      /*
       * El caso se cierra Y queda registrado quién decidió DE VERDAD: una resolución por
       * supervisión tiene que distinguirse de una del asignado con sólo mirar la fila. `assignedTo`
       * NO cambia — el caso siguió siendo de Ana; lo que cambió es quién lo cerró.
       */
      expect(updates[0]?.status).toBe('RESOLVED_APPROVED');
      expect(updates[0]?.resolutionJson).toMatchObject({ resolvedBy: 'carla' });
      expect(updates[0]?.assignedTo).toBe('ana');
    });

    it('un principal SIN lista de roles no supervisa: la regla estricta sigue en pie', async () => {
      /*
       * La lectura segura de un dato ausente. Antes esto no devolvía «no te toca»: estallaba con un
       * `TypeError` y subía como 500, que se lee como una avería y no como una negativa — y deja sin
       * ejercer el único control que impide que cualquiera cierre el caso de cualquiera.
       */
      const { service } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), sinRoles)
        .catch((caught: unknown) => caught);

      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGNEE_MISMATCH');
      expect((error as DomainException).status).toBe(403);
    });

    it('una CLAVE DE API con el comodín global no supervisa', async () => {
      /*
       * `PLATFORM_ADMIN` es comodín sólo sobre identidad firmada. Honrarlo aquí sobre una clave de
       * API le devolvería por la puerta de atrás el permiso que `RolesGuard` acaba de negarle.
       */
      const { service } = make({ id: CASE, status: 'ASSIGNED', assignedTo: 'ana' });
      const error = await service
        .resolve(TENANT, CASE, resolveDto('APPROVE'), claveConComodin)
        .catch((caught: unknown) => caught);

      expect((error as DomainException).code).toBe('MANUAL_REVIEW_ASSIGNEE_MISMATCH');
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

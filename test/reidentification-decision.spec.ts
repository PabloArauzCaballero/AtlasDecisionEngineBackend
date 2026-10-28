import { HttpStatus } from '@nestjs/common';
import { ReidentificationStatus } from '@prisma/client';
import { DomainException } from '../src/common/errors/domain-exception';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import { ReidentificationService } from '../src/modules/risk-governance/reidentification.service';

/**
 * El control de dos personas de la reidentificación leía el estado y escribía después sin
 * condición. Con dos decisiones simultáneas las dos veían `REQUESTED`, las dos escribían, y la
 * segunda pisaba a la primera —`decidedBy`, `decidedAt` y hasta el sentido—. La precondición ahora
 * va en el `WHERE` de la escritura. El doble de Prisma reproduce justo ese escenario: las dos
 * lecturas ocurren antes de cualquier escritura, y la escritura es atómica sobre el estado.
 */
interface Fila {
  id: bigint;
  tenantId: bigint;
  subjectId: bigint;
  requestedBy: string;
  status: ReidentificationStatus;
  decidedBy: string | null;
}

function montaje(fila: Fila) {
  const lecturas: Array<() => void> = [];
  const auditoria: string[] = [];
  const prisma = {
    reidentificationRequest: {
      // Ambas lecturas se resuelven ANTES de que ninguna escritura corra.
      findFirst: () =>
        new Promise<Fila>((resolve) => {
          const instantanea = { ...fila };
          lecturas.push(() => resolve(instantanea));
          if (lecturas.length === 2) lecturas.forEach((liberar) => liberar());
        }),
      updateMany: (args: {
        where: { id: bigint; tenantId: bigint; status: ReidentificationStatus };
        data: { status: ReidentificationStatus; decidedBy: string };
      }) => {
        const coincide =
          fila.id === args.where.id &&
          fila.tenantId === args.where.tenantId &&
          fila.status === args.where.status;
        if (coincide) {
          fila.status = args.data.status;
          fila.decidedBy = args.data.decidedBy;
        }
        return Promise.resolve({ count: coincide ? 1 : 0 });
      },
    },
  };
  const audit = {
    append: (evento: { eventType: string }) => {
      auditoria.push(evento.eventType);
      return Promise.resolve();
    },
  };
  const servicio = new ReidentificationService(prisma as never, audit as never, {} as never);
  return { servicio, auditoria };
}

const persona = (id: string): AuthenticatedPrincipal =>
  ({ id, tenantId: 1n, roles: [], audience: 'management', requestId: 'r' }) as never;

const fila = (): Fila => ({
  id: 5n,
  tenantId: 1n,
  subjectId: 9n,
  requestedBy: 'ana',
  status: ReidentificationStatus.REQUESTED,
  decidedBy: null,
});

describe('ReidentificationService.decideReidentification · decisión atómica', () => {
  it('con dos decisiones simultáneas gana una sola y la otra recibe 409', async () => {
    const datos = fila();
    const { servicio, auditoria } = montaje(datos);
    const resultados = await Promise.allSettled([
      servicio.decideReidentification(
        1n,
        { requestId: '5', approve: true } as never,
        persona('luis'),
      ),
      servicio.decideReidentification(
        1n,
        { requestId: '5', approve: false } as never,
        persona('marta'),
      ),
    ]);

    const aceptadas = resultados.filter((r) => r.status === 'fulfilled');
    const rechazadas = resultados.filter((r) => r.status === 'rejected');
    expect(aceptadas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);
    const error: unknown = rechazadas[0].reason;
    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({
      code: 'REIDENTIFICATION_ALREADY_DECIDED',
      status: HttpStatus.CONFLICT,
    });
    // La fila conserva a quien decidió primero y solo hay un evento de auditoría.
    expect(datos.decidedBy).toBe('luis');
    expect(datos.status).toBe(ReidentificationStatus.APPROVED);
    expect(auditoria).toEqual(['REIDENTIFICATION_APPROVED']);
  });

  it('quien pide no puede aprobar su propia solicitud', async () => {
    const datos = fila();
    const { servicio } = montaje(datos);
    // Una sola lectura: se libera con una segunda llamada inocua para no colgar el doble.
    const pendiente = servicio.decideReidentification(
      1n,
      { requestId: '5', approve: true } as never,
      persona('Ana'),
    );
    const otra = servicio
      .decideReidentification(1n, { requestId: '5', approve: false } as never, persona('luis'))
      .catch(() => undefined);
    await expect(pendiente).rejects.toMatchObject({ code: 'REIDENTIFICATION_SELF_APPROVAL' });
    await otra;
    expect(datos.decidedBy).not.toBe('Ana');
  });

  it('una solicitud ya decidida se rechaza sin escribir', async () => {
    const datos = { ...fila(), status: ReidentificationStatus.APPROVED, decidedBy: 'luis' };
    const { servicio, auditoria } = montaje(datos);
    const intentos = await Promise.allSettled([
      servicio.decideReidentification(
        1n,
        { requestId: '5', approve: false } as never,
        persona('marta'),
      ),
      servicio.decideReidentification(
        1n,
        { requestId: '5', approve: false } as never,
        persona('pedro'),
      ),
    ]);
    expect(intentos.every((r) => r.status === 'rejected')).toBe(true);
    expect(datos.decidedBy).toBe('luis');
    expect(auditoria).toEqual([]);
  });
});

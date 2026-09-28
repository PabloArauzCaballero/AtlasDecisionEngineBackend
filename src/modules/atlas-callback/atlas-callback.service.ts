/** Encola, en la transacción de quien resuelve, el aviso de vuelta a AtlasBackend. */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type AtlasCallbackRequestedPayload,
  DecisionEventType,
} from '../../common/events/event-types';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';

/** Lo que hace falta para avisar a AtlasBackend de una resolución humana. */
export interface AvisoAtlas {
  tenantId: bigint;
  /** Ruta de AtlasBackend, p. ej. `/internal/identity/manual-review-callback`. */
  ruta: string;
  /** Cuerpo JSON del aviso. Sólo valores planos: lo lee otro servicio y la auditoría. */
  cuerpo: Record<string, string | null>;
  /** Lo que se resolvió (`ManualReviewCase`, `BankStatementRun`) y su identificador. */
  aggregateType: string;
  aggregateId: string;
  actorId: string;
  correlationId?: string;
}

/**
 * La vuelta a AtlasBackend, escrita en el outbox y no enviada en línea.
 *
 * Hasta el 2026-09-27 el aviso se mandaba con un `fetch` justo después del commit, y si fallaba se
 * anotaba en la auditoría y ahí moría: nadie lo reintentaba, y el cliente se quedaba `IN_REVIEW` (o
 * la solicitud `under_review`) aunque la persona ya hubiera decidido. Bastaba con que AtlasBackend
 * estuviera desplegando en ese instante —medio minuto sin API— para perder la decisión.
 *
 * Ahora el aviso es una fila de `decision_outbox_event` que se escribe en la MISMA transacción que
 * la resolución: o quedan las dos o no queda ninguna. El relay la reparte al
 * {@link AtlasCallbackDispatcher}, que hace la llamada y, si falla, la devuelve al outbox con
 * retroceso exponencial hasta `OUTBOX_MAX_ATTEMPTS`; agotados, la fila queda `DEAD` y se cuenta en
 * `atlas_outbox_dead_total`. Es el mecanismo de reintentos que el motor ya tenía, no uno nuevo.
 *
 * Es el ÚNICO camino por el que el motor llama de vuelta a AtlasBackend: la revisión manual y la
 * revisión de extractos lo comparten, así que la forma de autenticarse, el plazo y la política de
 * reintentos no pueden divergir entre las dos.
 */
@Injectable()
export class AtlasCallbackService {
  constructor(private readonly outbox: OutboxPublisherService) {}

  async solicitar(tx: Prisma.TransactionClient, aviso: AvisoAtlas): Promise<void> {
    const payload: AtlasCallbackRequestedPayload = { route: aviso.ruta, body: aviso.cuerpo };
    await this.outbox.publish(tx, {
      eventType: DecisionEventType.ATLAS_CALLBACK_REQUESTED,
      tenantId: aviso.tenantId,
      aggregateType: aviso.aggregateType,
      aggregateId: aviso.aggregateId,
      actorId: aviso.actorId,
      correlationId: aviso.correlationId,
      payload: payload as unknown as Prisma.InputJsonValue,
    });
  }
}

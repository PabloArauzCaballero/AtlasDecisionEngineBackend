import { Injectable } from '@nestjs/common';
import { DecisionOutboxEvent, Prisma } from '@prisma/client';
import { JobName } from '../jobs/job-names';
import { JobSignalService } from '../jobs/job-signal.service';
import { MessagingTraceService } from '../observability/messaging-trace.service';
import { APP_ATTRIBUTES, MESSAGING_SYSTEM, SPAN_NAMES } from '../observability/telemetry.constants';
import { EventEnvelope } from './event-envelope';
import { persistableCarrier } from './trace-carrier';

/**
 * Writes a domain event into the transactional outbox.
 *
 * Deliberately mirrors AuditService.append's contract, with one difference: here the
 * caller's transaction is REQUIRED, not optional. An outbox row that commits while the
 * business change rolls back announces something that never happened; one that is lost
 * while the change commits breaks every downstream projection. Joining the caller's
 * transaction makes the change and its event atomic — the whole point of the pattern.
 * Delivery to consumers is the OutboxRelayService's job, outside this transaction.
 *
 * Además del INSERT, emite un `pg_notify` en la MISMA transacción para que el relay —que
 * vive en otro proceso— despierte en el commit en vez de descubrir la fila en su siguiente
 * sondeo. El aviso es una optimización de latencia, nunca la garantía de entrega: si se
 * pierde (reconexión de la escucha, un `pgbouncer` en modo transacción), la fila sigue
 * PENDING y el sondeo la reparte igual. Por eso el aviso puede ir dentro de la transacción
 * sin poner en riesgo la atomicidad: Postgres lo descarta con el rollback.
 */
@Injectable()
export class OutboxPublisherService {
  constructor(
    private readonly jobSignal: JobSignalService,
    private readonly messagingTrace: MessagingTraceService,
  ) {}

  async publish(
    tx: Prisma.TransactionClient,
    envelope: EventEnvelope,
  ): Promise<DecisionOutboxEvent> {
    return this.messagingTrace.runAsProducer(
      SPAN_NAMES.outboxPublish,
      {
        'messaging.system': MESSAGING_SYSTEM,
        'messaging.destination.name': 'decision_outbox_event',
        'messaging.operation.type': 'publish',
        [APP_ATTRIBUTES.module]: 'events',
        [APP_ATTRIBUTES.operation]: 'publish',
        [APP_ATTRIBUTES.eventType]: envelope.eventType,
        [APP_ATTRIBUTES.entityType]: envelope.aggregateType,
        [APP_ATTRIBUTES.tenantId]: envelope.tenantId.toString(),
      },
      async () => {
        const created = await tx.decisionOutboxEvent.create({
          data: {
            tenantId: envelope.tenantId,
            eventType: envelope.eventType,
            schemaVersion: envelope.schemaVersion ?? '1',
            aggregateType: envelope.aggregateType,
            aggregateId: envelope.aggregateId,
            actorId: envelope.actorId,
            correlationId: envelope.correlationId,
            causationId: envelope.causationId,
            payloadJson: envelope.payload,
            // El contexto de traza se captura DENTRO del span productor y viaja en su propia
            // columna, no dentro de `payloadJson`: ese JSON es el contrato que ven los
            // consumidores y contaminarlo con metadatos de transporte lo rompería en silencio.
            traceCarrier: persistableCarrier(this.messagingTrace.inject()),
          },
        });
        await this.jobSignal.notify(tx, JobName.OutboxRelay);
        return created;
      },
    );
  }
}

/**
 * Publicador por defecto: deja el evento en el registro estructurado (§41).
 *
 * Es la implementación honesta para un worker que aún no tiene bus propio: el hecho queda
 * registrado, con su identificador de correlación, y cualquier recolector de logs puede
 * derivarlo. Lo que NO hace es prometer entrega.
 *
 * Puentearlo al bus del anfitrión —`EventBus` del motor, un outbox, RabbitMQ— es implementar
 * `EventPublisherPort` en otra clase y cambiar una línea del módulo.
 *
 * No lanza nunca. Un bus caído no puede convertir un documento correcto en un fallo: el
 * archivo ya existe y quien lo pidió ya lo tiene.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { EventPublisherPort, PdfEvent } from '../../application/ports/event-publisher.port';
import { LOGGER_PORT, type LoggerPort } from '../../application/ports/runtime.ports';

@Injectable()
export class LoggingEventPublisherAdapter implements EventPublisherPort {
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  async publish(event: PdfEvent): Promise<void> {
    try {
      const fields: Record<string, unknown> = {
        event: event.event,
        documentId: event.documentId,
        templateId: event.templateId,
        templateVersion: event.templateVersion,
        correlationId: event.correlationId,
        requestedBy: event.requestedBy,
        occurredAt: event.occurredAt,
      };
      if (event.event === 'PDF_GENERATED') {
        fields.checksum = event.checksum;
        fields.sizeBytes = event.sizeBytes;
        fields.renderDurationMs = event.renderDurationMs;
        fields.storage = event.storage;
        this.logger.info('PDF_GENERATED', fields);
        return;
      }
      fields.errorCode = event.errorCode;
      fields.reason = event.reason;
      this.logger.warn('PDF_GENERATION_FAILED', fields);
    } catch {
      /* Publicar no puede ser la causa de que se pierda un documento ya generado. */
    }
  }
}

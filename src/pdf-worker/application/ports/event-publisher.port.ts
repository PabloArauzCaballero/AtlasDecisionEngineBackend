/**
 * Publicación de los hechos del generador (§41).
 *
 * Dos eventos y no más: el documento salió, o no salió. Se publican DESPUÉS de que el archivo
 * exista —y, si hay almacenamiento, después de guardarlo—, nunca antes: un `PDF_GENERATED`
 * emitido «optimistamente» convierte a cada consumidor en responsable de descubrir que el
 * archivo no está.
 *
 * El adaptador por defecto sólo registra. Puentearlo al bus del motor anfitrión es escribir
 * otra implementación de este puerto; ver `docs/pdf-worker/integracion.md`.
 */
export const PDF_EVENT_TYPES = ['PDF_GENERATED', 'PDF_GENERATION_FAILED'] as const;
export type PdfEventType = (typeof PDF_EVENT_TYPES)[number];

interface PdfEventBase {
  readonly event: PdfEventType;
  readonly documentId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly correlationId?: string;
  readonly requestedBy?: string;
  readonly occurredAt: string;
}

export interface PdfGeneratedEvent extends PdfEventBase {
  readonly event: 'PDF_GENERATED';
  readonly checksum: string;
  readonly sizeBytes: number;
  readonly renderDurationMs: number;
  readonly storage?: { readonly provider: string; readonly key: string };
}

export interface PdfGenerationFailedEvent extends PdfEventBase {
  readonly event: 'PDF_GENERATION_FAILED';
  readonly errorCode: string;
  /** Mensaje ya saneado. Nunca lleva el payload: puede contener datos personales (§33). */
  readonly reason: string;
}

export type PdfEvent = PdfGeneratedEvent | PdfGenerationFailedEvent;

export interface EventPublisherPort {
  /**
   * No debe lanzar. Un bus caído no puede convertir un documento correcto en un fallo: el
   * archivo ya existe y el llamante ya lo tiene. El fallo de publicación se registra y se
   * cuenta, que es lo que permite descubrirlo sin perder el documento.
   */
  publish(event: PdfEvent): Promise<void>;
}

export const EVENT_PUBLISHER_PORT = Symbol('EventPublisherPort');

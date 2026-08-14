/**
 * Procesamiento asíncrono (§17, §40).
 *
 * El dominio no conoce BullMQ, RabbitMQ ni Kafka. Conoce «encolar un trabajo» y «consumirlo»,
 * y el MISMO `GeneratePdfUseCase` atiende los dos modos: el controlador síncrono lo llama
 * directamente y el consumidor de la cola lo llama con el mismo comando. Esa es la garantía
 * que importa — si hubiese dos caminos, uno de los dos se quedaría atrás y el documento
 * saldría distinto según por dónde entrase la petición.
 *
 * El adaptador que se entrega es en memoria y acotado. No es un sustituto de una cola
 * durable, y lo dice: `docs/pdf-worker/integracion.md` explica qué se pierde en un reinicio y
 * cómo se cambia por BullMQ sin tocar ni un caso de uso.
 */
import type { GeneratePdfCommand } from '../dto/generate-pdf.command';

export interface PdfJob {
  readonly jobId: string;
  readonly command: GeneratePdfCommand;
  readonly enqueuedAt: string;
  readonly attempts: number;
}

export interface EnqueueResult {
  readonly jobId: string;
  readonly queuedAhead: number;
}

export interface QueueStats {
  readonly provider: string;
  readonly pending: number;
  readonly inFlight: number;
  readonly capacity: number;
}

export interface PdfJobQueuePort {
  readonly provider: string;
  enqueue(command: GeneratePdfCommand): Promise<EnqueueResult>;
  /**
   * Registra al consumidor. Sólo puede haber uno: dos manejadores sobre la misma cola en el
   * mismo proceso repartirían los trabajos en silencio, y el segundo parecería inactivo.
   */
  consume(handler: (job: PdfJob) => Promise<void>): void;
  stats(): QueueStats;
  /** Deja de aceptar trabajos y espera a los que están en vuelo. */
  drain(timeoutMs: number): Promise<void>;
}

export const PDF_JOB_QUEUE_PORT = Symbol('PdfJobQueuePort');

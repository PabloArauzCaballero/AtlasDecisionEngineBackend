/**
 * Cola en proceso, acotada (§17, §40).
 *
 * **Qué es y qué no.** Es una cola de verdad —acotada, con contrapresión, con drenaje ordenado
 * al apagar— pero vive en la memoria del proceso: un reinicio pierde lo pendiente y dos
 * réplicas no comparten nada. Se entrega así porque el valor de este archivo no es la
 * durabilidad, es tener el PUERTO ejercitado por algo real: el día que entre BullMQ, se escribe
 * otra clase con estos cinco métodos y no cambia ni un caso de uso.
 *
 * El tope de capacidad es la parte que no se puede omitir. Una cola sin límite en memoria no
 * es una cola, es una fuga: el productor sigue aceptando trabajos que el consumidor no da
 * abasto a procesar hasta que el proceso muere por memoria, y el fallo aparece como un OOM sin
 * relación aparente con los PDF.
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GeneratePdfCommand } from '../../application/dto/generate-pdf.command';
import type {
  EnqueueResult,
  PdfJob,
  PdfJobQueuePort,
  QueueStats,
} from '../../application/ports/job-queue.port';
import { RenderCapacityExceededError } from '../../domain/errors/pdf-worker.errors';

@Injectable()
export class InMemoryPdfQueueAdapter implements PdfJobQueuePort {
  readonly provider = 'in-memory';

  private readonly pending: PdfJob[] = [];
  private handler?: (job: PdfJob) => Promise<void>;
  private inFlight = 0;
  private draining = false;

  constructor(
    private readonly capacity = 200,
    private readonly concurrency = 1,
  ) {}

  async enqueue(command: GeneratePdfCommand): Promise<EnqueueResult> {
    if (this.draining) {
      throw new RenderCapacityExceededError(this.concurrency, 0);
    }
    if (this.pending.length >= this.capacity) {
      throw new RenderCapacityExceededError(this.capacity, 0);
    }
    const job: PdfJob = {
      jobId: randomUUID(),
      // El búfer NO viaja por la cola: un PDF de dos megas por mensaje la revienta, y el
      // consumidor va a persistirlo de todos modos.
      command: { ...command, options: { ...command.options, returnContent: false } },
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    };
    this.pending.push(job);
    const queuedAhead = this.pending.length - 1;
    this.pump();
    return { jobId: job.jobId, queuedAhead };
  }

  consume(handler: (job: PdfJob) => Promise<void>): void {
    if (this.handler) {
      // Dos manejadores sobre la misma cola se repartirían los trabajos en silencio y el
      // segundo parecería inactivo. Es un error de composición, no una configuración válida.
      throw new Error('La cola de PDF ya tiene un consumidor registrado.');
    }
    this.handler = handler;
    this.pump();
  }

  stats(): QueueStats {
    return {
      provider: this.provider,
      pending: this.pending.length,
      inFlight: this.inFlight,
      capacity: this.capacity,
    };
  }

  async drain(timeoutMs: number): Promise<void> {
    this.draining = true;
    const deadline = Date.now() + timeoutMs;
    while ((this.pending.length > 0 || this.inFlight > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Arranca tantos trabajos como carriles libres haya.
   *
   * Nunca `await`: `pump` la llaman `enqueue` y el final de cada trabajo, y esperar aquí
   * encadenaría los trabajos en serie por accidente.
   */
  private pump(): void {
    const handler = this.handler;
    if (!handler) return;
    while (this.inFlight < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) return;
      this.inFlight += 1;
      void handler(job)
        .catch(() => {
          /* El manejador ya registra, cuenta y publica el fallo; aquí sólo se libera el carril. */
        })
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
  }
}

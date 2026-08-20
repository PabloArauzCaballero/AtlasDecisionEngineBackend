/**
 * La cola del paquete, sustituida por la ejecución que ya está en curso.
 *
 * El paquete publicaba en pg-boss: el resolutor creaba el asset pendiente,
 * encolaba un trabajo y devolvía `QUEUED`, y otro proceso lo generaba más
 * tarde. Aquí ese segundo proceso ya existe y es quien está llamando: el worker
 * de fondo del motor reclamó una fila de `decision_audio_tts_run` y está dentro
 * de ella. Encolar otra vez metería el MISMO trabajo en dos colas —la del motor
 * y una segunda de pg-boss— con dos reintentos, dos arrendamientos y dos
 * formas distintas de rendirse.
 *
 * Así que este adaptador no encola: **anota** qué asset quedó pendiente para
 * que quien resolvió lo genere a continuación, dentro de la misma ejecución y
 * bajo el arrendamiento que ya sostiene. El núcleo no se entera —sigue viendo
 * un `AudioQueuePort` que acepta su publicación— y sigue devolviendo `QUEUED`,
 * que es la verdad: en ese instante el audio todavía no existe.
 *
 * Es de un solo uso, por ejecución. Compartir una instancia entre ejecuciones
 * mezclaría el asset pendiente de una con el de otra.
 */
import type {
  AudioGenerationJobPayload,
  AudioQueuePort,
  PublishResult,
} from '../core/domain/ports/audio-queue.port';

export class RunScopedAudioQueue implements AudioQueuePort {
  private pending: AudioGenerationJobPayload | null = null;

  /** El asset que el resolutor dejó pendiente, si dejó alguno. */
  get pendingJob(): AudioGenerationJobPayload | null {
    return this.pending;
  }

  async publish(payload: AudioGenerationJobPayload): Promise<PublishResult> {
    // El último gana, y no hay ninguno más: una resolución crea como mucho un
    // asset pendiente. Si algún día creara dos, esto perdería el primero, así
    // que se afirma aquí en vez de descubrirlo en producción.
    const duplicated = this.pending !== null && this.pending.assetId !== payload.assetId;
    this.pending = payload;
    return { jobId: null, deduplicated: duplicated };
  }

  /*
   * El resto del puerto no aplica: no hay proceso de cola que arrancar ni
   * parar, no hay consumidores que registrar —el consumidor es el worker de
   * fondo del motor— y la profundidad la publica el orquestador de trabajos
   * sobre `decision_audio_tts_run`, que es donde está de verdad la espera.
   *
   * Se implementan como no-operaciones y no lanzando: el núcleo llama a
   * `start()` al construirse, y hacerlo fallar convertiría una diferencia de
   * infraestructura en una caída del arranque.
   */
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async consume(): Promise<void> {}
  async consumeDeadLetter(): Promise<void> {}

  async depth(): Promise<{ queued: number; deadLetter: number }> {
    return { queued: this.pending ? 1 : 0, deadLetter: 0 };
  }
}

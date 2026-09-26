/**
 * Memoria de idempotencia en proceso (§31).
 *
 * **Lo que garantiza y lo que no**, dicho aquí porque un almacén de idempotencia que promete de
 * más es peor que no tenerlo: cubre el reenvío accidental y la carrera entre dos peticiones
 * simultáneas DENTRO de la misma réplica. No cubre dos réplicas, ni sobrevive a un reinicio.
 *
 * Para un despliegue con varias réplicas hay que sustituirlo por una implementación sobre
 * Redis o Postgres —el puerto son cuatro métodos y `docs/pdf-worker/integracion.md` da el
 * esbozo—. Se entrega éste porque tener el puerto ejercitado por algo real desde el principio
 * evita que la abstracción se descubra equivocada el día que hace falta.
 *
 * La purga es perezosa, al escribir. Un temporizador periódico mantendría vivo el bucle de
 * eventos de un proceso que sólo quiere apagarse.
 */
import { Injectable } from '@nestjs/common';
import type {
  IdempotencyStorePort,
  IdempotentOutcome,
} from '../../application/ports/idempotency-store.port';

interface Entry {
  readonly outcome?: IdempotentOutcome;
  /** Momento en que la entrada deja de valer, en milisegundos epoch. */
  readonly expiresAt: number;
  readonly leased: boolean;
}

@Injectable()
export class InMemoryIdempotencyStoreAdapter implements IdempotencyStorePort {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxEntries = 10_000) {}

  async get(key: string): Promise<IdempotentOutcome | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.outcome;
  }

  async put(key: string, outcome: IdempotentOutcome, ttlSeconds: number): Promise<void> {
    this.purge();
    this.entries.set(key, {
      outcome,
      expiresAt: Date.now() + ttlSeconds * 1_000,
      leased: false,
    });
  }

  /**
   * Reserva la clave si nadie la tiene.
   *
   * La reserva CADUCA sola. Sin caducidad, un proceso que muere a mitad de un render deja la
   * clave bloqueada para siempre y el reintento —que es justo lo que la idempotencia debe
   * permitir— se rechaza indefinidamente.
   */
  async acquire(key: string, leaseSeconds: number): Promise<boolean> {
    const existing = this.entries.get(key);
    const now = Date.now();
    if (existing && existing.expiresAt > now && existing.leased) return false;
    if (existing?.outcome && existing.expiresAt > now) return false;
    this.purge();
    this.entries.set(key, { expiresAt: now + leaseSeconds * 1_000, leased: true });
    return true;
  }

  /** Sólo libera la RESERVA. Si ya hay desenlace guardado, se conserva: es lo que se repone. */
  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry?.leased && !entry.outcome) this.entries.delete(key);
  }

  private purge(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Tope duro por si todo sigue vigente: se descarta lo más antiguo, que es lo que menos
    // probablemente se reintente.
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

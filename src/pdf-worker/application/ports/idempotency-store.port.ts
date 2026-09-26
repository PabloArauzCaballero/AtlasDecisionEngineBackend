/**
 * Memoria de peticiones ya atendidas (§31).
 *
 * El caso al que responde no es hipotético: en modo asíncrono, un reintento de la cola tras un
 * corte de red genera un SEGUNDO documento con otro `documentId` para el mismo hecho de
 * negocio, y el consumidor no tiene forma de saber cuál es el bueno.
 *
 * La clave que se guarda no es la que manda el cliente a secas: es `idempotencyKey` +
 * huella del template + huella del payload. Reutilizar la misma clave con datos distintos es
 * un error del llamante, y devolverle en silencio el documento viejo sería peor que fallar.
 */
export interface IdempotentOutcome {
  readonly documentId: string;
  readonly checksum: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly storageKey?: string;
  readonly storageProvider?: string;
}

export interface IdempotencyStorePort {
  get(key: string): Promise<IdempotentOutcome | undefined>;
  /** Guarda con expiración. Un almacén sin caducidad crece hasta que alguien lo apaga. */
  put(key: string, outcome: IdempotentOutcome, ttlSeconds: number): Promise<void>;
  /**
   * Reserva la clave para esta invocación. `false` = alguien la está atendiendo ahora mismo.
   *
   * Sin la reserva, dos peticiones simultáneas con la misma clave renderizan las dos y una
   * pisa a la otra: la idempotencia sólo cubriría el reenvío lento, que es el caso fácil.
   */
  acquire(key: string, leaseSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export const IDEMPOTENCY_STORE_PORT = Symbol('IdempotencyStorePort');

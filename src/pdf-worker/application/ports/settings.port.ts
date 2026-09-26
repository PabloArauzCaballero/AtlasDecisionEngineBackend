/**
 * Ajustes de ejecución que la aplicación necesita conocer.
 *
 * Es un puerto y no un `ConfigService` inyectado directamente por una razón práctica: los
 * casos de uso se prueban sin levantar Nest ni leer un `.env`, y la lista de abajo es
 * exactamente lo que hay que darles. Con `ConfigService` dentro, cada prueba tendría que
 * simular un contenedor de configuración entero para decidir un plazo de 30 segundos.
 *
 * De dónde salen los valores —variables de entorno validadas con Zod— es asunto de
 * `infrastructure/config`, que es quien también aborta el arranque si no cuadran (§38).
 */
export interface PdfWorkerSettings {
  readonly renderTimeoutMs: number;
  readonly renderConcurrency: number;
  /** Espera máxima por un carril libre antes de responder 429. */
  readonly renderQueueTimeoutMs: number;
  readonly storageEnabled: boolean;
  /** Persistir aunque la petición no lo pida. Falso por defecto: ver `DocumentStoragePort`. */
  readonly persistByDefault: boolean;
  readonly idempotencyTtlSeconds: number;
  readonly idempotencyLeaseSeconds: number;
  readonly defaultBrandId: string;
  readonly defaultLocale: string;
  readonly defaultTimezone: string;
  /** Techo del PDF devuelto en línea. Un informe desbocado no debe tumbar al llamante. */
  readonly maxDocumentBytes: number;
}

export const PDF_WORKER_SETTINGS = Symbol('PdfWorkerSettings');

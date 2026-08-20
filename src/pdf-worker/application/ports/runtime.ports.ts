/**
 * Los tres servicios transversales que un caso de uso necesita y que no son dominio: reloj,
 * registro y métricas.
 *
 * Van juntos porque son la misma clase de dependencia —infraestructura ambiental, sin estado
 * de negocio— y porque separarlos en tres archivos de doce líneas sólo añade importaciones.
 *
 * El reloj es un puerto y no `new Date()` por una razón concreta: `createdAt` acaba impreso en
 * el pie del documento y dentro del PDF. Con el reloj real no hay forma de escribir una
 * prueba que compare dos renders byte a byte, y sin esa prueba la regresión visual del §46 no
 * puede distinguir «cambió el diseño» de «pasó un segundo».
 */
export interface ClockPort {
  now(): Date;
}

export const CLOCK_PORT = Symbol('ClockPort');

export interface LogFields {
  readonly [key: string]: unknown;
}

/**
 * Registro estructurado. Nunca recibe el payload completo (§33): quien llama elige los
 * campos, y el adaptador vuelve a filtrar por si acaso.
 */
export interface LoggerPort {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export const LOGGER_PORT = Symbol('LoggerPort');

export interface GenerationMeasurement {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly renderer: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
}

export interface PdfMetricsPort {
  recordGenerated(measurement: GenerationMeasurement): void;
  recordFailure(templateId: string, errorCode: string): void;
  /** Tiempo que una petición esperó un carril libre o un turno en la cola (§34). */
  recordQueueWait(templateId: string, waitMs: number): void;
  setActiveRenders(active: number): void;
}

export const PDF_METRICS_PORT = Symbol('PdfMetricsPort');

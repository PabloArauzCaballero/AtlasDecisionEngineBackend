/**
 * Nombres de los trabajos de fondo, en un único sitio.
 *
 * Cada nombre es a la vez etiqueta de métrica, clave de registro en el orquestador y carga
 * útil del `pg_notify` que despierta al trabajo. El productor (que vive en un módulo de
 * dominio) y el consumidor (que vive en otro) tienen que coincidir exactamente en esa
 * cadena, y ninguno de los dos debería importar al otro solo para leerla: un módulo de
 * eventos que dependiera del módulo del relay invertiría la dirección de la dependencia.
 *
 * Cambiar un valor de aquí rompe paneles y alertas ya desplegados: es contrato, no detalle.
 */
export const JobName = {
  /** Reparte las filas del outbox transaccional al bus en proceso. */
  OutboxRelay: 'outbox-relay',
  /** Ejecuta las corridas de prueba encoladas. */
  TestRun: 'test-run',
  /** Purga las filas de idempotencia de runtime ya expiradas. */
  RuntimeRetention: 'runtime-retention',
} as const;

export type JobNameValue = (typeof JobName)[keyof typeof JobName];

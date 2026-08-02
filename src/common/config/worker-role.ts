/**
 * Lo mínimo que estas funciones necesitan leer. Se declara estructuralmente en vez de
 * depender de `ConfigService` para que un servicio pueda pasar el suyo sin arrastrar los
 * genéricos de @nestjs/config, y para que una prueba pueda pasar un objeto literal.
 */
export interface ConfigReader {
  get<T = string>(key: string): T | undefined;
}

/**
 * Reparto de responsabilidades entre procesos.
 *
 * El motor tiene tres trabajos de fondo —el relay del outbox, el worker de corridas de
 * prueba y la purga de idempotencia— que hasta ahora corrían dentro de CADA réplica de la
 * API. Los tres reclaman su trabajo de forma atómica (`FOR UPDATE SKIP LOCKED` + lease),
 * así que eso nunca fue incorrecto, pero sí impide operar el sistema:
 *
 * - No se puede escalar el plano de decisión sin multiplicar también la carga de fondo,
 *   que compite por el mismo pool de conexiones justo en las réplicas sensibles a latencia.
 * - Un lote de pruebas pesado degrada el p95 de las decisiones en línea, y no hay forma de
 *   separarlos salvo apagando el worker en todas partes.
 * - Apagarlo exigía coordinar tres variables de entorno distintas sin equivocarse.
 *
 * `WORKER_ROLE` fija el reparto en una sola decisión:
 *
 * | Rol      | Sirve HTTP | Corre trabajos de fondo | Para qué |
 * | -------- | ---------- | ----------------------- | -------- |
 * | `ALL`    | Sí         | Sí                      | Desarrollo y despliegues de un solo contenedor (valor por defecto: no cambia el comportamiento existente) |
 * | `API`    | Sí         | No                      | Réplicas de la API que solo deciden |
 * | `WORKER` | No         | Sí                      | Proceso dedicado (`dist/worker.js`), escalable aparte |
 *
 * Los interruptores por trabajo (`OUTBOX_RELAY_ENABLED`, …) siguen existiendo y se
 * combinan con Y lógico: el rol dice DÓNDE puede correr un trabajo, el interruptor dice
 * si ese trabajo está activo. Ninguno de los dos suplanta al otro.
 */
export const WORKER_ROLES = ['ALL', 'API', 'WORKER'] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

/** Rol configurado; `ALL` cuando no se declara, para no cambiar despliegues existentes. */
export function workerRoleOf(config: ConfigReader): WorkerRole {
  const raw = (config.get<string>('WORKER_ROLE') ?? 'ALL').trim().toUpperCase();
  return (WORKER_ROLES as readonly string[]).includes(raw) ? (raw as WorkerRole) : 'ALL';
}

/** ¿Debe este proceso ejecutar los trabajos de fondo (relay, worker de pruebas, purga)? */
export function runsBackgroundJobs(config: ConfigReader): boolean {
  return workerRoleOf(config) !== 'API';
}

/** ¿Debe este proceso atender tráfico HTTP de negocio? */
export function servesHttp(config: ConfigReader): boolean {
  return workerRoleOf(config) !== 'WORKER';
}

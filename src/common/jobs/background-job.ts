/**
 * Contrato de un trabajo de fondo.
 *
 * Un trabajo NO gestiona su propio temporizador. Declara qué hace en un lote y bajo qué
 * cadencia lo intentaría si nadie lo despierta; el {@link JobSchedulerService} decide
 * cuándo se ejecuta. Esa inversión es el motivo del cambio: con temporizadores propios,
 * cada trabajo sondeaba la base de datos a su ritmo aunque no hubiera nada que hacer, y
 * tres trabajos ociosos costaban miles de consultas al día sin producir nada.
 */
export interface BackgroundJob {
  /**
   * Nombre estable. Se usa como etiqueta de métrica y como canal de despertar por
   * `NOTIFY`, así que cambiarlo rompe paneles y productores: trátalo como contrato.
   */
  readonly name: string;

  /**
   * Canal de `pg_notify` que despierta este trabajo de inmediato. Por omisión, su
   * nombre. Un trabajo puramente periódico (una purga, por ejemplo) puede declararlo
   * `null` para no reaccionar a ninguna señal.
   */
  readonly wakeChannel?: string | null;

  /** Espera antes del primer intento, para no competir con el arranque. */
  readonly initialDelayMs?: number;

  /**
   * Cadencia mínima cuando el trabajo queda ocioso. Es el suelo del retroceso
   * adaptativo, no un intervalo fijo.
   */
  readonly minIdleIntervalMs?: number;

  /**
   * Techo del retroceso adaptativo. Un trabajo que se despierta por `NOTIFY` puede
   * permitirse un techo alto (el sondeo solo es la red de seguridad); uno periódico
   * fija aquí su intervalo real.
   */
  readonly maxIdleIntervalMs?: number;

  /**
   * Ejecuta UN lote y devuelve cuántas unidades de trabajo procesó.
   *
   * El valor de retorno es lo que gobierna la cadencia: `> 0` hace que el orquestador
   * vuelva a llamar en cuanto el bucle de eventos se lo permita (drenar una ráfaga no
   * debe costar un intervalo por lote) y `0` dispara el retroceso exponencial. Un
   * trabajo que devolviera siempre `1` convertiría el orquestador en un bucle ocupado.
   *
   * Debe ser reentrante entre procesos —varias réplicas lo ejecutan— pero el
   * orquestador garantiza que nunca hay dos ejecuciones simultáneas del mismo trabajo
   * dentro de un proceso.
   */
  runOnce(): Promise<number>;
}

/** Cadencia efectiva de un trabajo, ya resuelta contra los valores por defecto. */
export interface JobCadence {
  readonly initialDelayMs: number;
  readonly minIdleIntervalMs: number;
  readonly maxIdleIntervalMs: number;
}

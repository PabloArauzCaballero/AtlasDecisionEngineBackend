/**
 * Registro y telemetría del worker de locución, dirigidos a los del motor.
 *
 * El paquete traía un logger propio a stdout y un registro de Prometheus
 * propio, con su `/metrics`. Conservarlos habría dejado el sistema con dos
 * salidas de registro y dos endpoints de métricas, y un operador tendría que
 * saber en cuál mirar según qué worker le preocupa. Los dos puertos existían
 * justamente para poder sustituirlos, igual que en el worker semántico.
 */
import { Logger } from '@nestjs/common';
import type { MetricsService } from '../../../../common/observability/metrics.service';
import type { AudioLogContext, AudioLoggerPort } from '../core/domain/ports/audio-logger.port';
import {
  AUDIO_METRIC,
  type AudioMetricsPort,
  type MetricLabels,
} from '../core/domain/ports/audio-metrics.port';

/**
 * Adapta el logger del paquete al de Nest.
 *
 * `child()` acumula ataduras en vez de crear un logger nuevo por llamada: el
 * núcleo lo invoca por cada resolución, y un `new Logger()` por cada una
 * fabricaría un objeto por locución para no ganar nada.
 */
export class EngineAudioLogger implements AudioLoggerPort {
  private static readonly logger = new Logger('AudioTtsWorker');

  constructor(private readonly bindings: Record<string, unknown> = {}) {}

  debug(context: AudioLogContext): void {
    EngineAudioLogger.logger.debug(this.line(context));
  }

  info(context: AudioLogContext): void {
    EngineAudioLogger.logger.log(this.line(context));
  }

  warn(context: AudioLogContext): void {
    EngineAudioLogger.logger.warn(this.line(context));
  }

  error(context: AudioLogContext & { error?: unknown }): void {
    EngineAudioLogger.logger.error(this.line(context));
  }

  child(bindings: Record<string, unknown>): AudioLoggerPort {
    return new EngineAudioLogger({ ...this.bindings, ...bindings });
  }

  /**
   * Una línea legible con el evento delante.
   *
   * **El texto locutado no aparece nunca**, y no por casualidad: el núcleo no
   * lo pasa a ninguna llamada de registro. Lo que se escribe son códigos,
   * identificadores y duraciones. Un `error` se resume a su mensaje: volcar el
   * objeto entero de un fallo de proveedor arrastraría cabeceras y, con ellas,
   * la credencial.
   */
  private line(context: AudioLogContext & { error?: unknown }): string {
    const { event, error, ...rest } = context;
    const fields = { ...this.bindings, ...rest };
    const parts = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${String(value)}`);
    if (error !== undefined) {
      parts.push(`error=${error instanceof Error ? error.message : String(error)}`);
    }
    return parts.length ? `${event} ${parts.join(' ')}` : event;
  }
}

/**
 * Métricas del worker, traducidas al vocabulario del motor.
 *
 * **Ninguna etiqueta lleva identificadores ni texto libre.** Una etiqueta con
 * el `assetId` o con el mensaje del proveedor crea una serie temporal por valor
 * distinto y tumba al recolector mucho antes de que a nadie le sirva el
 * desglose. Lo que se etiqueta —desenlace, proveedor, código— es de cardinalidad
 * acotada por construcción.
 */
export class EngineAudioMetrics implements AudioMetricsPort {
  constructor(private readonly metrics: MetricsService) {}

  increment(metric: string, labels: MetricLabels = {}): void {
    switch (metric) {
      case AUDIO_METRIC.resolveTotal:
        // Una locución resuelta ES una decisión del motor sobre qué servir, y
        // verla en el mismo panel que las demás es más útil que darle un
        // contador propio que nadie mira.
        this.metrics.recordDecision('audio:resolve', String(labels.result ?? 'unknown'));
        return;
      case AUDIO_METRIC.cacheHitTotal:
        this.metrics.recordDecision('audio:cache-hit', String(labels.purpose ?? 'runtime'));
        return;
      case AUDIO_METRIC.generationTotal:
        this.metrics.recordDecision('audio:generation', String(labels.result ?? 'unknown'));
        return;
      case AUDIO_METRIC.budgetDenied:
        this.metrics.recordError(`AUDIO_DENIED_${String(labels.reason ?? 'UNKNOWN')}`);
        return;
      case AUDIO_METRIC.providerErrors:
        this.metrics.recordProviderFailure(
          `audio:${String(labels.provider ?? 'unknown')}`,
          String(labels.code ?? 'UNKNOWN'),
        );
        return;
      case AUDIO_METRIC.claimOutcome:
        // Sólo lo que significa un problema. `CLAIMED` es el caso normal y
        // contarlo aquí duplicaría lo que ya dice `generationTotal`.
        if (labels.outcome === 'EXHAUSTED' || labels.outcome === 'NOT_FOUND') {
          this.metrics.recordError(`AUDIO_CLAIM_${String(labels.outcome)}`);
        }
        return;
      default:
        return;
    }
  }

  observe(metric: string, value: number, labels: MetricLabels = {}): void {
    if (metric !== AUDIO_METRIC.generationDuration && metric !== AUDIO_METRIC.providerDuration) {
      return;
    }
    // El núcleo observa en segundos; el motor mide sus llamadas a servicio en
    // milisegundos. Publicar el número sin convertirlo pondría dos unidades
    // distintas en el mismo histograma.
    this.metrics.recordWorkerCall(
      'audio-tts',
      metric === AUDIO_METRIC.providerDuration ? 'provider' : 'generate',
      String(labels.provider ?? 'unknown'),
      value * 1_000,
    );
  }

  gauge(): void {
    // El estado del cortacircuitos y la profundidad de la cola ya los publica el
    // motor: el orquestador de trabajos emite `atlas_job_*` por cada trabajo
    // registrado, y este worker es uno de ellos. Un segundo indicador de lo
    // mismo, con otro nombre, obliga a decidir cuál se cree.
  }
}

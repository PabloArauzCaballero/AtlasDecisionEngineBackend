import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../../../common/observability/metrics.service';
import type {
  AnalysisMetricEvent,
  FailureMetricEvent,
  ProviderMetricEvent,
  QueueDepthSnapshot,
  SemanticMetricsRecorder,
} from '../core/application/ports';

/**
 * Telemetría del worker semántico, dirigida al recolector del motor.
 *
 * El paquete original traía su propio registro de Prometheus y su propio
 * `/metrics`. Conservarlo habría dejado el sistema con dos endpoints de
 * métricas y dos convenciones de nombres, y un operador tendría que saber en
 * cuál mirar según qué worker le preocupa. El puerto existía justamente para
 * poder sustituirlo.
 *
 * **Ninguna etiqueta lleva identificadores de usuario ni mensajes de error
 * completos.** Una etiqueta con el `tenantId` o con el texto del error crea una
 * serie temporal nueva por valor distinto, y eso tumba al recolector mucho
 * antes de que a nadie le sirva el desglose. Lo que sí se etiqueta es de
 * cardinalidad acotada: el estado, el nivel, el modelo y el código de error.
 */
@Injectable()
export class EngineSemanticMetricsRecorder implements SemanticMetricsRecorder {
  constructor(private readonly metrics: MetricsService) {}

  recordAnalysis(event: AnalysisMetricEvent): void {
    // Se reutiliza el contador de decisiones del motor: un análisis semántico
    // ES una decisión sobre un texto, y verlo en el mismo panel que las demás
    // es más útil que darle una métrica propia que nadie mira.
    this.metrics.recordDecision(
      `semantic:${event.tierUsed.toLowerCase()}${event.escalated ? ':escalated' : ''}`,
      event.status,
    );
  }

  recordProviderCall(event: ProviderMetricEvent): void {
    if (event.outcome === 'SUCCESS') return;
    // Sólo el fallo: el motor cuenta fallos de proveedor, no llamadas totales.
    // El modelo es de cardinalidad acotada (unos pocos por despliegue), así que
    // sirve como etiqueta; el número de intentos no, y va al log.
    this.metrics.recordProviderFailure(`semantic:${event.model}`, `tier:${event.tier}`);
  }

  recordFailure(event: FailureMetricEvent): void {
    // El código de error es estable y de cardinalidad acotada por construcción
    // (`toStableErrorCode` del núcleo). El `tenantId` del evento se ignora a
    // propósito: es justo la etiqueta que haría explotar la cardinalidad.
    this.metrics.recordError(`SEMANTIC_${event.errorCode}${event.retryable ? '_RETRYABLE' : ''}`);
  }

  recordQueueDepth(snapshot: QueueDepthSnapshot): void {
    // El motor ya publica la profundidad de cada trabajo a través del
    // orquestador (`atlas_job_*`), así que aquí sólo interesa lo que aquél no
    // sabe: cuántas ejecuciones quedaron muertas tras agotar reintentos.
    if (snapshot.deadLetter > 0) {
      this.metrics.recordError('SEMANTIC_DEAD_LETTER');
    }
  }
}

/**
 * Métricas Prometheus del generador (§34).
 *
 * Registro PROPIO (`new Registry()`), no el global de `prom-client`. Dos motivos concretos:
 * el worker vive dentro de un backend que ya tiene el suyo —registrar en el global provocaría
 * el error «metric already registered» al montar un segundo contexto en una prueba— y así el
 * anfitrión puede decidir si funde los dos con `Registry.merge` o los raspa por separado.
 *
 * Las etiquetas llevan `template` y `version`, no el `documentId`. Un identificador único por
 * documento como etiqueta produce una serie temporal nueva por cada PDF: es la forma clásica
 * de tumbar un Prometheus con explosión de cardinalidad.
 */
import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { GenerationMeasurement, PdfMetricsPort } from '../../application/ports/runtime.ports';

@Injectable()
export class PdfMetricsAdapter implements PdfMetricsPort {
  readonly registry = new Registry();

  private readonly generated = new Counter({
    name: 'pdf_generation_total',
    help: 'Documentos generados con éxito.',
    labelNames: ['template', 'version', 'renderer'],
    registers: [this.registry],
  });

  private readonly failed = new Counter({
    name: 'pdf_generation_failed_total',
    help: 'Generaciones fallidas por código de error de dominio.',
    labelNames: ['template', 'error_code'],
    registers: [this.registry],
  });

  /**
   * Cubos en milisegundos, densos donde vive el objetivo de servicio (bajo 2 s) y hasta el
   * plazo máximo configurable. Sin cubos por encima del plazo, todo lo que agota el reloj cae
   * en `+Inf` y el percentil 99 deja de distinguir «lento» de «se rindió».
   */
  private readonly duration = new Histogram({
    name: 'pdf_generation_duration_ms',
    help: 'Duración del renderizado, en milisegundos.',
    labelNames: ['template', 'version', 'renderer'],
    buckets: [100, 250, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000],
    registers: [this.registry],
  });

  private readonly size = new Histogram({
    name: 'pdf_generation_size_bytes',
    help: 'Tamaño del documento generado, en bytes.',
    labelNames: ['template', 'version'],
    buckets: [16_384, 65_536, 262_144, 1_048_576, 4_194_304, 16_777_216],
    registers: [this.registry],
  });

  private readonly queueWait = new Histogram({
    name: 'pdf_queue_wait_ms',
    help: 'Espera hasta obtener un carril de renderizado, en milisegundos.',
    labelNames: ['template'],
    buckets: [1, 10, 50, 200, 1_000, 5_000, 15_000],
    registers: [this.registry],
  });

  private readonly active = new Gauge({
    name: 'pdf_render_active',
    help: 'Renderizados en curso.',
    registers: [this.registry],
  });

  recordGenerated(measurement: GenerationMeasurement): void {
    const labels = {
      template: measurement.templateId,
      version: measurement.templateVersion,
      renderer: measurement.renderer,
    };
    this.generated.inc(labels);
    this.duration.observe(labels, measurement.durationMs);
    this.size.observe(
      { template: measurement.templateId, version: measurement.templateVersion },
      measurement.sizeBytes,
    );
  }

  recordFailure(templateId: string, errorCode: string): void {
    this.failed.inc({ template: templateId, error_code: errorCode });
  }

  recordQueueWait(templateId: string, waitMs: number): void {
    this.queueWait.observe({ template: templateId }, waitMs);
  }

  setActiveRenders(active: number): void {
    this.active.set(active);
  }

  /** Texto en formato de exposición, para que el anfitrión lo sirva donde quiera. */
  async renderPrometheus(): Promise<string> {
    return this.registry.metrics();
  }
}

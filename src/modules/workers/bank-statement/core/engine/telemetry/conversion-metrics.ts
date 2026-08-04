import { Injectable } from '@nestjs/common';
import type { StatementAnalysis } from '../statement-analysis';

export interface DurationStat {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface ConversionMetricsSnapshot {
  readonly conversions: number;
  /** Conversiones fallidas, por código de error. */
  readonly failures: Readonly<Record<string, number>>;
  readonly byStrategy: Readonly<Record<string, number>>;
  readonly byBand: Readonly<Record<string, number>>;
  readonly byDocumentType: Readonly<Record<string, number>>;
  readonly transactions: number;
  readonly pages: number;
  readonly ocrPages: number;
  readonly averageConfidence: number;
  /** Tiempos acumulados por etapa del pipeline. */
  readonly durations: Readonly<Record<string, DurationStat>>;
}

/**
 * Contadores en memoria de lo que pasa por el motor.
 *
 * Deliberadamente **en memoria y sin dependencias**: este módulo se embebe en
 * aplicaciones que ya tienen su propio sistema de métricas, y traer aquí un
 * cliente de Prometheus o de OpenTelemetry impondría esa elección al anfitrión.
 * Lo que se ofrece es la medición; publicarla es decisión de quien integra, que
 * lee `snapshot()` desde su propio endpoint o su propio exportador.
 *
 * No guarda nada del contenido bancario: solo cuentas, tiempos y códigos.
 */
@Injectable()
export class ConversionMetrics {
  private conversions = 0;
  private transactions = 0;
  private pages = 0;
  private ocrPages = 0;
  private confidenceTotal = 0;
  private readonly failures = new Map<string, number>();
  private readonly byStrategy = new Map<string, number>();
  private readonly byBand = new Map<string, number>();
  private readonly byDocumentType = new Map<string, number>();
  private readonly durations = new Map<string, DurationStat>();

  record(analysis: StatementAnalysis): void {
    this.conversions += 1;
    this.transactions += analysis.statement.transactions.length;
    this.pages += analysis.context.source.pageCount;
    this.ocrPages += analysis.ocrPages.length;
    this.confidenceTotal += analysis.quality.overallConfidence;
    increment(this.byStrategy, analysis.strategy.id);
    increment(this.byBand, analysis.quality.band);
    increment(this.byDocumentType, analysis.context.classification.documentType);
    for (const [stage, ms] of Object.entries(analysis.stageDurations)) {
      this.observe(stage, ms);
    }
    this.observe('total', analysis.durationMs);
  }

  recordFailure(code: string, durationMs: number): void {
    increment(this.failures, code);
    this.observe('fallida', durationMs);
  }

  snapshot(): ConversionMetricsSnapshot {
    return {
      conversions: this.conversions,
      failures: Object.fromEntries(this.failures),
      byStrategy: Object.fromEntries(this.byStrategy),
      byBand: Object.fromEntries(this.byBand),
      byDocumentType: Object.fromEntries(this.byDocumentType),
      transactions: this.transactions,
      pages: this.pages,
      ocrPages: this.ocrPages,
      averageConfidence:
        this.conversions === 0 ? 0 : Number((this.confidenceTotal / this.conversions).toFixed(2)),
      durations: Object.fromEntries(this.durations),
    };
  }

  reset(): void {
    this.conversions = 0;
    this.transactions = 0;
    this.pages = 0;
    this.ocrPages = 0;
    this.confidenceTotal = 0;
    this.failures.clear();
    this.byStrategy.clear();
    this.byBand.clear();
    this.byDocumentType.clear();
    this.durations.clear();
  }

  private observe(stage: string, ms: number): void {
    const previous = this.durations.get(stage);
    this.durations.set(stage, {
      count: (previous?.count ?? 0) + 1,
      totalMs: (previous?.totalMs ?? 0) + ms,
      maxMs: Math.max(previous?.maxMs ?? 0, ms),
    });
  }
}

function increment(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

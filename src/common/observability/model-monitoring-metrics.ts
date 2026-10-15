import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { MetricsRegistry } from './metrics-registry';

/**
 * Métricas del circuito de vigilancia del modelo: desenlaces observados, cobertura del circuito, tasa de malos, estabilidad poblacional e impacto adverso.
 */
@Injectable()
export class ModelMonitoringMetrics {
  /**
   * Desenlaces reales registrados, por etiqueta.
   *
   * Es la única métrica que dice si el lazo de retroalimentación está VIVO: un contador que
   * deja de crecer significa que nadie está observando resultados, y entonces todo lo demás
   * —tasa de malos, discriminación— describe una foto cada vez más vieja.
   */
  private readonly observedOutcomes = new Counter({
    name: 'atlas_model_observed_outcomes_total',
    help: 'Desenlaces reales de decisiones registrados, por etiqueta.',
    labelNames: ['label'],
    registers: [],
  });

  /** Tasa de malos sobre los aprobados con desenlace conocido, por versión de artefacto. */
  private readonly modelBadRate = new Gauge({
    name: 'atlas_model_bad_rate',
    help: 'Proporción de aprobaciones que salieron mal, por versión.',
    labelNames: ['artifact_version_id'],
    registers: [],
  });

  /**
   * Proporción de decisiones que llevan solicitante identificado, sobre las que deberían.
   *
   * Es el indicador del que cuelga todo lo demás. Una decisión sin sujeto no puede recibir
   * desenlace ni atender un derecho de acceso, y como la referencia se guarda en HMAC de una
   * vía, no se puede reparar después. Cuando esta métrica cae, lo que se está perdiendo es
   * irrecuperable, y por eso se vigila aquí y no en un informe mensual.
   */
  private readonly subjectCoverage = new Gauge({
    name: 'atlas_subject_coverage_ratio',
    help: 'Decisiones con solicitante identificado sobre las que deberían llevarlo.',
    registers: [],
  });

  /**
   * Ventanas de observación ya vencidas que alguien cerró, sobre el total de vencidas.
   *
   * El denominador es la aportación: antes existía el contador de desenlaces registrados y
   * nada contra qué dividirlo, así que un sistema de ingesta caído producía exactamente la
   * misma lectura que un mes sin incidencias.
   */
  private readonly outcomeCoverage = new Gauge({
    name: 'atlas_outcome_coverage_ratio',
    help: 'Ventanas de observación vencidas que fueron observadas.',
    registers: [],
  });

  /** Estabilidad poblacional por versión y variable; ≥ 0.25 es el corte de «inestable». */
  private readonly modelPsi = new Gauge({
    name: 'atlas_model_population_stability_index',
    help: 'Índice de estabilidad poblacional entre la ventana de referencia y la actual.',
    labelNames: ['artifact_version_id', 'variable_code'],
    registers: [],
  });

  /** Razón de impacto adverso por grupo; por debajo de 0.8 exige explicación (regla de 4/5). */
  private readonly adverseImpactRatio = new Gauge({
    name: 'atlas_model_adverse_impact_ratio',
    help: 'Tasa de aprobación de un grupo dividida por la del grupo de referencia.',
    labelNames: ['artifact_version_id', 'attribute', 'group_value'],
    registers: [],
  });

  constructor(shared: MetricsRegistry = new MetricsRegistry()) {
    shared.registry.registerMetric(this.observedOutcomes);
    shared.registry.registerMetric(this.modelBadRate);
    shared.registry.registerMetric(this.subjectCoverage);
    shared.registry.registerMetric(this.outcomeCoverage);
    shared.registry.registerMetric(this.modelPsi);
    shared.registry.registerMetric(this.adverseImpactRatio);
  }

  recordObservedOutcome(label: string): void {
    this.observedOutcomes.inc({ label: label || 'UNKNOWN' });
  }

  setSubjectCoverage(ratio: number): void {
    this.subjectCoverage.set(ratio);
  }

  setOutcomeCoverage(ratio: number): void {
    this.outcomeCoverage.set(ratio);
  }

  setModelBadRate(artifactVersionId: string, rate: number): void {
    this.modelBadRate.set({ artifact_version_id: artifactVersionId }, rate);
  }

  setModelPsi(artifactVersionId: string, variableCode: string, psi: number): void {
    this.modelPsi.set({ artifact_version_id: artifactVersionId, variable_code: variableCode }, psi);
  }

  setAdverseImpactRatio(
    artifactVersionId: string,
    attribute: string,
    groupValue: string,
    ratio: number,
  ): void {
    this.adverseImpactRatio.set(
      { artifact_version_id: artifactVersionId, attribute, group_value: groupValue },
      ratio,
    );
  }
}

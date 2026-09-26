export type MetricLabels = Record<string, string | number>;

/**
 * Puerto de métricas. Las etiquetas deben ser de baja cardinalidad:
 * nunca actorId, assetId ni mensajes de error completos.
 */
export interface AudioMetricsPort {
  increment(metric: string, labels?: MetricLabels, value?: number): void;
  observe(metric: string, value: number, labels?: MetricLabels): void;
  gauge(metric: string, value: number, labels?: MetricLabels): void;
}

export const AUDIO_METRIC = {
  resolveTotal: 'audio_resolve_total',
  cacheHitTotal: 'audio_cache_hit_total',
  generationDuration: 'audio_generation_duration_seconds',
  generationTotal: 'audio_generation_total',
  providerErrors: 'audio_provider_errors_total',
  providerDuration: 'audio_provider_duration_seconds',
  budgetReserved: 'audio_budget_reserved_units',
  budgetSettled: 'audio_budget_settled_units',
  budgetDenied: 'audio_budget_denied_total',
  queueDepth: 'audio_queue_depth',
  dlqDepth: 'audio_queue_dlq_depth',
  dlqReceived: 'audio_dlq_received_total',
  orphanedAssets: 'audio_assets_orphaned_total',
  circuitState: 'audio_circuit_state',
  claimOutcome: 'audio_claim_outcome_total',
} as const;

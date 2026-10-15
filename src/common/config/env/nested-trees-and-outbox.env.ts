import { z } from 'zod';
import { booleanFromString } from './helpers';

export const nestedTreesAndOutboxEnv = {
  // ---------------------------------------------------------------------
  // Nested decision trees (Fase 7), Code->Flow import (Fase 5), live
  // execution stream (Fase 8).
  // ---------------------------------------------------------------------
  NESTED_TREE_MAX_DEPTH: z.coerce.number().int().min(1).max(20).default(5),
  NESTED_TREE_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(50).max(60_000).default(2_000),
  /** Cota de aristas de la vista de dependencias; por encima se recorta y se declara. */
  NESTED_TREE_GRAPH_MAX_EDGES: z.coerce.number().int().min(10).max(50_000).default(2_000),
  NESTED_TREE_MAX_ARTIFACTS: z.coerce.number().int().min(1).max(500).default(25),
  NESTED_TREE_MAX_TOTAL_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
  NESTED_TREE_MAX_RESULT_BYTES: z.coerce.number().int().min(1_024).max(10_485_760).default(262_144),
  /** Bytes acumulados de resultados intermedios que puede retener una cadena (§9.3). */
  NESTED_TREE_MAX_RETAINED_BYTES: z.coerce
    .number()
    .int()
    .min(4_096)
    .max(67_108_864)
    .default(1_048_576),
  CODE_IMPORT_MAX_SOURCE_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(131_072),
  CODE_IMPORT_ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
  // Live preview is opt-in: it executes real non-PROD graphs but intentionally writes no
  // decision/audit/outbox record. Heartbeats keep proxies and the global timeout alive.
  LIVE_EXECUTION_STREAM_ENABLED: booleanFromString.default(false),
  LIVE_EXECUTION_STREAM_HEARTBEAT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(15_000),

  // Transactional outbox relay (event-driven backbone). The relay claims PENDING events
  // with a short lease and dispatches them to the in-process bus; disable only in tests
  // that drive dispatch manually or in replicas that must not run background workers.
  OUTBOX_RELAY_ENABLED: booleanFromString.default(true),
  // Suelo del sondeo del relay y base del backoff por evento fallido.
  OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  // Techo del retroceso con el outbox vacío. El productor anuncia cada fila con
  // `pg_notify` al confirmar, así que subir este techo no retrasa el reparto real.
  OUTBOX_RELAY_MAX_INTERVAL_MS: z.coerce.number().int().min(500).max(600_000).default(30_000),
  // Cada cuánto se cuenta la profundidad del outbox para el gauge. Contarla en cada ciclo
  // hacía que medir el backlog costara más que repartirlo.
  OUTBOX_BACKLOG_SAMPLE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
  // Failed dispatches back off exponentially via available_at; after this many attempts
  // the event is dead-lettered (status DEAD) for operator attention.
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
  // Claim lease: a relay replica that dies mid-batch frees its rows after this lapse.
  OUTBOX_LEASE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
};

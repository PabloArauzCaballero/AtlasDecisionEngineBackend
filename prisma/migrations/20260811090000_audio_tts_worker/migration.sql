-- Worker de locución (audio TTS), cuarto worker de ADR-0026.
--
-- Tabla de ejecuciones propia, como los otros tres, y por el mismo motivo que
-- se escribió en 20260804090000_additional_workers: la entrada es una PLANTILLA
-- con variables y el resultado es un audio cacheado, que no comparte forma con
-- un texto clasificado, un extracto normalizado ni una verificación de cara.
--
-- Lo que este worker añade sobre los otros tres es la CACHÉ: el resultado de
-- una locución no siempre se calcula, porque una frase ya locutada se sirve tal
-- cual. Por eso hay tres tablas más —plantillas, assets y contabilidad— y no
-- sólo una de ejecuciones.
--
-- No se toca ninguna tabla existente.

-- ---------------------------------------------------------------------------
-- Ejecuciones
-- ---------------------------------------------------------------------------

CREATE TABLE "decision_audio_tts_run" (
  "id"              BIGSERIAL           NOT NULL,
  "tenant_id"       BIGINT              NOT NULL,
  "request_id"      VARCHAR(64)         NOT NULL,
  "idempotency_key" VARCHAR(200)        NOT NULL,
  "status"          "WorkerRunStatus"   NOT NULL DEFAULT 'QUEUED',
  "progress"        INTEGER             NOT NULL DEFAULT 0,
  "input_source"    "WorkerInputSource" NOT NULL,
  "fixture_code"    VARCHAR(60),

  "template_code"   VARCHAR(160)        NOT NULL,
  "variables_json"  JSONB,
  "language"        VARCHAR(20),

  -- Desenlace del resolutor: READY, QUEUED, FALLBACK o UNAVAILABLE. Se proyecta
  -- fuera del JSON porque es lo que se agrupa para saber cuánta locución se
  -- está sirviendo de caché y cuánta cuesta dinero.
  "outcome"         VARCHAR(20),
  "asset_id"        UUID,
  "cache_hit"       BOOLEAN             NOT NULL DEFAULT false,

  "result_json"     JSONB,
  "warnings_json"   JSONB,
  "error_code"      VARCHAR(120),
  "error_message"   TEXT,

  "attempt_count"   INTEGER             NOT NULL DEFAULT 0,
  "lease_expires_at" TIMESTAMPTZ(6),
  "queued_at"       TIMESTAMPTZ(6)      NOT NULL DEFAULT now(),
  "started_at"      TIMESTAMPTZ(6),
  "finished_at"     TIMESTAMPTZ(6),

  "requested_by"    VARCHAR(160)        NOT NULL,
  "correlation_id"  VARCHAR(64)         NOT NULL,
  "trace_carrier"   JSONB,

  CONSTRAINT "decision_audio_tts_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_tts_run_progress_range"
    CHECK ("progress" >= 0 AND "progress" <= 100)
);

-- La idempotencia es un índice único y no una comprobación en el servicio: dos
-- peticiones simultáneas de la misma locución pasan las dos por un `SELECT` que
-- no ve nada, y acabarían pagando dos veces por el mismo audio.
CREATE UNIQUE INDEX "decision_audio_tts_run_tenant_idem_key"
  ON "decision_audio_tts_run" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "decision_audio_tts_run_tenant_request_key"
  ON "decision_audio_tts_run" ("tenant_id", "request_id");
CREATE INDEX "decision_audio_tts_run_status_queued_idx"
  ON "decision_audio_tts_run" ("status", "queued_at");
CREATE INDEX "decision_audio_tts_run_tenant_queued_idx"
  ON "decision_audio_tts_run" ("tenant_id", "queued_at");

-- ---------------------------------------------------------------------------
-- Catálogo y caché
-- ---------------------------------------------------------------------------

CREATE TYPE "AudioAssetStatus" AS ENUM (
  'PENDING', 'GENERATING', 'READY', 'FAILED_RETRYABLE', 'FAILED_PERMANENT'
);
CREATE TYPE "AudioTemplateStrategy" AS ENUM ('STATIC', 'DYNAMIC', 'FALLBACK');

CREATE TABLE "decision_audio_template" (
  "id"                     BIGSERIAL               NOT NULL,
  "tenant_id"              BIGINT                  NOT NULL,
  "code"                   VARCHAR(160)            NOT NULL,
  "version"                INTEGER                 NOT NULL DEFAULT 1,
  "strategy"               "AudioTemplateStrategy" NOT NULL,
  "template_text"          TEXT                    NOT NULL,
  "language"               VARCHAR(20),
  "fallback_template_code" VARCHAR(160),
  "is_active"              BOOLEAN                 NOT NULL DEFAULT true,
  "created_at"             TIMESTAMPTZ(6)          NOT NULL DEFAULT now(),
  "updated_at"             TIMESTAMPTZ(6)          NOT NULL DEFAULT now(),

  CONSTRAINT "decision_audio_template_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_template_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "decision_audio_template_tenant_code_key"
  ON "decision_audio_template" ("tenant_id", "code");

CREATE TABLE "decision_audio_asset" (
  "id"                      UUID               NOT NULL,
  "tenant_id"               BIGINT             NOT NULL,
  "asset_key"               CHAR(64)           NOT NULL,
  "template_code"           VARCHAR(160)       NOT NULL,
  "template_version"        INTEGER            NOT NULL,
  "status"                  "AudioAssetStatus" NOT NULL DEFAULT 'PENDING',
  "rendered_text_encrypted" TEXT               NOT NULL,

  "language"                VARCHAR(20)        NOT NULL,
  "provider"                VARCHAR(40)        NOT NULL,
  "provider_model"          VARCHAR(128)       NOT NULL,
  "provider_voice_ref"      VARCHAR(255)       NOT NULL,
  "voice_profile"           VARCHAR(100)       NOT NULL,
  "voice_version"           INTEGER            NOT NULL,
  "output_format"           VARCHAR(64)        NOT NULL,
  "sample_rate"             INTEGER            NOT NULL,

  "reserved_units"          INTEGER            NOT NULL DEFAULT 0,
  "attempts"                INTEGER            NOT NULL DEFAULT 0,
  "correlation_id"          VARCHAR(64),
  "claimed_at"              TIMESTAMPTZ(6),
  "claimed_by"              VARCHAR(120),

  "storage_uri"             TEXT,
  -- El audio, cuando el controlador de almacenamiento es la propia base (el del
  -- motor). No se borra al terminar: es la caché, y borrarla obligaría a pagar
  -- otra vez por la misma frase.
  "audio_bytes"             BYTEA,
  "mime_type"               VARCHAR(120),
  "checksum_sha256"         CHAR(64),
  "bytes"                   BIGINT,
  "last_error_code"         VARCHAR(120),

  "created_at"              TIMESTAMPTZ(6)     NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6)     NOT NULL DEFAULT now(),

  CONSTRAINT "decision_audio_asset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_asset_units_positive" CHECK ("reserved_units" >= 0),
  -- Un asset READY sin dónde leerlo es una promesa que la caché no puede
  -- cumplir: el resolutor lo daría por bueno y devolvería un URI vacío.
  CONSTRAINT "decision_audio_asset_ready_has_uri"
    CHECK ("status" <> 'READY' OR "storage_uri" IS NOT NULL)
);
CREATE UNIQUE INDEX "decision_audio_asset_tenant_key_key"
  ON "decision_audio_asset" ("tenant_id", "asset_key");
CREATE INDEX "decision_audio_asset_tenant_status_idx"
  ON "decision_audio_asset" ("tenant_id", "status");
CREATE INDEX "decision_audio_asset_tenant_template_idx"
  ON "decision_audio_asset" ("tenant_id", "template_code", "template_version");

CREATE TABLE "decision_audio_generation_usage" (
  "id"          BIGSERIAL      NOT NULL,
  "tenant_id"   BIGINT         NOT NULL,
  "asset_id"    UUID           NOT NULL,
  "provider"    VARCHAR(40)    NOT NULL,
  "usage_units" INTEGER        NOT NULL,
  "month_key"   VARCHAR(7)     NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "decision_audio_generation_usage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_generation_usage_units_positive" CHECK ("usage_units" >= 0)
);
-- Una fila por asset: liquidar dos veces la misma generación falsearía el mes.
CREATE UNIQUE INDEX "decision_audio_generation_usage_tenant_asset_key"
  ON "decision_audio_generation_usage" ("tenant_id", "asset_id");
CREATE INDEX "decision_audio_generation_usage_month_idx"
  ON "decision_audio_generation_usage" ("tenant_id", "provider", "month_key");

CREATE TABLE "decision_audio_budget_window" (
  "id"             BIGSERIAL      NOT NULL,
  "tenant_id"      BIGINT         NOT NULL,
  "provider"       VARCHAR(40)    NOT NULL,
  "month_key"      VARCHAR(7)     NOT NULL,
  "reserved_units" INTEGER        NOT NULL DEFAULT 0,
  "settled_units"  INTEGER        NOT NULL DEFAULT 0,
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "decision_audio_budget_window_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_budget_window_non_negative"
    CHECK ("reserved_units" >= 0 AND "settled_units" >= 0)
);
CREATE UNIQUE INDEX "decision_audio_budget_window_tenant_provider_month_key"
  ON "decision_audio_budget_window" ("tenant_id", "provider", "month_key");

CREATE TABLE "decision_audio_actor_generation_daily" (
  "id"               BIGSERIAL    NOT NULL,
  "tenant_id"        BIGINT       NOT NULL,
  "actor_id"         VARCHAR(160) NOT NULL,
  "day_key"          VARCHAR(10)  NOT NULL,
  "generation_count" INTEGER      NOT NULL DEFAULT 0,

  CONSTRAINT "decision_audio_actor_generation_daily_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_audio_actor_generation_daily_non_negative"
    CHECK ("generation_count" >= 0)
);
CREATE UNIQUE INDEX "decision_audio_actor_generation_daily_tenant_actor_day_key"
  ON "decision_audio_actor_generation_daily" ("tenant_id", "actor_id", "day_key");
CREATE INDEX "decision_audio_actor_generation_daily_day_idx"
  ON "decision_audio_actor_generation_daily" ("tenant_id", "day_key");

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Misma forma que las otras tablas de worker: la
-- política sólo exige el tenant cuando `app.tenant_id` está fijado, de modo que
-- migraciones, sondas de salud y el proceso worker —que reclama trabajo de
-- TODOS los tenants y por eso no fija la variable— siguen funcionando.
--
-- Se aplica también a las tres tablas de catálogo y contabilidad, no sólo a la
-- de ejecuciones: la caché guarda el audio ya compuesto CON las variables
-- dentro, y el presupuesto dice cuánto locutó cada organización.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tabla text;
BEGIN
  FOREACH tabla IN ARRAY ARRAY[
    'decision_audio_tts_run',
    'decision_audio_template',
    'decision_audio_asset',
    'decision_audio_generation_usage',
    'decision_audio_budget_window',
    'decision_audio_actor_generation_daily'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tabla);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (current_setting(''app.tenant_id'', true) IS NULL '
      '       OR tenant_id = current_setting(''app.tenant_id'', true)::bigint) '
      'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL '
      '       OR tenant_id = current_setting(''app.tenant_id'', true)::bigint)',
      tabla);
  END LOOP;
END $$;

-- Workers adicionales: análisis semántico y extractos bancarios (ADR-0026).
--
-- Dos tablas, no una genérica de jobs. Las entradas y los resultados de los dos
-- workers no se parecen en nada —texto libre contra un PDF binario, una
-- clasificación contra un estado de cuenta normalizado— y una tabla común
-- habría acabado con la mitad de las columnas nulas y un `payload_json` sin
-- forma que nadie puede indexar ni validar. Lo que sí es común (ciclo de vida,
-- lease, intentos, correlación) se escribe igual en las dos.
--
-- Ninguna tabla existente se toca: los tres trabajos de fondo actuales
-- (`outbox-relay`, `test-run`, `runtime-retention`) siguen exactamente igual.

CREATE TYPE "WorkerRunStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'SUCCEEDED_WITH_WARNINGS',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "WorkerInputSource" AS ENUM ('FIXTURE', 'UPLOAD', 'INLINE');

-- ---------------------------------------------------------------------------
-- Worker A — análisis semántico
-- ---------------------------------------------------------------------------

CREATE TABLE "decision_semantic_analysis_run" (
  "id"               BIGSERIAL         NOT NULL,
  "tenant_id"        BIGINT            NOT NULL,
  "request_id"       VARCHAR(64)       NOT NULL,
  "idempotency_key"  VARCHAR(200)      NOT NULL,
  "status"           "WorkerRunStatus" NOT NULL DEFAULT 'QUEUED',
  "progress"         INTEGER           NOT NULL DEFAULT 0,
  "input_source"     "WorkerInputSource" NOT NULL,
  "input_text"       TEXT              NOT NULL,
  "input_metadata"   JSONB,
  "fixture_code"     VARCHAR(60),
  "result_json"      JSONB,
  "warnings_json"    JSONB,
  "error_code"       VARCHAR(120),
  "error_message"    TEXT,
  "attempt_count"    INTEGER           NOT NULL DEFAULT 0,
  "lease_expires_at" TIMESTAMPTZ(6),
  "queued_at"        TIMESTAMPTZ(6)    NOT NULL DEFAULT now(),
  "started_at"       TIMESTAMPTZ(6),
  "finished_at"      TIMESTAMPTZ(6),
  "requested_by"     VARCHAR(160)      NOT NULL,
  "correlation_id"   VARCHAR(64)       NOT NULL,

  CONSTRAINT "decision_semantic_analysis_run_pkey" PRIMARY KEY ("id"),
  -- El progreso es un porcentaje. Sin esta restricción, un processor con un
  -- cálculo mal hecho pinta una barra al 340 % y nadie se entera hasta la demo.
  CONSTRAINT "decision_semantic_analysis_run_progress_range"
    CHECK ("progress" >= 0 AND "progress" <= 100)
);

-- La idempotencia es un índice único, no una comprobación en el servicio: dos
-- peticiones simultáneas con la misma clave pasan las dos por un `SELECT`
-- previo y crean dos ejecuciones. Aquí la segunda choca contra la base.
CREATE UNIQUE INDEX "decision_semantic_analysis_run_tenant_idem_key"
  ON "decision_semantic_analysis_run" ("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX "decision_semantic_analysis_run_tenant_request_key"
  ON "decision_semantic_analysis_run" ("tenant_id", "request_id");

-- El reclamo del worker ordena por (status, queued_at). Sin este índice cada
-- ciclo escanea la tabla entera para encontrar la fila más antigua en QUEUED,
-- y el coste crece con el histórico en vez de con la cola.
CREATE INDEX "decision_semantic_analysis_run_status_queued_idx"
  ON "decision_semantic_analysis_run" ("status", "queued_at");

CREATE INDEX "decision_semantic_analysis_run_tenant_queued_idx"
  ON "decision_semantic_analysis_run" ("tenant_id", "queued_at");

-- ---------------------------------------------------------------------------
-- Worker B — extractos bancarios
-- ---------------------------------------------------------------------------

CREATE TABLE "decision_bank_statement_run" (
  "id"                BIGSERIAL         NOT NULL,
  "tenant_id"         BIGINT            NOT NULL,
  "request_id"        VARCHAR(64)       NOT NULL,
  "status"            "WorkerRunStatus" NOT NULL DEFAULT 'QUEUED',
  "progress"          INTEGER           NOT NULL DEFAULT 0,
  "input_source"      "WorkerInputSource" NOT NULL,
  "fixture_code"      VARCHAR(60),
  "file_name"         VARCHAR(255)      NOT NULL,
  "file_hash"         CHAR(64)          NOT NULL,
  "file_size_bytes"   INTEGER           NOT NULL,
  -- El documento, mientras hace falta. Se borra en la misma transacción que
  -- cierra la ejecución: se conserva el resultado normalizado, no el extracto.
  "file_bytes"        BYTEA,
  "result_json"       JSONB,
  "warnings_json"     JSONB,
  "confidence"        DECIMAL(4,3),
  "institution_id"    VARCHAR(16),
  "transaction_count" INTEGER,
  "error_code"        VARCHAR(120),
  "error_message"     TEXT,
  "attempt_count"     INTEGER           NOT NULL DEFAULT 0,
  "lease_expires_at"  TIMESTAMPTZ(6),
  "queued_at"         TIMESTAMPTZ(6)    NOT NULL DEFAULT now(),
  "started_at"        TIMESTAMPTZ(6),
  "finished_at"       TIMESTAMPTZ(6),
  "requested_by"      VARCHAR(160)      NOT NULL,
  "correlation_id"    VARCHAR(64)       NOT NULL,

  CONSTRAINT "decision_bank_statement_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_bank_statement_run_progress_range"
    CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "decision_bank_statement_run_size_positive"
    CHECK ("file_size_bytes" > 0)
);

-- La huella del contenido es la identidad del documento: el nombre del archivo
-- no identifica nada (dos usuarios suben `extracto.pdf`) y el worker original
-- no traía ninguna clave de idempotencia.
CREATE UNIQUE INDEX "decision_bank_statement_run_tenant_hash_key"
  ON "decision_bank_statement_run" ("tenant_id", "file_hash");

CREATE UNIQUE INDEX "decision_bank_statement_run_tenant_request_key"
  ON "decision_bank_statement_run" ("tenant_id", "request_id");

CREATE INDEX "decision_bank_statement_run_status_queued_idx"
  ON "decision_bank_statement_run" ("status", "queued_at");

CREATE INDEX "decision_bank_statement_run_tenant_queued_idx"
  ON "decision_bank_statement_run" ("tenant_id", "queued_at");

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant
--
-- Misma forma que el resto de tablas con `tenant_id` desde
-- 20260719080000_tenant_rls_and_app_role: la política sólo exige el tenant
-- cuando `app.tenant_id` está fijado, de modo que migraciones, sondas de salud
-- y el proceso worker —que reclama trabajo de TODOS los tenants y por eso no
-- fija la variable— siguen funcionando.
-- ---------------------------------------------------------------------------

ALTER TABLE "decision_semantic_analysis_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_semantic_analysis_run" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_semantic_analysis_run";
CREATE POLICY tenant_isolation ON "decision_semantic_analysis_run"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

ALTER TABLE "decision_bank_statement_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_bank_statement_run" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_bank_statement_run";
CREATE POLICY tenant_isolation ON "decision_bank_statement_run"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

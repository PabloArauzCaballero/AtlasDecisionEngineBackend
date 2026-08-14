-- Worker de verificación de identidad (tercer worker de ADR-0026).
--
-- Tabla propia, no una fila más en una tabla genérica de trabajos, por el mismo
-- motivo que se escribió en 20260804090000_additional_workers: la entrada son
-- IMÁGENES y el resultado una decisión con su evidencia, que no comparte forma
-- con un texto clasificado ni con un extracto normalizado. Lo que sí es común
-- —ciclo de vida, lease, intentos, correlación— se escribe igual que en las
-- otras dos.
--
-- No se toca ninguna tabla existente: los dos workers anteriores y los tres
-- trabajos de fondo del motor siguen exactamente igual.

CREATE TABLE "decision_identity_verification_run" (
  "id"                  BIGSERIAL           NOT NULL,
  "tenant_id"           BIGINT              NOT NULL,
  "request_id"          VARCHAR(64)         NOT NULL,
  "status"              "WorkerRunStatus"   NOT NULL DEFAULT 'QUEUED',
  "progress"            INTEGER             NOT NULL DEFAULT 0,
  "input_source"        "WorkerInputSource" NOT NULL,
  "fixture_code"        VARCHAR(60),

  "input_hash"          CHAR(64)            NOT NULL,
  "document_country"    VARCHAR(2)          NOT NULL,
  "document_file_name"  VARCHAR(255)        NOT NULL,
  "selfie_file_name"    VARCHAR(255)        NOT NULL,
  "image_size_bytes"    INTEGER             NOT NULL,

  -- Las imágenes se borran en la misma actualización que cierra la ejecución.
  -- Lo que se conserva es la decisión y su evidencia, nunca la cara ni la
  -- cédula de nadie.
  "document_bytes"      BYTEA,
  "document_back_bytes" BYTEA,
  "selfie_bytes"        BYTEA,

  "result_json"         JSONB,
  "warnings_json"       JSONB,
  "decision"            VARCHAR(30),
  "document_type"       VARCHAR(30),
  "similarity_score"    DECIMAL(4,3),

  "error_code"          VARCHAR(120),
  "error_message"       TEXT,

  "attempt_count"       INTEGER             NOT NULL DEFAULT 0,
  "lease_expires_at"    TIMESTAMPTZ(6),
  "queued_at"           TIMESTAMPTZ(6)      NOT NULL DEFAULT now(),
  "started_at"          TIMESTAMPTZ(6),
  "finished_at"         TIMESTAMPTZ(6),

  "requested_by"        VARCHAR(160)        NOT NULL,
  "correlation_id"      VARCHAR(64)         NOT NULL,
  "trace_carrier"       JSONB,

  CONSTRAINT "decision_identity_verification_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "decision_identity_verification_run_progress_range"
    CHECK ("progress" >= 0 AND "progress" <= 100),
  CONSTRAINT "decision_identity_verification_run_size_positive"
    CHECK ("image_size_bytes" > 0),
  -- El parecido vive en [0,1] o no existe. `NULL` significa «no se pudo
  -- comparar», que NO es lo mismo que un cero: un cero afirmaría que son
  -- personas distintas.
  CONSTRAINT "decision_identity_verification_run_similarity_range"
    CHECK ("similarity_score" IS NULL OR ("similarity_score" >= 0 AND "similarity_score" <= 1))
);

-- La huella del contenido es la identidad de la solicitud. Es un índice único y
-- no una comprobación en el servicio: dos peticiones simultáneas con las mismas
-- fotos pasan las dos por un `SELECT` que no ve nada y crean dos ejecuciones.
CREATE UNIQUE INDEX "decision_identity_verification_run_tenant_hash_key"
  ON "decision_identity_verification_run" ("tenant_id", "input_hash");

CREATE UNIQUE INDEX "decision_identity_verification_run_tenant_request_key"
  ON "decision_identity_verification_run" ("tenant_id", "request_id");

CREATE INDEX "decision_identity_verification_run_status_queued_idx"
  ON "decision_identity_verification_run" ("status", "queued_at");

CREATE INDEX "decision_identity_verification_run_tenant_queued_idx"
  ON "decision_identity_verification_run" ("tenant_id", "queued_at");

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant. Misma forma que las otras dos tablas de worker: la
-- política sólo exige el tenant cuando `app.tenant_id` está fijado, de modo que
-- migraciones, sondas de salud y el proceso worker —que reclama trabajo de
-- TODOS los tenants y por eso no fija la variable— siguen funcionando.
-- ---------------------------------------------------------------------------

ALTER TABLE "decision_identity_verification_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_identity_verification_run" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_identity_verification_run";
CREATE POLICY tenant_isolation ON "decision_identity_verification_run"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

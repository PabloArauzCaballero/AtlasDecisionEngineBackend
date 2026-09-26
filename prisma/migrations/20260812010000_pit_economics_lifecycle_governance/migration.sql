-- Olas 3 a 6: fotografía temporal del dato, decisión económica, ciclo de vida y gobierno.
--
-- Continúa `20260811120000_subject_facility_and_monitoring_loop`, que cerró el circuito
-- (sujeto → crédito → desenlace). Esta migración añade las cuatro cosas que le faltaban al
-- circuito para servir a un negocio de microcrédito sostenido en el tiempo:
--
--   3. saber DE CUÁNDO era cada dato con el que se decidió, e imponer la frescura que ya se
--      declaraba y nadie comprobaba;
--   4. que la salida diga lo que significa económicamente, y poder calibrarla;
--   5. que exista la decisión que NO es originación —renovar, subir línea, cobrar— y el estado
--      de la cartera contra el que se decide;
--   6. que la base legal tenga vigencia por persona, que la reidentificación exista y cueste, y
--      que el expediente del modelo caduque.
--
-- ADITIVA. Ninguna columna existente cambia de significado. Todos los valores por omisión están
-- elegidos para que el comportamiento de hoy no cambie el día del despliegue: `DEGRADE` en
-- frescura, `NONE` en rol semántico, `ORIGINATION` en tipo de decisión, `enforced = false` en
-- límites. Endurecer es después, y es una decisión de negocio, no de migración.

CREATE TYPE "FreshnessPolicy" AS ENUM (
  'REJECT',
  'DEGRADE',
  'IGNORE'
);

CREATE TYPE "OutputSemanticRole" AS ENUM (
  'NONE',
  'PROBABILITY_OF_DEFAULT',
  'LOSS_GIVEN_DEFAULT',
  'EXPOSURE_AT_DEFAULT',
  'EXPECTED_LOSS',
  'RISK_GRADE',
  'PRICED_RATE',
  'APPROVED_LIMIT',
  'APPROVED_TERM'
);

CREATE TYPE "DecisionKind" AS ENUM (
  'ORIGINATION',
  'LIMIT_MANAGEMENT',
  'RENEWAL',
  'RESTRUCTURE',
  'COLLECTIONS',
  'EARLY_WARNING',
  'FRAUD_SCREENING',
  'OPERATIONAL'
);

CREATE TYPE "ReidentificationStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'CONSUMED'
);

-- ---------------------------------------------------------------------------
-- Ola 3. De cuándo era el dato, y qué pasa si llegó viejo.
--
-- `freshness_sla_seconds` se declaraba en `decision_variable_source` desde el primer día y no se
-- imponía en ninguna parte: una variable con SLA de 60 s se aceptaba con un valor de hace tres
-- días. Para microcrédito eso no es «menos preciso», es la respuesta a otra pregunta — el saldo,
-- la mora y el extracto cambian a diario.
--
-- Y sin `observed_at` la traza guardaba el valor callando su fecha, lo que rompe dos cosas a la
-- vez: reentrenar sobre ella filtra información del futuro, y defender la decisión ante un
-- supervisor dos años después es reconstruir de memoria.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_execution_variable"
  ADD COLUMN "observed_at"    TIMESTAMPTZ(6),
  ADD COLUMN "fetched_at"     TIMESTAMPTZ(6),
  ADD COLUMN "source_version" VARCHAR(60),
  ADD COLUMN "age_seconds"    INTEGER,
  ADD COLUMN "stale_accepted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "decision_artifact_variable_dependency"
  ADD COLUMN "freshness_policy" "FreshnessPolicy" NOT NULL DEFAULT 'DEGRADE';

ALTER TABLE "decision_execution"
  ADD COLUMN "degraded_inputs" BOOLEAN NOT NULL DEFAULT false;

-- Buscar las decisiones tomadas con datos viejos es la consulta natural de una revisión, y sin
-- índice obligaba a recorrer la tabla de ejecuciones entera.
CREATE INDEX "decision_execution_tenant_degraded_idx"
  ON "decision_execution"("tenant_id", "degraded_inputs", "executed_at");

-- ---------------------------------------------------------------------------
-- Ola 4. La salida dice lo que significa, y se puede calibrar.
--
-- `approved_credit_limit = ingreso * 0,35` es una regla, no una decisión. La decisión de
-- microcrédito es cuánto, a qué plazo y a qué precio, y esas tres se derivan de una probabilidad.
-- Que el rol sea declarado y no una convención de nombre permite validar el rango (una PD fuera
-- de [0,1] es un defecto) y que la calibración sepa qué columna mirar.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_output_contract_field"
  ADD COLUMN "semantic_role" "OutputSemanticRole" NOT NULL DEFAULT 'NONE';

CREATE TABLE "calibration_bucket" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "tenant_id"           BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "window_days"         INTEGER NOT NULL,
  "decile"              INTEGER NOT NULL,
  "predicted_rate"      DECIMAL(9,8) NOT NULL,
  "observed_rate"       DECIMAL(9,8) NOT NULL,
  "sample_size"         INTEGER NOT NULL,
  "computed_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "calibration_bucket_version_fk"
    FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE,
  CONSTRAINT "calibration_bucket_decile_range" CHECK ("decile" BETWEEN 1 AND 10),
  CONSTRAINT "calibration_bucket_window_positive" CHECK ("window_days" > 0)
);

CREATE UNIQUE INDEX "calibration_bucket_version_window_decile_key"
  ON "calibration_bucket"("artifact_version_id", "window_days", "decile");
CREATE INDEX "calibration_bucket_tenant_computed_idx"
  ON "calibration_bucket"("tenant_id", "computed_at");

-- ---------------------------------------------------------------------------
-- Ola 5. Existe la decisión que no es originación, y la cartera contra la que se decide.
--
-- En un negocio de microcrédito la mayoría de las decisiones —y casi todo el margen— están
-- después de la originación: renovar, subir la línea, refinanciar, a quién cobrar primero. El
-- motor sólo modelaba el instante inicial.
--
-- Y el límite de concentración vive aquí y no dentro de una regla del grafo por una razón que se
-- ve la primera vez que alguien clona un artefacto: la regla se copia, se edita y el límite
-- desaparece sin que nadie lo decida.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_artifact"
  ADD COLUMN "decision_kind" "DecisionKind" NOT NULL DEFAULT 'ORIGINATION';

CREATE TABLE "portfolio_state" (
  "id"          BIGSERIAL PRIMARY KEY,
  "tenant_id"   BIGINT NOT NULL,
  "as_of"       TIMESTAMPTZ(6) NOT NULL,
  "metric_code" VARCHAR(60) NOT NULL,
  "segment"     VARCHAR(120),
  "value"       DECIMAL(18,4) NOT NULL,
  "recorded_by" VARCHAR(160) NOT NULL
);

-- `NULLS NOT DISTINCT`: sin él, dos filas con `segment` nulo —«toda la cartera»— para la misma
-- métrica y fecha no colisionarían, y la conciliación diaria acabaría con el mismo hecho escrito
-- muchas veces. En PostgreSQL 15+ es la forma correcta de decir «nulo cuenta como valor».
CREATE UNIQUE INDEX "portfolio_state_tenant_asof_metric_segment_key"
  ON "portfolio_state"("tenant_id", "as_of", "metric_code", "segment") NULLS NOT DISTINCT;
CREATE INDEX "portfolio_state_tenant_metric_asof_idx"
  ON "portfolio_state"("tenant_id", "metric_code", "as_of");

CREATE TABLE "exposure_limit" (
  "id"            BIGSERIAL PRIMARY KEY,
  "tenant_id"     BIGINT NOT NULL,
  "limit_code"    VARCHAR(60) NOT NULL,
  "segment"       VARCHAR(120),
  "max_value"     DECIMAL(18,4) NOT NULL,
  "currency_code" VARCHAR(3) NOT NULL,
  "enforced"      BOOLEAN NOT NULL DEFAULT false,
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by"    VARCHAR(160) NOT NULL,
  CONSTRAINT "exposure_limit_max_positive" CHECK ("max_value" > 0)
);

CREATE UNIQUE INDEX "exposure_limit_tenant_code_segment_key"
  ON "exposure_limit"("tenant_id", "limit_code", "segment") NULLS NOT DISTINCT;
CREATE INDEX "exposure_limit_tenant_active_idx"
  ON "exposure_limit"("tenant_id", "is_active");

-- ---------------------------------------------------------------------------
-- Ola 6. La base legal tiene fecha, la reidentificación cuesta, el expediente caduca.
--
-- `processing_legal_basis` ya existía POR VERSIÓN: dice con qué amparo se diseñó la decisión.
-- Faltaba lo otro: leer el extracto de una persona concreta tiene un permiso con fecha, y decidir
-- con un dato cuyo permiso venció es una infracción aunque el dato siga en la caché.
--
-- Y el HMAC protege bien y estorba para operar. La salida no es aflojarlo —eso lo aflojaría para
-- todo— sino que el camino exista, pida dos personas distintas y quede escrito.
-- ---------------------------------------------------------------------------
CREATE TABLE "subject_consent" (
  "id"           BIGSERIAL PRIMARY KEY,
  "tenant_id"    BIGINT NOT NULL,
  "subject_id"   BIGINT NOT NULL,
  "purpose"      VARCHAR(120) NOT NULL,
  "basis"        "ProcessingLegalBasis" NOT NULL,
  "granted_at"   TIMESTAMPTZ(6) NOT NULL,
  "expires_at"   TIMESTAMPTZ(6),
  "revoked_at"   TIMESTAMPTZ(6),
  "evidence_ref" VARCHAR(200),
  "recorded_by"  VARCHAR(160) NOT NULL,
  CONSTRAINT "subject_consent_subject_fk"
    FOREIGN KEY ("subject_id") REFERENCES "decision_subject"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "subject_consent_tenant_subject_purpose_key"
  ON "subject_consent"("tenant_id", "subject_id", "purpose");
CREATE INDEX "subject_consent_tenant_expires_idx"
  ON "subject_consent"("tenant_id", "expires_at");

CREATE TABLE "reidentification_request" (
  "id"           BIGSERIAL PRIMARY KEY,
  "tenant_id"    BIGINT NOT NULL,
  "subject_id"   BIGINT NOT NULL,
  "purpose"      TEXT NOT NULL,
  "status"       "ReidentificationStatus" NOT NULL DEFAULT 'REQUESTED',
  "requested_by" VARCHAR(160) NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "decided_by"   VARCHAR(160),
  "decided_at"   TIMESTAMPTZ(6),
  "consumed_at"  TIMESTAMPTZ(6),
  CONSTRAINT "reidentification_request_subject_fk"
    FOREIGN KEY ("subject_id") REFERENCES "decision_subject"("id") ON DELETE CASCADE
);

CREATE INDEX "reidentification_request_tenant_status_idx"
  ON "reidentification_request"("tenant_id", "status", "requested_at");
CREATE INDEX "reidentification_request_tenant_subject_idx"
  ON "reidentification_request"("tenant_id", "subject_id");

ALTER TABLE "decision_artifact_version"
  ADD COLUMN "validated_by"          VARCHAR(160),
  ADD COLUMN "validated_at"          TIMESTAMPTZ(6),
  ADD COLUMN "revalidation_due_at"   TIMESTAMPTZ(6),
  ADD COLUMN "limitations_notes"     TEXT;

-- RLS con la misma forma que el resto del esquema (20260719080000_tenant_rls_and_app_role).
-- `subject_consent` y `reidentification_request` son especialmente sensibles: la primera dice qué
-- se puede tratar de cada persona, la segunda es el registro de quién quiso saber quién era.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'calibration_bucket',
    'portfolio_state',
    'exposure_limit',
    'subject_consent',
    'reidentification_request'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', target);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (current_setting(''app.tenant_id'', true) IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::bigint) WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::bigint)',
      target
    );
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "calibration_bucket",
      "portfolio_state",
      "exposure_limit",
      "subject_consent",
      "reidentification_request"
    TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "calibration_bucket_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "portfolio_state_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "exposure_limit_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "subject_consent_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "reidentification_request_id_seq" TO atlas_app;
  END IF;
END
$$;

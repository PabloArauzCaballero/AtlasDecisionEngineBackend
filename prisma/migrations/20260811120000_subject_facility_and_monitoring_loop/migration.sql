-- Cerrar el circuito de la decisión: sujeto, crédito, ventana de observación y vigilancia.
--
-- El motor sabía decidir y sabía gobernarse. No sabía dos cosas: QUIÉN tenía delante y SI
-- acertaba. Las piezas para lo segundo existían desde `20260808140000_model_monitoring`
-- (`decision_outcome_observation`, `decision_monitoring_attribute`) y estaban vacías, porque
-- lo primero era opcional: `subject_reference` nunca fue obligatorio, y sin sujeto no hay
-- historial que consultar, ni desenlace que atribuir, ni exposición que acumular.
--
-- Esta migración es ADITIVA. No cambia el significado de ninguna columna existente y no
-- reescribe evidencia: las ejecuciones ya escritas sin sujeto se quedan sin sujeto —el HMAC es
-- de una vía y no hay forma de reconstruir a quién pertenecían—, que es precisamente el motivo
-- de dejar de escribirlas así.

CREATE TYPE "SubjectReferencePolicy" AS ENUM (
  'REQUIRED',
  'WARN',
  'NOT_APPLICABLE'
);

CREATE TYPE "MonitoringVerdict" AS ENUM (
  'OK',
  'WATCH',
  'BREACH'
);

-- ---------------------------------------------------------------------------
-- 1. La exigencia de sujeto, por ambiente y por versión.
--
-- `WARN` para todos al migrar, y no `REQUIRED`: subir la exigencia de golpe rompería a todo
-- integrador vivo el día del despliegue. Primero se mide cuánto falta (la cobertura), después
-- se sube producción. Una migración de contrato que empieza por el final no se termina nunca,
-- porque el primer 400 en producción la revierte entera.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_environment"
  ADD COLUMN "subject_reference_policy" "SubjectReferencePolicy" NOT NULL DEFAULT 'WARN';

ALTER TABLE "decision_artifact_version"
  ADD COLUMN "subject_reference_policy"     "SubjectReferencePolicy",
  ADD COLUMN "subject_policy_justification" TEXT;

-- ---------------------------------------------------------------------------
-- 2. El solicitante como entidad, en seudónimo.
--
-- La clave sigue siendo el HMAC: esta tabla agrupa y cuenta, no reidentifica. Lo que aporta es
-- una fila que persiste entre ejecuciones, y por tanto un sitio donde colgar la exposición, el
-- comportamiento de pago y los límites por cliente. Sin ella, «la segunda decisión sobre la
-- misma persona» —que es de lo que vive el microcrédito— no tenía dónde apoyarse.
-- ---------------------------------------------------------------------------
CREATE TABLE "decision_subject" (
  "id"                     BIGSERIAL PRIMARY KEY,
  "tenant_id"              BIGINT NOT NULL,
  "subject_reference_hash" VARCHAR(128) NOT NULL,
  "first_seen_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_seen_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "decision_count"         INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "decision_subject_tenant_hash_key"
  ON "decision_subject"("tenant_id", "subject_reference_hash");
CREATE INDEX "decision_subject_tenant_last_seen_idx"
  ON "decision_subject"("tenant_id", "last_seen_at");

-- ---------------------------------------------------------------------------
-- 3. El crédito, que es a lo que pertenece un desenlace.
--
-- Un préstamo genera muchas decisiones a lo largo de su vida y el análisis de cosecha necesita
-- agrupar por préstamo, no por decisión: contando decisiones, quien más veces fue evaluado
-- pesa más en la tasa de malos, que es exactamente al revés de lo que se quiere medir.
--
-- `external_reference` es el identificador en el sistema de cartera. Es la costura por la que
-- entra el desenlace desde el core y por eso es única por tenant.
-- ---------------------------------------------------------------------------
CREATE TABLE "credit_facility" (
  "id"                       BIGSERIAL PRIMARY KEY,
  "tenant_id"                BIGINT NOT NULL,
  "subject_id"               BIGINT NOT NULL,
  "external_reference"       VARCHAR(160) NOT NULL,
  "origination_execution_id" BIGINT,
  "principal_amount"         DECIMAL(18,4) NOT NULL,
  "currency_code"            VARCHAR(3) NOT NULL,
  "term_months"              INTEGER NOT NULL,
  "annual_rate"              DECIMAL(9,6) NOT NULL,
  "disbursed_at"             TIMESTAMPTZ(6),
  "closed_at"                TIMESTAMPTZ(6),
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "credit_facility_subject_fk"
    FOREIGN KEY ("subject_id") REFERENCES "decision_subject"("id") ON DELETE RESTRICT,
  CONSTRAINT "credit_facility_term_positive" CHECK ("term_months" > 0),
  CONSTRAINT "credit_facility_principal_positive" CHECK ("principal_amount" > 0)
);

CREATE UNIQUE INDEX "credit_facility_tenant_external_key"
  ON "credit_facility"("tenant_id", "external_reference");
CREATE INDEX "credit_facility_tenant_subject_idx"
  ON "credit_facility"("tenant_id", "subject_id");
CREATE INDEX "credit_facility_tenant_disbursed_idx"
  ON "credit_facility"("tenant_id", "disbursed_at");

-- ---------------------------------------------------------------------------
-- 4. La ejecución apunta al sujeto ya resuelto.
--
-- La columna HMAC se conserva y no se sustituye: es la que responde a una solicitud de titular
-- sin tocar `decision_subject`, y es la única que tienen las ejecuciones anteriores a hoy.
--
-- `subject_absence_reason` distingue «el integrador no lo mandó» de «esta decisión no tiene
-- sujeto». Sin esa distinción la cobertura mentiría en las dos direcciones: contaría como
-- fallo las reglas de sistema, y escondería a los integradores que no migraron.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_execution"
  ADD COLUMN "subject_id"             BIGINT,
  ADD COLUMN "subject_absence_reason" "SubjectReferencePolicy";

ALTER TABLE "decision_execution"
  ADD CONSTRAINT "decision_execution_subject_fk"
    FOREIGN KEY ("subject_id") REFERENCES "decision_subject"("id") ON DELETE SET NULL;

CREATE INDEX "decision_execution_tenant_subject_executed_idx"
  ON "decision_execution"("tenant_id", "subject_id", "executed_at");

-- ---------------------------------------------------------------------------
-- 5. Las ventanas de observación, materializadas al decidir.
--
-- Es la pieza que le da DENOMINADOR a la cobertura. Antes existía el numerador —las
-- observaciones registradas— y nada contra qué dividirlo, así que «no hay desenlaces» y «nadie
-- los cargó» se leían igual: cero filas. Con la ventana programada por adelantado, la que
-- vence sin que nadie la observe aparece en una cola de trabajo en vez de desaparecer.
-- ---------------------------------------------------------------------------
CREATE TABLE "outcome_window_schedule" (
  "id"           BIGSERIAL PRIMARY KEY,
  "tenant_id"    BIGINT NOT NULL,
  "execution_id" BIGINT NOT NULL,
  "facility_id"  BIGINT,
  "window_days"  INTEGER NOT NULL,
  "due_at"       TIMESTAMPTZ(6) NOT NULL,
  "observed_at"  TIMESTAMPTZ(6),
  CONSTRAINT "outcome_window_schedule_execution_fk"
    FOREIGN KEY ("execution_id") REFERENCES "decision_execution"("id") ON DELETE CASCADE,
  CONSTRAINT "outcome_window_schedule_facility_fk"
    FOREIGN KEY ("facility_id") REFERENCES "credit_facility"("id") ON DELETE SET NULL,
  CONSTRAINT "outcome_window_schedule_window_positive" CHECK ("window_days" > 0)
);

CREATE UNIQUE INDEX "outcome_window_schedule_execution_window_key"
  ON "outcome_window_schedule"("execution_id", "window_days");
CREATE INDEX "outcome_window_schedule_tenant_due_idx"
  ON "outcome_window_schedule"("tenant_id", "due_at", "observed_at");

-- ---------------------------------------------------------------------------
-- 6. El desenlace se ata al crédito y declara si fue observado o inferido.
--
-- Un desenlace inferido sobre un rechazado (`reject inference`) mezclado con los observados
-- calibra el modelo contra la población que ya aprobó y lo hace parecer perfecto. Se guardan
-- en la misma tabla —son el mismo hecho— y se cuentan aparte. `inference_method` nulo
-- significa observado.
-- ---------------------------------------------------------------------------
ALTER TABLE "decision_outcome_observation"
  ADD COLUMN "facility_id"      BIGINT,
  ADD COLUMN "inference_method" VARCHAR(60);

ALTER TABLE "decision_outcome_observation"
  ADD CONSTRAINT "decision_outcome_observation_facility_fk"
    FOREIGN KEY ("facility_id") REFERENCES "credit_facility"("id") ON DELETE SET NULL;

CREATE INDEX "decision_outcome_observation_tenant_facility_idx"
  ON "decision_outcome_observation"("tenant_id", "facility_id");

-- ---------------------------------------------------------------------------
-- 7. Vigilancia: línea base congelada y evaluaciones persistidas.
--
-- La referencia del índice de estabilidad se congela al PROMOVER, no se toma «del mes pasado»:
-- una referencia móvil deriva junto con la población y deja el índice plano mientras el modelo
-- se aleja del mundo — la deriva lenta, que es la que de verdad hace daño, no se detectaría
-- nunca.
--
-- Y las evaluaciones se guardan porque el motor ya sabía calcularlas bajo demanda y nadie las
-- pedía. Una serie persistida dice además algo que un cálculo al vuelo no puede decir: que la
-- vigilancia MISMA se detuvo.
-- ---------------------------------------------------------------------------
CREATE TABLE "monitoring_baseline" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "tenant_id"           BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "variable_code"       VARCHAR(120) NOT NULL,
  "buckets_json"        JSONB NOT NULL,
  "sample_size"         INTEGER NOT NULL,
  "captured_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "captured_by"         VARCHAR(160) NOT NULL,
  CONSTRAINT "monitoring_baseline_version_fk"
    FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "monitoring_baseline_version_variable_key"
  ON "monitoring_baseline"("artifact_version_id", "variable_code");
CREATE INDEX "monitoring_baseline_tenant_captured_idx"
  ON "monitoring_baseline"("tenant_id", "captured_at");

CREATE TABLE "monitoring_evaluation" (
  "id"                  BIGSERIAL PRIMARY KEY,
  "tenant_id"           BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "metric_code"         VARCHAR(60) NOT NULL,
  "scope"               VARCHAR(120) NOT NULL,
  "value"               DECIMAL(18,8) NOT NULL,
  "threshold"           DECIMAL(18,8) NOT NULL,
  "verdict"             "MonitoringVerdict" NOT NULL,
  "sample_size"         INTEGER NOT NULL,
  "details_json"        JSONB,
  "evaluated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "monitoring_evaluation_version_fk"
    FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE
);

CREATE INDEX "monitoring_evaluation_tenant_version_metric_idx"
  ON "monitoring_evaluation"("tenant_id", "artifact_version_id", "metric_code", "evaluated_at");
CREATE INDEX "monitoring_evaluation_tenant_verdict_idx"
  ON "monitoring_evaluation"("tenant_id", "verdict", "evaluated_at");

-- RLS con la misma forma que el resto del esquema (20260719080000_tenant_rls_and_app_role).
-- Aquí importa especialmente: `decision_subject` y `credit_facility` son la cartera de un
-- cliente del motor, y `monitoring_evaluation` es su desempeño real.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'decision_subject',
    'credit_facility',
    'outcome_window_schedule',
    'monitoring_baseline',
    'monitoring_evaluation'
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
      "decision_subject",
      "credit_facility",
      "outcome_window_schedule",
      "monitoring_baseline",
      "monitoring_evaluation"
    TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "decision_subject_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "credit_facility_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "outcome_window_schedule_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "monitoring_baseline_id_seq" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "monitoring_evaluation_id_seq" TO atlas_app;
  END IF;
END
$$;

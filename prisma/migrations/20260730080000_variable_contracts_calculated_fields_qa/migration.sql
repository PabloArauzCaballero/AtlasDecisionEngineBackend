-- Fase 1/3/4/6 de la ampliación de contratos:
--   §1  taxonomía formal de variables (sensibilidad, ciclo de vida, restricciones,
--       ejemplos, mensajes de error, origen esperado, versión de contrato)
--   §2  variables INTERMEDIATE con ciclo de vida acotado a una ejecución
--   §4  contrato de salida explícito por artefacto (origen, mapeo, motivos de ausencia)
--   §5/§6/§7 campos calculados reutilizables y registro de librerías autorizadas
--   §10 QA Lab: corridas generativas reproducibles y contraejemplos mínimos
--
-- Escrita a mano (no por `migrate diff`) porque el datamodel de Prisma no describe las
-- claves foráneas ni las vistas creadas por migraciones SQL previas; un diff automático
-- las habría eliminado.

-- CreateEnum
CREATE TYPE "SensitivityClass" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'PII', 'SENSITIVE_PII', 'SECRET');
CREATE TYPE "VariableLifecycleState" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED');
CREATE TYPE "IntermediateUpdatePolicy" AS ENUM ('SINGLE_WRITE', 'OVERWRITE', 'ACCUMULATE');
CREATE TYPE "TracePolicy" AS ENUM ('FULL', 'MASKED', 'REDACTED', 'EXCLUDED');
CREATE TYPE "OutputSourceKind" AS ENUM ('NODE', 'EXPRESSION', 'INTERMEDIATE', 'CONSTANT', 'REFERENCE');
CREATE TYPE "CalculatedFieldStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'RETIRED');
CREATE TYPE "CalculatedFieldImplKind" AS ENUM ('OPERATION', 'JAVASCRIPT', 'PYTHON');
CREATE TYPE "ApprovedLibraryStatus" AS ENUM ('APPROVED', 'RESTRICTED', 'BLOCKED');
CREATE TYPE "QaRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- §1.1 — Taxonomía formal en el catálogo de variables.
ALTER TABLE "decision_variable_definition"
  ADD COLUMN "sensitivity_class" "SensitivityClass" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "lifecycle_state" "VariableLifecycleState" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "contract_version" VARCHAR(20) NOT NULL DEFAULT '1',
  ADD COLUMN "metadata_json" JSONB;

-- Las variables ya marcadas como sensibles arrancan clasificadas como PII, no INTERNAL:
-- degradarlas silenciosamente habría relajado el enmascaramiento existente.
UPDATE "decision_variable_definition" SET "sensitivity_class" = 'PII' WHERE "is_sensitive" = true;
UPDATE "decision_variable_definition" SET "lifecycle_state" = 'RETIRED' WHERE "is_active" = false;

CREATE INDEX "decision_variable_definition_tenant_id_lifecycle_state_idx"
  ON "decision_variable_definition"("tenant_id", "lifecycle_state");

ALTER TABLE "decision_variable_version"
  ADD COLUMN "display_name" VARCHAR(160),
  ADD COLUMN "description" TEXT,
  ADD COLUMN "constraints_json" JSONB,
  ADD COLUMN "validation_message" VARCHAR(400),
  ADD COLUMN "example_valid_json" JSONB,
  ADD COLUMN "example_invalid_json" JSONB,
  ADD COLUMN "expected_origin" VARCHAR(40) NOT NULL DEFAULT 'REQUEST',
  ADD COLUMN "contract_version" VARCHAR(20) NOT NULL DEFAULT '1';

-- El esquema JSON existente se conserva como proyección; las restricciones normalizadas
-- se derivan de él para no perder lo ya configurado.
UPDATE "decision_variable_version"
   SET "constraints_json" = "validation_schema_json"
 WHERE "validation_schema_json" IS NOT NULL;

-- §2 — Variables intermedias del grafo.
CREATE TABLE "decision_intermediate_variable" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "data_type" VARCHAR(40) NOT NULL,
  "producer_node_key" VARCHAR(120) NOT NULL,
  "consumer_node_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "initial_value_json" JSONB,
  "constraints_json" JSONB,
  "nullable" BOOLEAN NOT NULL DEFAULT true,
  "update_policy" "IntermediateUpdatePolicy" NOT NULL DEFAULT 'SINGLE_WRITE',
  "availability_condition_json" JSONB,
  "sensitivity_class" "SensitivityClass" NOT NULL DEFAULT 'INTERNAL',
  "trace_policy" "TracePolicy" NOT NULL DEFAULT 'FULL',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "decision_intermediate_variable_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_intermediate_variable_version_code_key"
  ON "decision_intermediate_variable"("artifact_version_id", "code");
CREATE INDEX "decision_intermediate_variable_tenant_version_idx"
  ON "decision_intermediate_variable"("tenant_id", "artifact_version_id");
ALTER TABLE "decision_intermediate_variable"
  ADD CONSTRAINT "decision_intermediate_variable_version_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §4 — Contrato de salida explícito.
CREATE TABLE "decision_output_contract_field" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "field_code" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "source_kind" "OutputSourceKind" NOT NULL,
  "source_ref" VARCHAR(500) NOT NULL,
  "value_mapping_json" JSONB,
  "absence_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "example_json" JSONB,
  "contract_version" VARCHAR(20) NOT NULL DEFAULT '1',
  "sensitivity_class" "SensitivityClass" NOT NULL DEFAULT 'INTERNAL',
  "trace_policy" "TracePolicy" NOT NULL DEFAULT 'FULL',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "decision_output_contract_field_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_output_contract_field_version_code_key"
  ON "decision_output_contract_field"("artifact_version_id", "field_code");
CREATE INDEX "decision_output_contract_field_tenant_version_idx"
  ON "decision_output_contract_field"("tenant_id", "artifact_version_id");
ALTER TABLE "decision_output_contract_field"
  ADD CONSTRAINT "decision_output_contract_field_version_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §7 — Registro de librerías autorizadas.
CREATE TABLE "decision_approved_library" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "logical_name" VARCHAR(80) NOT NULL,
  "package_name" VARCHAR(160) NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "language" "CalculatedFieldImplKind" NOT NULL,
  "category" VARCHAR(60) NOT NULL,
  "description" TEXT NOT NULL,
  "documentation_url" VARCHAR(500),
  "allowed_functions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blocked_functions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowed_environments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "ApprovedLibraryStatus" NOT NULL DEFAULT 'APPROVED',
  "known_risks" TEXT,
  "integrity_hash" VARCHAR(128),
  "update_policy" VARCHAR(40) NOT NULL DEFAULT 'PINNED',
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "decision_approved_library_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_approved_library_tenant_name_lang_version_key"
  ON "decision_approved_library"("tenant_id", "logical_name", "language", "version");
CREATE INDEX "decision_approved_library_tenant_status_idx"
  ON "decision_approved_library"("tenant_id", "status");

-- §5 — Campos calculados.
CREATE TABLE "decision_calculated_field" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "field_code" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "category" VARCHAR(60) NOT NULL,
  "owner_team" VARCHAR(100) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "decision_calculated_field_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_calculated_field_tenant_code_key"
  ON "decision_calculated_field"("tenant_id", "field_code");
CREATE INDEX "decision_calculated_field_tenant_active_idx"
  ON "decision_calculated_field"("tenant_id", "is_active");

CREATE TABLE "decision_calculated_field_version" (
  "id" BIGSERIAL NOT NULL,
  "calculated_field_id" BIGINT NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "CalculatedFieldStatus" NOT NULL DEFAULT 'DRAFT',
  "implementation_kind" "CalculatedFieldImplKind" NOT NULL,
  "inputs_json" JSONB NOT NULL,
  "return_json" JSONB NOT NULL,
  "comments_json" JSONB,
  "operation_json" JSONB,
  "source_code" TEXT,
  "source_checksum" VARCHAR(128),
  "timeout_ms" INTEGER NOT NULL DEFAULT 50,
  "error_policy" VARCHAR(40) NOT NULL DEFAULT 'FAIL',
  "default_value_json" JSONB,
  "content_hash" VARCHAR(128) NOT NULL,
  "environment" VARCHAR(40),
  "author_id" VARCHAR(160) NOT NULL,
  "reviewer_id" VARCHAR(160),
  "approver_id" VARCHAR(160),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),
  CONSTRAINT "decision_calculated_field_version_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_calculated_field_version_field_number_key"
  ON "decision_calculated_field_version"("calculated_field_id", "version_number");
CREATE INDEX "decision_calculated_field_version_field_status_idx"
  ON "decision_calculated_field_version"("calculated_field_id", "status");
ALTER TABLE "decision_calculated_field_version"
  ADD CONSTRAINT "decision_calculated_field_version_field_fkey"
  FOREIGN KEY ("calculated_field_id") REFERENCES "decision_calculated_field"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una implementación por código tiene que traer código; una visual, su árbol de
-- operaciones. La base de datos lo exige para que un bug de servicio no persista
-- una versión inejecutable.
ALTER TABLE "decision_calculated_field_version"
  ADD CONSTRAINT "calculated_field_version_implementation_present" CHECK (
    ("implementation_kind" = 'OPERATION' AND "operation_json" IS NOT NULL)
    OR ("implementation_kind" <> 'OPERATION' AND "source_code" IS NOT NULL AND "source_checksum" IS NOT NULL)
  );

CREATE TABLE "decision_calculated_field_library" (
  "id" BIGSERIAL NOT NULL,
  "calculated_field_version_id" BIGINT NOT NULL,
  "approved_library_id" BIGINT NOT NULL,
  CONSTRAINT "decision_calculated_field_library_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "decision_calculated_field_library_version_library_key"
  ON "decision_calculated_field_library"("calculated_field_version_id", "approved_library_id");
ALTER TABLE "decision_calculated_field_library"
  ADD CONSTRAINT "decision_calculated_field_library_version_fkey"
  FOREIGN KEY ("calculated_field_version_id") REFERENCES "decision_calculated_field_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_calculated_field_library"
  ADD CONSTRAINT "decision_calculated_field_library_library_fkey"
  FOREIGN KEY ("approved_library_id") REFERENCES "decision_approved_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "decision_calculated_field_test_case" (
  "id" BIGSERIAL NOT NULL,
  "calculated_field_version_id" BIGINT NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "inputs_json" JSONB NOT NULL,
  "expected_json" JSONB,
  "expected_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_calculated_field_test_case_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_calculated_field_test_case_version_idx"
  ON "decision_calculated_field_test_case"("calculated_field_version_id");
ALTER TABLE "decision_calculated_field_test_case"
  ADD CONSTRAINT "decision_calculated_field_test_case_version_fkey"
  FOREIGN KEY ("calculated_field_version_id") REFERENCES "decision_calculated_field_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §10 — QA Lab.
CREATE TABLE "decision_qa_generation_run" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "environment_code" VARCHAR(40) NOT NULL,
  "status" "QaRunStatus" NOT NULL DEFAULT 'QUEUED',
  "seed" VARCHAR(64) NOT NULL,
  "config_json" JSONB NOT NULL,
  "generator_version" VARCHAR(40) NOT NULL,
  "tooling_json" JSONB NOT NULL,
  "contract_snapshot_json" JSONB NOT NULL,
  "total_cases" INTEGER NOT NULL DEFAULT 0,
  "passed_cases" INTEGER NOT NULL DEFAULT 0,
  "failed_cases" INTEGER NOT NULL DEFAULT 0,
  "errored_cases" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "summary_json" JSONB,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "created_by" VARCHAR(160) NOT NULL,
  CONSTRAINT "decision_qa_generation_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_qa_generation_run_tenant_version_started_idx"
  ON "decision_qa_generation_run"("tenant_id", "artifact_version_id", "started_at");
ALTER TABLE "decision_qa_generation_run"
  ADD CONSTRAINT "decision_qa_generation_run_version_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "decision_qa_counterexample" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "qa_run_id" BIGINT NOT NULL,
  "property" VARCHAR(120) NOT NULL,
  "shrunk_input_json" JSONB NOT NULL,
  "original_input_json" JSONB,
  "observed_json" JSONB,
  "failure_code" VARCHAR(120) NOT NULL,
  "failure_message" TEXT NOT NULL,
  "replay_seed" VARCHAR(64) NOT NULL,
  "replay_path" VARCHAR(200),
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_qa_counterexample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "decision_qa_counterexample_tenant_run_idx"
  ON "decision_qa_counterexample"("tenant_id", "qa_run_id");
CREATE INDEX "decision_qa_counterexample_tenant_property_created_idx"
  ON "decision_qa_counterexample"("tenant_id", "property", "created_at");
ALTER TABLE "decision_qa_counterexample"
  ADD CONSTRAINT "decision_qa_counterexample_run_fkey"
  FOREIGN KEY ("qa_run_id") REFERENCES "decision_qa_generation_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security por tenant, igual que el resto de tablas multi-tenant
-- (20260719080000_tenant_rls_and_app_role). Sin esto, las tablas nuevas serían el
-- único punto del esquema donde un fallo de filtrado en el servicio cruzaría tenants.
DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'decision_intermediate_variable',
    'decision_output_contract_field',
    'decision_approved_library',
    'decision_calculated_field',
    'decision_qa_generation_run',
    'decision_qa_counterexample'
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
      "decision_intermediate_variable",
      "decision_output_contract_field",
      "decision_approved_library",
      "decision_calculated_field",
      "decision_calculated_field_version",
      "decision_calculated_field_library",
      "decision_calculated_field_test_case",
      "decision_qa_generation_run",
      "decision_qa_counterexample"
    TO atlas_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;
  END IF;
END
$$;

-- Vista de lectura del contrato completo (entradas + intermedias + salidas) para el
-- frontend y para QA. security_invoker respeta la RLS de quien consulta.
CREATE OR REPLACE VIEW "vw_artifact_variable_contract" AS
SELECT
  a.tenant_id,
  a.artifact_code,
  v.id AS version_id,
  v.version_number,
  v.status::text AS version_status,
  dep.usage_type AS scope,
  vd.variable_code AS code,
  vd.canonical_name AS name,
  vv.data_type,
  dep.is_required,
  vv.nullable,
  vv.default_value_json,
  vv.constraints_json,
  vv.validation_message,
  vv.expected_origin,
  vd.sensitivity_class::text AS sensitivity_class,
  NULL::varchar(120) AS producer_node_key
FROM "decision_artifact" a
JOIN "decision_artifact_version" v ON v.artifact_id = a.id
JOIN "decision_artifact_variable_dependency" dep ON dep.artifact_version_id = v.id
JOIN "decision_variable_version" vv ON vv.id = dep.variable_version_id
JOIN "decision_variable_definition" vd ON vd.id = vv.variable_definition_id
UNION ALL
SELECT
  a.tenant_id,
  a.artifact_code,
  v.id AS version_id,
  v.version_number,
  v.status::text AS version_status,
  'INTERMEDIATE' AS scope,
  iv.code,
  iv.name,
  iv.data_type,
  false AS is_required,
  iv.nullable,
  iv.initial_value_json AS default_value_json,
  iv.constraints_json,
  NULL::varchar(400) AS validation_message,
  'GRAPH_NODE' AS expected_origin,
  iv.sensitivity_class::text AS sensitivity_class,
  iv.producer_node_key
FROM "decision_artifact" a
JOIN "decision_artifact_version" v ON v.artifact_id = a.id
JOIN "decision_intermediate_variable" iv ON iv.artifact_version_id = v.id;

ALTER VIEW "vw_artifact_variable_contract" SET (security_invoker = on);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT ON "vw_artifact_variable_contract" TO atlas_app;
  END IF;
END
$$;

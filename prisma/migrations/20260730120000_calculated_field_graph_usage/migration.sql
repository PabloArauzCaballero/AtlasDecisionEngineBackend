-- §5.1 — un campo calculado deja de ser un registro aislado y puede invocarse desde un
-- nodo del grafo. La tabla fija la versión usada (inmutabilidad de la decisión) y hace
-- consultable la dependencia inversa que exige §5.2: qué artefactos usan un campo.

CREATE TABLE "decision_artifact_calculated_field_use" (
  "id" BIGSERIAL NOT NULL,
  "tenant_id" BIGINT NOT NULL,
  "artifact_version_id" BIGINT NOT NULL,
  "node_key" VARCHAR(120) NOT NULL,
  "call_key" VARCHAR(120) NOT NULL,
  "calculated_field_version_id" BIGINT NOT NULL,
  "input_mapping_json" JSONB NOT NULL,
  "target_kind" VARCHAR(20) NOT NULL,
  "target_code" VARCHAR(120) NOT NULL,
  "definition_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "decision_artifact_calculated_field_use_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_artifact_cf_use_version_node_call_key"
  ON "decision_artifact_calculated_field_use"("artifact_version_id", "node_key", "call_key");
CREATE INDEX "decision_artifact_cf_use_tenant_field_idx"
  ON "decision_artifact_calculated_field_use"("tenant_id", "calculated_field_version_id");

ALTER TABLE "decision_artifact_calculated_field_use"
  ADD CONSTRAINT "decision_artifact_cf_use_version_fkey"
  FOREIGN KEY ("artifact_version_id") REFERENCES "decision_artifact_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT y no CASCADE: borrar una versión de campo calculado que un artefacto usa
-- dejaría ese artefacto sin poder explicar cómo calculó su decisión.
ALTER TABLE "decision_artifact_calculated_field_use"
  ADD CONSTRAINT "decision_artifact_cf_use_field_fkey"
  FOREIGN KEY ("calculated_field_version_id") REFERENCES "decision_calculated_field_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El destino solo puede ser una intermedia o una salida declarada; el validador del
-- grafo comprueba además que exista y que el tipo encaje.
ALTER TABLE "decision_artifact_calculated_field_use"
  ADD CONSTRAINT "decision_artifact_cf_use_target_kind"
  CHECK ("target_kind" IN ('INTERMEDIATE', 'OUTPUT'));

ALTER TABLE "decision_artifact_calculated_field_use" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_artifact_calculated_field_use" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_artifact_calculated_field_use";
CREATE POLICY tenant_isolation ON "decision_artifact_calculated_field_use"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_artifact_calculated_field_use" TO atlas_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;
  END IF;
END
$$;

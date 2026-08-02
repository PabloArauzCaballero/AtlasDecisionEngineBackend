-- El simulador necesita saber QUÉ valores admite cada variable de entrada para
-- poder precargar el formulario (y ofrecer los valores de un enum) en vez de
-- devolver NO_DECISION / VARIABLE_MISSING_OR_INVALID cuando la persona no
-- adivina los nombres. Se añade el esquema de validación al final de la vista.
CREATE OR REPLACE VIEW "vw_artifact_input_contract" AS
SELECT
  a.tenant_id,
  a.artifact_code,
  v.id AS version_id,
  v.version_number,
  v.status::text AS version_status,
  dep.usage_type,
  dep.is_required,
  dep.fallback_policy,
  dep.dependency_path,
  vd.variable_code,
  vd.canonical_name,
  vv.data_type,
  vv.nullable,
  vv.default_value_json,
  vv.validation_schema_json
FROM "decision_artifact" a
JOIN "decision_artifact_version" v ON v.artifact_id = a.id
JOIN "decision_artifact_variable_dependency" dep ON dep.artifact_version_id = v.id
JOIN "decision_variable_version" vv ON vv.id = dep.variable_version_id
JOIN "decision_variable_definition" vd ON vd.id = vv.variable_definition_id;

ALTER VIEW "vw_artifact_input_contract" SET (security_invoker = on);

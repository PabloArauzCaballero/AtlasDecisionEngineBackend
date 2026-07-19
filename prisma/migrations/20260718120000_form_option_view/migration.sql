-- ---------------------------------------------------------------------------
-- Read-model view feeding the portal create-form option selects
-- (GET /v1/views/options?group=...). Exposes the DISTINCT existing values per
-- catalog field so the UI never hardcodes enums and avoids overfetching whole
-- entities just to populate a dropdown.
--
-- Idempotent: CREATE OR REPLACE VIEW can be re-applied safely. Tenant-scoped via
-- tenant_id; the endpoint filters by (tenant_id, option_group). UNION (not UNION
-- ALL) collapses values shared across source tables (e.g. owner_team).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW "vw_form_option" AS
  -- data_type lives on the version, but tenant_id lives on the definition, so the two
  -- must be joined; decision_variable_version has no tenant_id of its own.
  SELECT d.tenant_id, 'variableDataType'::text AS option_group,
         v.data_type AS value, v.data_type AS label
    FROM "decision_variable_version" v
    JOIN "decision_variable_definition" d ON d.id = v.variable_definition_id
    WHERE v.data_type IS NOT NULL AND v.data_type <> ''
    GROUP BY d.tenant_id, v.data_type
  UNION
  SELECT tenant_id, 'dataClassification'::text, data_classification, data_classification
    FROM "decision_variable_definition"
    WHERE data_classification IS NOT NULL AND data_classification <> ''
    GROUP BY tenant_id, data_classification
  UNION
  SELECT tenant_id, 'ownerTeam'::text, owner_team, owner_team
    FROM "decision_variable_definition"
    WHERE owner_team IS NOT NULL AND owner_team <> ''
    GROUP BY tenant_id, owner_team
  UNION
  SELECT tenant_id, 'reasonSeverity'::text, severity, severity
    FROM "decision_reason_code"
    WHERE severity IS NOT NULL AND severity <> ''
    GROUP BY tenant_id, severity
  UNION
  SELECT tenant_id, 'reasonCategory'::text, category, category
    FROM "decision_reason_code"
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY tenant_id, category
  UNION
  SELECT tenant_id, 'artifactType'::text, artifact_type, artifact_type
    FROM "decision_artifact"
    WHERE artifact_type IS NOT NULL AND artifact_type <> ''
    GROUP BY tenant_id, artifact_type
  UNION
  SELECT tenant_id, 'riskDomain'::text, risk_domain, risk_domain
    FROM "decision_artifact"
    WHERE risk_domain IS NOT NULL AND risk_domain <> ''
    GROUP BY tenant_id, risk_domain
  UNION
  SELECT tenant_id, 'ownerTeam'::text, owner_team, owner_team
    FROM "decision_artifact"
    WHERE owner_team IS NOT NULL AND owner_team <> ''
    GROUP BY tenant_id, owner_team;

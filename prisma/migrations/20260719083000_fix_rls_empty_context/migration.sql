-- Fix tenant RLS policies to treat an empty app.tenant_id as "no context" (plan §2.6).
--
-- A transaction-local GUC that has been set once and then reverts reads back as an empty
-- string, not NULL, so the original policy hit ''::bigint and errored. NULLIF collapses
-- both the unset (NULL) and reverted (empty) cases to "no tenant context -> allow".

DROP POLICY IF EXISTS tenant_isolation ON "decision_access_audit";
CREATE POLICY tenant_isolation ON "decision_access_audit"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_artifact";
CREATE POLICY tenant_isolation ON "decision_artifact"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_audit_event";
CREATE POLICY tenant_isolation ON "decision_audit_event"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_business_objective";
CREATE POLICY tenant_isolation ON "decision_business_objective"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_execution";
CREATE POLICY tenant_isolation ON "decision_execution"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_manual_review_case";
CREATE POLICY tenant_isolation ON "decision_manual_review_case"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_node_script";
CREATE POLICY tenant_isolation ON "decision_node_script"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_reason_code";
CREATE POLICY tenant_isolation ON "decision_reason_code"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_runtime_binding";
CREATE POLICY tenant_isolation ON "decision_runtime_binding"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_runtime_idempotency";
CREATE POLICY tenant_isolation ON "decision_runtime_idempotency"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "decision_variable_definition";
CREATE POLICY tenant_isolation ON "decision_variable_definition"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);

DROP POLICY IF EXISTS tenant_isolation ON "integration_tenant_access";
CREATE POLICY tenant_isolation ON "integration_tenant_access"
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint);


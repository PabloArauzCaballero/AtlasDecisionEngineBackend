-- Tenant Row-Level Security as defense in depth (plan §2.6), plus the non-superuser
-- application role it depends on (plan §4.3 / P0-8).
--
-- RLS is inert for a superuser: the single "atlas" role the app used bypasses every policy.
-- So this also creates "atlas_app" (NOSUPERUSER NOBYPASSRLS) for the runtime; migrations
-- keep running as the elevated role. The app's DATABASE_URL must be switched to atlas_app
-- for these policies to take effect — until then they are enabled but bypassed, harmless.
--
-- Policy shape: enforce tenant only when app.tenant_id is set. Auth, health and migrations
-- run without a tenant context and must keep working, so an unset context is allowed; every
-- request-scoped query sets the context (PrismaService extension), so it is always enforced
-- there. current_setting(..., true) returns NULL instead of erroring when unset.

-- Application role (idempotent; password is set out of band, never stored in git).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    CREATE ROLE atlas_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO atlas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO atlas_app;

-- The audit chain is append-only: the runtime role may insert but never modify or remove,
-- reinforcing the triggers already in place.
REVOKE UPDATE, DELETE, TRUNCATE ON decision_audit_event FROM atlas_app;

-- RLS: decision_access_audit
ALTER TABLE "decision_access_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_access_audit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_access_audit";
CREATE POLICY tenant_isolation ON "decision_access_audit"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_artifact
ALTER TABLE "decision_artifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_artifact" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_artifact";
CREATE POLICY tenant_isolation ON "decision_artifact"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_audit_event
ALTER TABLE "decision_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_audit_event" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_audit_event";
CREATE POLICY tenant_isolation ON "decision_audit_event"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_business_objective
ALTER TABLE "decision_business_objective" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_business_objective" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_business_objective";
CREATE POLICY tenant_isolation ON "decision_business_objective"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_execution
ALTER TABLE "decision_execution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_execution" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_execution";
CREATE POLICY tenant_isolation ON "decision_execution"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_manual_review_case
ALTER TABLE "decision_manual_review_case" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_manual_review_case" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_manual_review_case";
CREATE POLICY tenant_isolation ON "decision_manual_review_case"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_node_script
ALTER TABLE "decision_node_script" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_node_script" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_node_script";
CREATE POLICY tenant_isolation ON "decision_node_script"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_reason_code
ALTER TABLE "decision_reason_code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_reason_code" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_reason_code";
CREATE POLICY tenant_isolation ON "decision_reason_code"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_runtime_binding
ALTER TABLE "decision_runtime_binding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_runtime_binding" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_runtime_binding";
CREATE POLICY tenant_isolation ON "decision_runtime_binding"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_runtime_idempotency
ALTER TABLE "decision_runtime_idempotency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_runtime_idempotency" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_runtime_idempotency";
CREATE POLICY tenant_isolation ON "decision_runtime_idempotency"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: decision_variable_definition
ALTER TABLE "decision_variable_definition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_variable_definition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_variable_definition";
CREATE POLICY tenant_isolation ON "decision_variable_definition"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

-- RLS: integration_tenant_access
ALTER TABLE "integration_tenant_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_tenant_access" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "integration_tenant_access";
CREATE POLICY tenant_isolation ON "integration_tenant_access"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);


-- Row-Level Security for user_tutorial_progress.
--
-- The table was created (20260723050000) with a tenant_id but without the tenant policy
-- every other tenant-scoped table carries since 20260719080000_tenant_rls_and_app_role,
-- leaving it as the only tenant-scoped table where a query that forgot its tenant filter
-- would read across tenants. Tutorial progress is low-sensitivity, but the isolation
-- guarantee is only as strong as its least-protected table, so it gets the same policy.
--
-- Same shape as the existing policies: enforced whenever app.tenant_id is set (every
-- request-scoped query sets it through the PrismaService extension), permissive when
-- unset so migrations, seeds and health checks keep working.

ALTER TABLE "user_tutorial_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_tutorial_progress" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_tutorial_progress";
CREATE POLICY tenant_isolation ON "user_tutorial_progress"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

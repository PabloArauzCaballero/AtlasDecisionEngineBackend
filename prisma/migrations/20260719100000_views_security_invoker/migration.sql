-- Close a tenant RLS bypass through views (plan §2.6 follow-up).
--
-- These views are owned by the elevated role, and a view without security_invoker runs
-- with its owner's privileges. A superuser owner bypasses RLS, so the runtime role reading
-- a view saw every tenant's rows even though RLS is enabled on the underlying tables.
-- security_invoker = on makes the view run with the querying role's privileges, so the
-- same tenant policies apply through the view. Verified: a foreign tenant context returns
-- zero rows after this, and the real tenant is unaffected.
--
-- New tenant-scoped views must set this too; there is no cluster default for it.

ALTER VIEW "vw_artifact_input_contract" SET (security_invoker = on);
ALTER VIEW "vw_artifact_picker" SET (security_invoker = on);
ALTER VIEW "vw_artifact_version_picker" SET (security_invoker = on);
ALTER VIEW "vw_form_option" SET (security_invoker = on);
ALTER VIEW "vw_global_search" SET (security_invoker = on);
ALTER VIEW "vw_node_script" SET (security_invoker = on);
ALTER VIEW "vw_test_run_picker" SET (security_invoker = on);
ALTER VIEW "vw_test_suite_picker" SET (security_invoker = on);
ALTER VIEW "vw_variable_picker" SET (security_invoker = on);

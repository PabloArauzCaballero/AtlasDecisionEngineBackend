-- Supports the cursor-paginated audit feed (GET /v1/audit/events/cursor), whose access
-- pattern is `tenant_id = ? AND id < ? ORDER BY id DESC LIMIT n`.
--
-- Without this index Postgres satisfies that query with a backward scan of
-- decision_audit_event_pkey and discards every row belonging to another tenant
-- (EXPLAIN showed 42 rows removed by filter to return 26). The rows discarded per page grow
-- with the share of the table owned by other tenants, so a tenant paging through its own
-- history reads progressively more of the table — precisely the cost keyset pagination is
-- meant to remove. With (tenant_id, id) the same query is a plain index range scan.
--
-- Ascending on id is sufficient: with tenant_id fixed by equality, Postgres scans this index
-- backwards for ORDER BY id DESC at no extra cost.
--
-- Written as a plain CREATE INDEX because Prisma applies each migration inside a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run in one. On a large existing table
-- this takes an ACCESS SHARE-blocking lock for the duration of the build; if this is ever
-- applied to a table with millions of rows, build it out-of-band with CONCURRENTLY first and
-- let this statement become a no-op via IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS "decision_audit_event_tenant_id_id_idx"
  ON "decision_audit_event" ("tenant_id", "id");

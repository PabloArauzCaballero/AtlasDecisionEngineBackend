#!/usr/bin/env node
/**
 * Sets the login secret for the pre-created non-superuser role. Keeping it outside migration SQL
 * prevents credentials from entering history while making RLS effective at runtime.
 */
// Sets the login password of the non-superuser application role (atlas_app) from an
// environment variable, so the secret never lives in a migration or in git.
//
// The tenant RLS policies (migration 20260719080000) only take effect when the app connects
// as this non-superuser role — a superuser bypasses RLS. Run this once per environment with
// an admin/superuser DATABASE_URL, then point the app's DATABASE_URL at atlas_app.
//
// Usage:
//   ADMIN_DATABASE_URL=postgresql://atlas:...@host/db APP_DB_PASSWORD=<secret> \
//     node scripts/set-app-db-role.mjs
//
// ADMIN_DATABASE_URL falls back to DATABASE_URL. The password must be non-empty; a
// restricted character set keeps it safe to inline into the ALTER ROLE DDL, which cannot
// take a bind parameter.
import { Client } from 'pg';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
const role = process.env.APP_DB_ROLE ?? 'atlas_app';

if (!adminUrl) {
  console.error('ADMIN_DATABASE_URL or DATABASE_URL is required (an admin/superuser connection).');
  process.exit(1);
}
if (!password || password.length < 16) {
  console.error('APP_DB_PASSWORD is required and must be at least 16 characters.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_.~-]+$/.test(password)) {
  console.error('APP_DB_PASSWORD must contain only [A-Za-z0-9_.~-] so it can be inlined safely.');
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
  console.error('APP_DB_ROLE is not a valid role identifier.');
  process.exit(1);
}

const client = new Client({ connectionString: adminUrl });
try {
  await client.connect();
  await client.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${password}'`);
  console.log(`Password set for role "${role}". Point the app DATABASE_URL at it to activate RLS.`);
} catch (error) {
  console.error(`Failed to set password for role "${role}": ${error.message}`);
  process.exit(1);
} finally {
  await client.end();
}

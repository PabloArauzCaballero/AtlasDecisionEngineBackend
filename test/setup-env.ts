// Jest does not load .env by itself. Until now only specs that happened to import
// PrismaClient saw DATABASE_URL, because Prisma loads .env as an import side effect. Specs
// that talk to Postgres through `pg` directly — the tenant RLS isolation/views guards and
// the deployment invariants — therefore read an undefined DATABASE_URL and silently
// self-skipped, so a full `npm test` reported green while the RLS security guards had never
// executed. Loading the env here makes the DATABASE_URL gate mean the same thing for every
// spec, whichever driver it imports.
import { config } from 'dotenv';

config();

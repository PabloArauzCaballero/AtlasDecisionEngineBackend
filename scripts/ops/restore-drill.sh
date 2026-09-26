#!/usr/bin/env bash
#
# Ensayo de RESTORE local del motor (P-17 · B19). Todo sintético y efímero: Postgres y Redis
# propios; no toca ninguna base desplegada.
#
#   yarn build && bash scripts/ops/restore-drill.sh
#   PREFIX=mi-banco PG_PORT=55110 REDIS_PORT=55111 bash scripts/ops/restore-drill.sh
#
# Recorrido:
#   1. Base ORIGEN migrada (`prisma migrate deploy`) y artefacto provisionado por la batería e2e
#      (`test/e2e/runtime.e2e-spec.ts`: gobierno de dos firmas y despliegue a PROD).
#   2. Datos de un ciclo por la API compilada: decisiones (`scripts/perf/decision-load.mjs`),
#      consentimientos (otorgado y revocado), créditos concedidos y desenlaces observados.
#   3. Outbox con los tres estados: DISPATCHED (lo que el relay ya entregó), y eventos PENDING y
#      DEAD insertados por SQL como hace `scripts/load-test.sh` (el motor no tiene cómo fabricar un
#      DEAD a demanda sin romper un consumidor).
#   4. Conciliación del ORIGEN → `pg_dump -Fc` → base NUEVA → `pg_restore` → conciliación de la
#      RESTAURADA. Deben ser idénticas línea a línea. RTO = crear + restaurar + conciliar.
#   5. La API arranca contra la RESTAURADA: el relay debe despachar EXACTAMENTE los PENDING; los
#      DISPATCHED no se tocan (mismos intentos y misma fecha) y los DEAD siguen DEAD.
#
# Sale con código ≠ 0 si cualquier comprobación falla. Informe en $OUT_DIR/summary.json.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PREFIX="${PREFIX:-atlas-drill}"
PG_PORT="${PG_PORT:-55110}"
REDIS_PORT="${REDIS_PORT:-55111}"
API_PORT="${API_PORT:-3197}"
LOAD_S="${LOAD_S:-15}"
SYNTHETIC_PENDING="${SYNTHETIC_PENDING:-40}"
SYNTHETIC_DEAD="${SYNTHETIC_DEAD:-5}"
STAMP="$(date +%Y%m%d%H%M%S)"
SRC_DB="drill_src_${STAMP}"
DST_DB="drill_restored_${STAMP}"
OUT_DIR="${OUT_DIR:-${TMPDIR:-/tmp}/atlas-engine-restore-drill/${STAMP}}"
PG="${PREFIX}-pg"
REDIS="${PREFIX}-redis"
ADMIN_KEY="e2e-admin-secret-0123456789abcdef"     # gitleaks:allow — credencial inventada de las e2e
RUNTIME_KEY="e2e-runtime-secret-0123456789abcdef" # gitleaks:allow — credencial inventada de las e2e
mkdir -p "$OUT_DIR"

export NODE_ENV=test
export PORT="$API_PORT"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export AUTH_MODE=API_KEY
export MANAGEMENT_API_KEY=drill-management-key-with-enough-entropy
export RUNTIME_API_KEY=drill-runtime-key-with-different-entropy
export AUDIT_HASH_SECRET=drill-audit-secret-with-at-least-32-characters-total
export METRICS_TOKEN=drill-metrics-token-with-enough-entropy
export STORAGE_S3_ENDPOINT=http://127.0.0.1:9
export STORAGE_S3_BUCKET=atlas-decision
export STORAGE_S3_ACCESS_KEY_ID=drill-storage-key
export STORAGE_S3_SECRET_ACCESS_KEY=drill-storage-secret-with-enough-entropy
export STARTUP_SEED_ENABLED=true
export OTEL_ENABLED=false
export RATE_LIMIT_RUNTIME_REQUESTS=100000

FAILED=0
log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { echo "FALLO: $*" >&2; FAILED=1; }
url_for() { echo "postgresql://atlas:atlas@127.0.0.1:${PG_PORT}/$1?schema=public"; }
psqlq() { docker exec "$PG" psql -U atlas -d "$1" -v ON_ERROR_STOP=1 -tAc "$2" | tr -d '\r'; }
now_ms() { node -e 'console.log(Date.now())'; }
mgmt() { # método ruta cuerpo
  curl -sS -X "$1" "http://127.0.0.1:${API_PORT}$2" -H 'content-type: application/json' \
    -H "x-api-key: ${ADMIN_KEY}" -H 'x-tenant-id: 1' -d "$3"
}

API_PID=""
start_api() {
  DATABASE_URL="$(url_for "$1")" ADMIN_DATABASE_URL="$(url_for "$1")" node dist/main.js >>"$OUT_DIR/api-$1.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "la API no quedó lista contra $1" >&2; exit 1
}
stop_api() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; API_PID=""; }
trap stop_api EXIT

log "Contenedores propios ($PG, $REDIS)"
docker inspect "$PG" >/dev/null 2>&1 || docker run -d --name "$PG" -e POSTGRES_USER=atlas \
  -e POSTGRES_PASSWORD=atlas -e POSTGRES_DB=atlas_decision -p "127.0.0.1:${PG_PORT}:5432" postgres:16-alpine >/dev/null
docker inspect "$REDIS" >/dev/null 2>&1 || docker run -d --name "$REDIS" -p "127.0.0.1:${REDIS_PORT}:6379" redis:7-alpine >/dev/null
docker start "$PG" "$REDIS" >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U atlas >/dev/null 2>&1 && break; sleep 1; done
[ -f dist/main.js ] || yarn -s build >/dev/null

log "1. Base origen $SRC_DB: migrar y provisionar"
psqlq atlas_decision "CREATE DATABASE ${SRC_DB}" >/dev/null
DATABASE_URL="$(url_for "$SRC_DB")" yarn -s prisma:migrate >"$OUT_DIR/migrate.log" 2>&1 || { echo "migración falló" >&2; exit 1; }
DATABASE_URL="$(url_for "$SRC_DB")" ADMIN_DATABASE_URL="$(url_for "$SRC_DB")" \
  node scripts/run-jest.mjs --config test/jest-e2e.json --runInBand test/e2e/runtime.e2e-spec.ts \
  >"$OUT_DIR/provision.log" 2>&1 || { echo "provisión falló: $OUT_DIR/provision.log" >&2; exit 1; }

log "2. Ciclo sintético por la API"
start_api "$SRC_DB"
node scripts/perf/decision-load.mjs --base-url "http://127.0.0.1:${API_PORT}" --api-key "$RUNTIME_KEY" \
  --label drill --concurrency 4 --duration "$LOAD_S" --warmup 0 --out "$OUT_DIR/load.json" >/dev/null
mgmt POST /v1/risk-governance/consents '{"subjectReference":"drill-subject-1","purpose":"credit_underwriting","basis":"CREDIT_PROTECTION","grantedAt":"2026-01-01T00:00:00.000Z"}' >"$OUT_DIR/consent-1.json"
mgmt POST /v1/risk-governance/consents '{"subjectReference":"drill-subject-2","purpose":"credit_underwriting","basis":"CREDIT_PROTECTION","grantedAt":"2026-01-01T00:00:00.000Z"}' >"$OUT_DIR/consent-2.json"
mgmt POST /v1/risk-governance/consents/revoke '{"subjectReference":"drill-subject-2","purpose":"credit_underwriting"}' >"$OUT_DIR/consent-2-revoke.json"
EXEC_IDS=$(psqlq "$SRC_DB" "SELECT string_agg(id::text, ' ') FROM (SELECT id FROM decision_execution WHERE business_outcome = 'APPROVED' ORDER BY id LIMIT 20) e")
FACILITIES=$(node -e 'console.log(JSON.stringify({facilities: process.argv.slice(1).map((id) => ({externalReference: "drill-fac-" + id, originationExecutionId: id, principalAmount: 2500, currencyCode: "BOB", termMonths: 6, annualRate: 0.24}))}))' $EXEC_IDS)
mgmt POST /v1/outcomes/facilities "$FACILITIES" >"$OUT_DIR/facilities.json"
OUTCOMES=$(node -e 'console.log(JSON.stringify({outcomes: process.argv.slice(1, 11).map((id, i) => ({externalReference: "drill-fac-" + id, windowDays: 30, label: i % 3 === 0 ? "BAD" : "GOOD", source: "DRILL_SINTETICO"}))}))' $EXEC_IDS)
mgmt POST /v1/outcomes/batch "$OUTCOMES" >"$OUT_DIR/outcomes.json"
stop_api

log "3. Outbox: PENDING y DEAD sintéticos junto a los DISPATCHED reales"
psqlq "$SRC_DB" "INSERT INTO decision_outbox_event (tenant_id, event_type, schema_version, aggregate_type, aggregate_id, actor_id, correlation_id, payload_json, status, available_at, occurred_at)
  SELECT 1, 'version.submitted_for_review', '1', 'ArtifactVersion', 'DRILL-P-'||g, 'restore-drill', 'drill-'||g,
         '{\"artifactCode\":\"DRILL\",\"reviewerRoles\":[\"RISK_APPROVER\"]}'::jsonb, 'PENDING', now(), now()
  FROM generate_series(1, ${SYNTHETIC_PENDING}) g" >/dev/null
psqlq "$SRC_DB" "INSERT INTO decision_outbox_event (tenant_id, event_type, schema_version, aggregate_type, aggregate_id, actor_id, correlation_id, payload_json, status, attempt_count, last_error, available_at, occurred_at)
  SELECT 1, 'version.submitted_for_review', '1', 'ArtifactVersion', 'DRILL-D-'||g, 'restore-drill', 'drill-dead-'||g,
         '{\"artifactCode\":\"DRILL\",\"reviewerRoles\":[\"RISK_APPROVER\"]}'::jsonb, 'DEAD', 10, 'agotado (sintético)', now(), now()
  FROM generate_series(1, ${SYNTHETIC_DEAD}) g" >/dev/null
psqlq "$SRC_DB" "SELECT status, count(*) FROM decision_outbox_event GROUP BY 1 ORDER BY 1" | tee "$OUT_DIR/outbox-source.txt"
for s in PENDING DISPATCHED DEAD; do
  [ "$(psqlq "$SRC_DB" "SELECT count(*) FROM decision_outbox_event WHERE status='$s'")" -gt 0 ] || fail "no hay eventos $s en el origen"
done
for t in credit_facility decision_outcome_observation subject_consent decision_execution; do
  [ "$(psqlq "$SRC_DB" "SELECT count(*) FROM $t")" -gt 0 ] || fail "el ciclo sintético no dejó filas en $t"
done
[ "$(psqlq "$SRC_DB" "SELECT count(*) FROM subject_consent WHERE revoked_at IS NOT NULL")" -gt 0 ] || fail "no quedó ningún consentimiento revocado"

log "4. Conciliación del ORIGEN, dump y restore"
psqlq "$SRC_DB" "$(cat scripts/ops/engine-reconciliation.sql)" >"$OUT_DIR/reconciliation-source.txt" || fail "conciliación (origen)"
psqlq "$SRC_DB" "SELECT id||'|'||status||'|'||attempt_count||'|'||coalesce(dispatched_at::text,'-') FROM decision_outbox_event ORDER BY id" >"$OUT_DIR/outbox-before.txt"
T0=$(now_ms)
docker exec "$PG" pg_dump -U atlas -Fc -f "/tmp/${SRC_DB}.dump" "$SRC_DB" || fail "pg_dump"
DUMP_MS=$(( $(now_ms) - T0 ))
DUMP_BYTES=$(docker exec "$PG" stat -c %s "/tmp/${SRC_DB}.dump")
T1=$(now_ms)
psqlq atlas_decision "CREATE DATABASE ${DST_DB}" >/dev/null
docker exec "$PG" pg_restore -U atlas -d "$DST_DB" --exit-on-error "/tmp/${SRC_DB}.dump" >"$OUT_DIR/pg_restore.log" 2>&1 || fail "pg_restore (ver $OUT_DIR/pg_restore.log)"
RESTORE_MS=$(( $(now_ms) - T1 ))
psqlq "$DST_DB" "$(cat scripts/ops/engine-reconciliation.sql)" >"$OUT_DIR/reconciliation-restored.txt" || fail "conciliación (restaurada)"
RTO_MS=$(( $(now_ms) - T1 ))
if diff -u "$OUT_DIR/reconciliation-source.txt" "$OUT_DIR/reconciliation-restored.txt" >"$OUT_DIR/reconciliation.diff"; then
  echo "   conciliación idéntica ($(wc -l <"$OUT_DIR/reconciliation-source.txt" | tr -d ' ') líneas)"
else
  fail "la conciliación difiere: $OUT_DIR/reconciliation.diff"
fi
[ "$(grep '^claves_con_mas_de_una_ejecucion|' "$OUT_DIR/reconciliation-restored.txt" | cut -d'|' -f2)" = "0" ] || fail "claves con más de una ejecución"

log "5. La API contra la RESTAURADA: el relay sólo despacha los PENDING"
start_api "$DST_DB"
T2=$(now_ms)
for _ in $(seq 1 120); do
  [ "$(psqlq "$DST_DB" "SELECT count(*) FROM decision_outbox_event WHERE status='PENDING'")" = "0" ] && break; sleep 1
done
DRAIN_MS=$(( $(now_ms) - T2 ))
stop_api
psqlq "$DST_DB" "SELECT id||'|'||status||'|'||attempt_count||'|'||coalesce(dispatched_at::text,'-') FROM decision_outbox_event ORDER BY id" >"$OUT_DIR/outbox-after.txt"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const parse = (f) => new Map(fs.readFileSync(dir + "/" + f, "utf8").trim().split("\n").map((l) => { const [id, status, attempts, at] = l.split("|"); return [id, { status, attempts: +attempts, at }]; }));
const before = parse("outbox-before.txt"), after = parse("outbox-after.txt");
const r = { pendingBefore: 0, pendingDispatched: 0, pendingStillPending: 0, dispatchedBefore: 0, dispatchedTouched: 0, deadBefore: 0, deadTouched: 0, newEvents: 0 };
for (const [id, b] of before) {
  const a = after.get(id);
  if (b.status === "PENDING") { r.pendingBefore++; if (a.status === "DISPATCHED") r.pendingDispatched++; else r.pendingStillPending++; }
  if (b.status === "DISPATCHED") { r.dispatchedBefore++; if (a.status !== b.status || a.attempts !== b.attempts || a.at !== b.at) r.dispatchedTouched++; }
  if (b.status === "DEAD") { r.deadBefore++; if (a.status !== b.status || a.attempts !== b.attempts) r.deadTouched++; }
}
for (const id of after.keys()) if (!before.has(id)) r.newEvents++;
fs.writeFileSync(dir + "/redelivery-check.json", JSON.stringify(r, null, 2));
console.log("   " + JSON.stringify(r));
process.exit(r.pendingDispatched === r.pendingBefore && !r.dispatchedTouched && !r.deadTouched ? 0 : 1);
' "$OUT_DIR" || fail "tras restaurar el relay tocó algo distinto de los PENDING"

node -e '
const fs = require("fs");
const [dir, sha, src, dst, dumpMs, bytes, restoreMs, rtoMs, drainMs, failed] = process.argv.slice(1);
const read = (f) => { try { return JSON.parse(fs.readFileSync(dir + "/" + f, "utf8")); } catch { return null; } };
const s = { sha, sourceDb: src, restoredDb: dst, dumpMs: +dumpMs, dumpBytes: +bytes, restoreMs: +restoreMs, rtoMs: +rtoMs,
  relayDrainMs: +drainMs, outboxSource: fs.readFileSync(dir + "/outbox-source.txt", "utf8").trim().split("\n"),
  reconciliationLines: fs.readFileSync(dir + "/reconciliation-source.txt", "utf8").trim().split("\n").length,
  reconciliationIdentical: fs.statSync(dir + "/reconciliation.diff").size === 0,
  redelivery: read("redelivery-check.json"), passed: failed === "0" };
fs.writeFileSync(dir + "/summary.json", JSON.stringify(s, null, 2));
console.log(JSON.stringify(s, null, 2));
' "$OUT_DIR" "$(git rev-parse --short HEAD)" "$SRC_DB" "$DST_DB" "$DUMP_MS" "$DUMP_BYTES" "$RESTORE_MS" "$RTO_MS" "$DRAIN_MS" "$FAILED"

if [ "${KEEP_DATABASES:-0}" != "1" ]; then
  psqlq atlas_decision "DROP DATABASE IF EXISTS ${SRC_DB} WITH (FORCE)" >/dev/null
  psqlq atlas_decision "DROP DATABASE IF EXISTS ${DST_DB} WITH (FORCE)" >/dev/null
  docker exec "$PG" rm -f "/tmp/${SRC_DB}.dump"
fi
echo "Informe: $OUT_DIR/summary.json"
exit "$FAILED"

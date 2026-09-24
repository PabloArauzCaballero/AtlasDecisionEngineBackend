#!/usr/bin/env bash
#
# Banco PROPIO del runtime de decisiones (P-16 · B18): API compilada + Postgres y Redis efímeros.
#
#   scripts/perf/decision-bench.sh                     # todo: escalado, sostenida, caídas
#   SCENARIOS="scale sustained" scripts/perf/decision-bench.sh
#   SUSTAINED_S=300 CONCURRENCY=16 scripts/perf/decision-bench.sh
#
# Qué hace, en orden:
#   1. Levanta (si no existen) un Postgres 16 y un Redis 7 PROPIOS con nombre `${PREFIX}-pg/-redis`.
#      Nunca toca otros contenedores.
#   2. Migra (`prisma migrate deploy`) y provisiona el artefacto `BNPL_CREDIT_DECISION` con la MISMA
#      batería e2e que lo usa en CI (`test/e2e/runtime.e2e-spec.ts` → `support/demo-artifact.ts`):
#      alta, grafo, validación, suite bloqueante, gobierno de dos firmas de roles distintos y
#      despliegue DEV→STAGING→PROD. Es el camino del producto, no un INSERT.
#   3. Arranca `node dist/main.js` (compila si falta `dist/`).
#   4. Corre `decision-load.mjs` por escenario y guarda un JSON por escenario en `$OUT_DIR`.
#   5. En las caídas (Redis / Postgres) detiene el contenedor a mitad de la carga y lo vuelve a
#      arrancar; el cliente reintenta con la MISMA clave. Después comprueba EN LA BASE que ninguna
#      clave produjo dos ejecuciones y que no quedan reservas de idempotencia colgadas.
#
# Es un banco de DESARROLLO: los números describen la máquina donde corre, no un SLO de producción.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PREFIX="${PREFIX:-atlas-bench}"
PG_PORT="${PG_PORT:-55110}"
REDIS_PORT="${REDIS_PORT:-55111}"
API_PORT="${API_PORT:-3197}"
OUT_DIR="${OUT_DIR:-${TMPDIR:-/tmp}/atlas-decision-bench/$(date +%Y%m%d-%H%M%S)}"
SCENARIOS="${SCENARIOS:-scale sustained throttle redis-outage postgres-outage}"
SCALE_LEVELS="${SCALE_LEVELS:-1 4 8 16 32}"
SCALE_S="${SCALE_S:-30}"
CONCURRENCY="${CONCURRENCY:-8}"
SUSTAINED_S="${SUSTAINED_S:-180}"
OUTAGE_TOTAL_S="${OUTAGE_TOTAL_S:-90}"
OUTAGE_AT_S="${OUTAGE_AT_S:-20}"
OUTAGE_FOR_S="${OUTAGE_FOR_S:-30}"
RUNTIME_KEY="e2e-runtime-secret-0123456789abcdef" # gitleaks:allow — credencial inventada de las e2e
mkdir -p "$OUT_DIR"

PG="${PREFIX}-pg"
REDIS="${PREFIX}-redis"

log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
psqlq() { docker exec "$PG" psql -U atlas -d atlas_decision -tAc "$1" | tr -d '\r'; }

export NODE_ENV=test
export PORT="$API_PORT"
export DATABASE_URL="postgresql://atlas:atlas@127.0.0.1:${PG_PORT}/atlas_decision?schema=public"
export ADMIN_DATABASE_URL="$DATABASE_URL"
export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export AUTH_MODE=API_KEY
export MANAGEMENT_API_KEY=bench-management-key-with-enough-entropy
export RUNTIME_API_KEY=bench-runtime-key-with-different-entropy
export AUDIT_HASH_SECRET=bench-audit-secret-with-at-least-32-characters-total
export METRICS_TOKEN=bench-metrics-token-with-enough-entropy
export STORAGE_S3_ENDPOINT=http://127.0.0.1:9
export STORAGE_S3_BUCKET=atlas-decision
export STORAGE_S3_ACCESS_KEY_ID=bench-storage-key
export STORAGE_S3_SECRET_ACCESS_KEY=bench-storage-secret-with-enough-entropy
export STARTUP_SEED_ENABLED=true
export OTEL_ENABLED="${OTEL_ENABLED:-false}"

log "Contenedores propios ($PG, $REDIS)"
docker inspect "$PG" >/dev/null 2>&1 || docker run -d --name "$PG" -e POSTGRES_USER=atlas \
  -e POSTGRES_PASSWORD=atlas -e POSTGRES_DB=atlas_decision -p "127.0.0.1:${PG_PORT}:5432" \
  postgres:16-alpine >/dev/null
docker inspect "$REDIS" >/dev/null 2>&1 || docker run -d --name "$REDIS" \
  -p "127.0.0.1:${REDIS_PORT}:6379" redis:7-alpine >/dev/null
docker start "$PG" "$REDIS" >/dev/null
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U atlas >/dev/null 2>&1 && break; sleep 1; done

log "Migrar y provisionar el artefacto por la API del producto"
yarn -s prisma:generate >/dev/null && yarn -s prisma:migrate >/dev/null || { echo "migración falló" >&2; exit 1; }
# El limitador vive en Redis y sobrevive entre corridas: sin subirlo aquí, una corrida recién
# terminada deja la ventana llena y la provisión recibe 429.
RATE_LIMIT_RUNTIME_REQUESTS=100000 node scripts/run-jest.mjs --config test/jest-e2e.json --runInBand test/e2e/runtime.e2e-spec.ts \
  >"$OUT_DIR/provision.log" 2>&1 || { echo "provisión falló: $OUT_DIR/provision.log" >&2; exit 1; }
[ -f dist/main.js ] || yarn -s build >/dev/null

API_PID=""
start_api() {
  # El limitador por cliente (1.500/min por omisión) se sube SÓLO para medir la capacidad del
  # runtime; el escenario `throttle` lo mide con su valor por omisión.
  RATE_LIMIT_RUNTIME_REQUESTS="${1:-100000}" node dist/main.js >>"$OUT_DIR/api.log" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "la API no quedó lista" >&2; return 1
}
stop_api() { [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; API_PID=""; }
trap stop_api EXIT

load() { # label concurrency duration [extra…]
  local label=$1 c=$2 d=$3; shift 3
  node scripts/perf/decision-load.mjs --base-url "http://127.0.0.1:${API_PORT}" \
    --api-key "$RUNTIME_KEY" --metrics-token "$METRICS_TOKEN" --pid "$API_PID" \
    --label "$label" --key-prefix "$label-$(date +%s)" --concurrency "$c" --duration "$d" \
    --out "$OUT_DIR/$label.json" "$@"
}

# Comprobación en la BASE, no en la respuesta: por prefijo de clave, ninguna ejecución duplicada y
# ninguna reserva de idempotencia colgada en PROCESSING tras la recuperación.
check_no_duplicates() {
  local prefix
  prefix=$(node -e "console.log(require('$OUT_DIR/$1.json').keyPrefix)")
  local dup stuck execs keys
  dup=$(psqlq "SELECT count(*) FROM (SELECT idempotency_key FROM decision_execution WHERE idempotency_key LIKE '${prefix}-%' GROUP BY idempotency_key HAVING count(*) > 1) d")
  execs=$(psqlq "SELECT count(*) FROM decision_execution WHERE idempotency_key LIKE '${prefix}-%'")
  keys=$(psqlq "SELECT count(*) FROM decision_runtime_idempotency WHERE idempotency_key LIKE '${prefix}-%'")
  stuck=$(psqlq "SELECT count(*) FROM decision_runtime_idempotency WHERE idempotency_key LIKE '${prefix}-%' AND status = 'PROCESSING'")
  echo "{\"keyPrefix\":\"$prefix\",\"executions\":$execs,\"idempotencyRows\":$keys,\"keysWithDuplicateExecutions\":$dup,\"stuckProcessing\":$stuck}" \
    | tee "$OUT_DIR/$1.db-check.json"
}

outage() { # label container
  local label=$1 container=$2
  load "$label" "$CONCURRENCY" "$OUTAGE_TOTAL_S" --retry-seconds 120 --timeout-ms 5000 &
  local load_pid=$!
  sleep "$OUTAGE_AT_S"
  local t0; t0=$(date +%s)
  docker stop -t 1 "$container" >/dev/null
  echo "   $(date +%T) $container detenido"
  sleep "$OUTAGE_FOR_S"
  docker start "$container" >/dev/null
  echo "   $(date +%T) $container arrancado de nuevo ($(( $(date +%s) - t0 )) s fuera)"
  local tr; tr=$(date +%s)
  for _ in $(seq 1 120); do
    curl -fsS "http://127.0.0.1:${API_PORT}/health/ready" >/dev/null 2>&1 && break; sleep 1
  done
  echo "   ready de nuevo a los $(( $(date +%s) - tr )) s del arranque del contenedor"
  wait "$load_pid"
  # Las reservas colgadas se liberan por arrendamiento; se da tiempo antes de medir.
  sleep 5
  check_no_duplicates "$label"
}

start_api || exit 1
for scenario in $SCENARIOS; do
  case "$scenario" in
    scale)
      for c in $SCALE_LEVELS; do log "Escalado c=$c"; load "scale-c$c" "$c" "$SCALE_S"; done ;;
    sustained)
      log "Sostenida c=$CONCURRENCY durante ${SUSTAINED_S}s"; load sustained "$CONCURRENCY" "$SUSTAINED_S"
      check_no_duplicates sustained ;;
    throttle)
      log "Limitador por omisión (1.500/min por cliente)"; stop_api; start_api 1500 || exit 1
      load throttle 8 30; stop_api; start_api || exit 1 ;;
    redis-outage)
      log "Caída de Redis a los ${OUTAGE_AT_S}s durante ${OUTAGE_FOR_S}s"; outage redis-outage "$REDIS" ;;
    postgres-outage)
      log "Caída de Postgres a los ${OUTAGE_AT_S}s durante ${OUTAGE_FOR_S}s"; outage postgres-outage "$PG" ;;
    *) echo "escenario desconocido: $scenario" >&2 ;;
  esac
done

log "Estado final"
psqlq "SELECT 'outbox '||status||' '||count(*) FROM decision_outbox_event GROUP BY status"
psqlq "SELECT 'idempotencia '||status||' '||count(*) FROM decision_runtime_idempotency GROUP BY status"
echo "Resultados en $OUT_DIR (SHA $(git rev-parse --short HEAD))"

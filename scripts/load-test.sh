#!/usr/bin/env bash
#
# Prueba de CAPACIDAD del repartidor del outbox.
#
#   ./scripts/load-test.sh                 # curva con 1, 2 y 3 réplicas sobre 3000 eventos
#   EVENTS=10000 ./scripts/load-test.sh    # otro tamaño de lote
#   REPLICAS="1 4" ./scripts/load-test.sh  # otras réplicas
#
# Qué mide, y en qué se diferencia del catálogo de resiliencia: aquel comprueba
# CORRECCIÓN —que no se pierda ni se duplique nada—; este mide CAPACIDAD —cuántos eventos por
# segundo drena y con qué latencia—. Son preguntas distintas y por eso son scripts distintos.
#
# Corre sobre el mismo banco aislado (`compose.resilience.yml`, proyecto `atlas-resilience`),
# así que no toca la pila de desarrollo que comparten varios agentes.
#
# La latencia se mide sobre datos que el propio motor persiste: `occurred_at` es cuándo se
# confirmó el evento y `dispatched_at` cuándo se repartió. No hace falta instrumentar nada.
set -uo pipefail

COMPOSE="docker compose -f compose.resilience.yml"
EVENTS="${EVENTS:-3000}"
REPLICAS="${REPLICAS:-1 2 3}"
EVIDENCE_DIR="${EVIDENCE_DIR:-docs/reports}"
EVIDENCE="$EVIDENCE_DIR/load-run.md"
ROWS=()

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }

sql() { $COMPOSE exec -T postgres psql -U atlas -d atlas_res -tAc "$1" 2>/dev/null | tr -d '\r'; }

log "Levantando el banco aislado"
$COMPOSE up -d --build worker >/dev/null 2>&1 || { echo "No se pudo levantar el banco" >&2; exit 1; }
for i in $(seq 1 180); do
  [ "$(sql "SELECT to_regclass('public.decision_outbox_event') IS NOT NULL")" = "t" ] && break
  sleep 1
done

cleanup() {
  if [ "${KEEP_UP:-0}" != "1" ]; then
    log "Desmontando el banco"; $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for n in $REPLICAS; do
  log "Lote de $EVENTS eventos con $n réplica(s)"

  # Los consumidores se paran ANTES de encolar. Si se publicara con el worker vivo, el drenaje
  # empezaría a mitad de la inserción y el reloj mediría dos cosas mezcladas: lo que tarda
  # PostgreSQL en insertar y lo que tarda el relay en repartir.
  $COMPOSE stop worker >/dev/null 2>&1
  sql "TRUNCATE decision_processed_event, decision_notification, decision_outbox_event RESTART IDENTITY CASCADE" >/dev/null

  # Inserción masiva en una sola sentencia: `generate_series` evita que el coste del propio
  # arnés (miles de `docker exec`) domine sobre lo que se quiere medir.
  sql "INSERT INTO decision_outbox_event
         (tenant_id, event_type, schema_version, aggregate_type, aggregate_id, actor_id,
          correlation_id, payload_json, status, available_at, occurred_at)
       SELECT 1, 'version.submitted_for_review', '1', 'ArtifactVersion', 'LOAD-'||g,
              'load-suite', 'corr-'||g,
              '{\"artifactCode\":\"LOAD\",\"reviewerRoles\":[\"RISK_APPROVER\"]}'::jsonb,
              'PENDING', now(), now()
       FROM generate_series(1, $EVENTS) g" >/dev/null
  info "$EVENTS eventos encolados; arrancando $n réplica(s)"

  start=$(date +%s%N)
  $COMPOSE up -d --scale worker="$n" worker >/dev/null 2>&1

  # Se espera por CONDICIÓN, no por tiempo. El techo evita que un fallo cuelgue la suite.
  drained=0
  for i in $(seq 1 600); do
    [ "$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='PENDING'")" = "0" ] && { drained=1; break; }
    sleep 1
  done
  elapsed_ms=$(( ($(date +%s%N) - start) / 1000000 ))

  if [ "$drained" != "1" ]; then
    info "NO drenó en 600 s — se registra como saturación"
    ROWS+=("$n|$EVENTS|no drenó|—|—|—|—")
    continue
  fi

  dispatched="$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='DISPATCHED'")"
  notif="$(sql "SELECT count(*) FROM decision_notification")"
  # Throughput medido de punta a punta, incluido el arranque de las réplicas: es el número que
  # un operador ve, no el ideal del bucle interno.
  tput=$(( dispatched * 1000 / (elapsed_ms > 0 ? elapsed_ms : 1) ))
  lat="$(sql "SELECT round(percentile_cont(0.50) WITHIN GROUP (ORDER BY d))||'|'||
                     round(percentile_cont(0.95) WITHIN GROUP (ORDER BY d))||'|'||
                     round(percentile_cont(0.99) WITHIN GROUP (ORDER BY d))
              FROM (SELECT EXTRACT(EPOCH FROM (dispatched_at - occurred_at))*1000 AS d
                    FROM decision_outbox_event WHERE status='DISPATCHED') s")"
  p50="${lat%%|*}"; rest="${lat#*|}"; p95="${rest%%|*}"; p99="${rest##*|}"

  info "drenado en ${elapsed_ms} ms · ${tput} ev/s · p50=${p50}ms p95=${p95}ms p99=${p99}ms"
  # La integridad se comprueba TAMBIÉN bajo carga: un throughput alto que duplica efectos no
  # es capacidad, es un fallo.
  integrity="ok"
  [ "$dispatched" = "$EVENTS" ] || integrity="repartidos=$dispatched"
  [ "$notif" = "$EVENTS" ] || integrity="$integrity notificaciones=$notif"
  ROWS+=("$n|$EVENTS|${elapsed_ms} ms|${tput} ev/s|${p50} ms|${p95} ms|${p99} ms|$integrity")
done

log "Informe"
mkdir -p "$EVIDENCE_DIR"
{
  echo "<!-- GENERADO POR scripts/load-test.sh — no editar a mano. -->"
  echo
  echo "# Capacidad del repartidor — ejecución"
  echo
  echo "Generado por \`./scripts/load-test.sh\` contra \`compose.resilience.yml\`, un proyecto de"
  echo "Compose aislado. Latencia medida sobre \`dispatched_at - occurred_at\`, que el motor ya"
  echo "persiste; el tiempo total incluye el arranque de las réplicas."
  echo
  echo "| Réplicas | Eventos | Drenaje | Throughput | p50 | p95 | p99 | Integridad |"
  echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
  for r in "${ROWS[@]}"; do
    IFS='|' read -r a b c d e f g h <<< "$r"
    echo "| $a | $b | $c | $d | $e | $f | $g | ${h:-—} |"
  done
  echo
  echo "**Integridad \`ok\`** significa que se repartieron exactamente los eventos encolados y se"
  echo "produjo exactamente una notificación por evento: capacidad sin duplicar trabajo."
} > "$EVIDENCE"
info "Evidencia escrita en $EVIDENCE"

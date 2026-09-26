#!/usr/bin/env bash
#
# Catálogo ejecutable de escenarios de resiliencia.
#
#   ./scripts/resilience-test.sh            # todos
#   ./scripts/resilience-test.sh R08 R09    # solo los indicados
#   KEEP_UP=1 ./scripts/resilience-test.sh  # deja la pila en pie para inspeccionar
#
# Corre contra `compose.resilience.yml`, que es un proyecto de Compose APARTE. Esa separación
# no es cosmética: aquí se matan contenedores, se corta la red y se satura la cola, y este
# repositorio lo trabajan varios agentes sobre el mismo árbol
# (`docs/AGENT-COORDINATION.md`). Nada de lo que hace este script toca la pila de desarrollo.
#
# Cada escenario declara comportamiento ESPERADO y registra el OBSERVADO. El script sale con
# código distinto de cero si alguno no coincide: un catálogo que siempre pasa no informa de
# nada.
set -uo pipefail

COMPOSE="docker compose -f compose.resilience.yml"
EVIDENCE_DIR="${EVIDENCE_DIR:-docs/reports}"
EVIDENCE="$EVIDENCE_DIR/resilience-run.md"
PASS=0
FAIL=0
RESULTS=()

# ---------------------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------------------

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }

# `psql` dentro del contenedor: ni el anfitrión necesita cliente, ni la contraseña viaja por
# la línea de órdenes (donde la vería cualquier `ps`).
sql() {
  $COMPOSE exec -T postgres psql -U atlas -d atlas_res -tAc "$1" 2>/dev/null | tr -d '\r'
}

# Espera activa con condición explícita, NUNCA un `sleep` fijo: un tiempo arbitrario convierte
# una prueba en una moneda al aire, y además alarga la suite cuando el sistema va rápido.
# $1 descripción · $2 segundos máximos · $3 orden que debe devolver el valor esperado · $4 valor
wait_for() {
  local what="$1" timeout="$2" cmd="$3" expected="$4" waited=0 got=""
  while [ "$waited" -lt "$timeout" ]; do
    got="$(eval "$cmd")"
    [ "$got" = "$expected" ] && { info "$what -> $got (en ${waited}s)"; return 0; }
    sleep 1
    waited=$((waited + 1))
  done
  info "$what -> TIEMPO AGOTADO tras ${timeout}s (último valor: '$got', esperado: '$expected')"
  return 1
}

record() { # id · titulo · esperado · observado · veredicto(OK|MAL)
  local verdict="$5"
  if [ "$verdict" = "OK" ]; then PASS=$((PASS + 1)); else FAIL=$((FAIL + 1)); fi
  RESULTS+=("$1|$2|$3|$4|$verdict")
  printf '   \033[1m[%s] %s\033[0m\n' "$verdict" "$1"
}

# Inserta un evento en el outbox. El relay lo reclamará como cualquier otro: no se simula el
# mecanismo, se alimenta el real.
# $1 event_type · $2 aggregate_id · $3 payload JSON
publish() {
  sql "INSERT INTO decision_outbox_event
         (tenant_id, event_type, schema_version, aggregate_type, aggregate_id, actor_id,
          correlation_id, payload_json, status, available_at, occurred_at)
       VALUES (1, '$1', '1', 'ArtifactVersion', '$2', 'resilience-suite',
               'corr-$2', '$3'::jsonb, 'PENDING', now(), now())
       RETURNING id" | head -1
}

# ¿Se pidió este escenario? Sin argumentos, se ejecutan todos.
#
# Consulta el array `WANTED` directamente en vez de recibirlo como argumentos. La versión
# anterior lo pasaba con `"${WANTED[@]:-}"`, y ahí está la trampa: con el array VACÍO esa
# expansión no produce cero argumentos, sino UNO vacío. `[ $# -eq 0 ]` era falso, la
# comparación no casaba con ningún identificador y el catálogo entero se saltaba en silencio
# informando «0 correctos, 0 fallidos» — una suite que no ejecuta nada y no lo parece.
selected() {
  [ "${#WANTED[@]}" -eq 0 ] && return 0
  local want
  for want in "${WANTED[@]}"; do [ "$want" = "$1" ] && return 0; done
  return 1
}

# ---------------------------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------------------------

WANTED=("$@")

log "Levantando el banco aislado (proyecto atlas-resilience)"
$COMPOSE up -d --build worker >/dev/null 2>&1 || { echo "No se pudo levantar el banco" >&2; exit 1; }

if ! wait_for "worker listo" 180 \
  "$COMPOSE ps --status running --services 2>/dev/null | grep -cx worker" "1"; then
  echo "El worker no arrancó. Revise: $COMPOSE logs worker" >&2
  exit 1
fi
# Se comprueba que la tabla EXISTE, no que esté vacía: con `KEEP_UP=1` la pila sobrevive entre
# ejecuciones y quedan filas de la anterior, así que esperar un cero costaba 90 s de espera
# inútil antes de cada tanda.
wait_for "esquema disponible" 90 \
  "sql \"SELECT to_regclass('public.decision_outbox_event') IS NOT NULL\"" "t" || {
    echo "El esquema no se aplicó. Revise: $COMPOSE logs migrate" >&2; exit 1; }

cleanup() {
  if [ "${KEEP_UP:-0}" != "1" ]; then
    log "Desmontando el banco"
    $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  else
    info "KEEP_UP=1: la pila queda en pie. Desmóntela con: $COMPOSE down -v"
  fi
}
trap cleanup EXIT

ROLE_OK='["RISK_APPROVER"]'
# 200 caracteres contra una columna `recipient_role` de VARCHAR(80): el INSERT del proyector
# falla SIEMPRE, con cualquier reintento. Es un error permanente de verdad, no uno simulado.
ROLE_TOOLONG="[\"$(printf 'X%.0s' $(seq 1 200))\"]"

# ---------------------------------------------------------------------------------------
# R01 · Camino feliz: un evento se reparte y produce su efecto
# ---------------------------------------------------------------------------------------
if selected R01; then
  log "R01 · Reparto normal de un evento de dominio"
  before="$(sql "SELECT count(*) FROM decision_notification")"
  id="$(publish 'version.submitted_for_review' 'R01' "{\"artifactCode\":\"R01\",\"reviewerRoles\":$ROLE_OK}")"
  info "evento $id publicado"
  ok=1
  wait_for "estado del evento" 30 "sql \"SELECT status FROM decision_outbox_event WHERE id=$id\"" "DISPATCHED" || ok=0
  after="$(sql "SELECT count(*) FROM decision_notification")"
  [ "$((after - before))" -eq 1 ] || ok=0
  record R01 "Reparto normal" "DISPATCHED y 1 notificación" \
    "estado=$(sql "SELECT status FROM decision_outbox_event WHERE id=$id") notificaciones=+$((after - before))" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R02 · Error permanente: reintentos acotados y cola muerta
# ---------------------------------------------------------------------------------------
if selected R02; then
  log "R02 · Error permanente -> reintentos con retroceso -> DLQ"
  id="$(publish 'version.submitted_for_review' 'R02' "{\"artifactCode\":\"R02\",\"reviewerRoles\":$ROLE_TOOLONG}")"
  info "evento $id publicado (rol de 200 caracteres contra VARCHAR(80))"
  ok=1
  wait_for "estado del evento" 60 "sql \"SELECT status FROM decision_outbox_event WHERE id=$id\"" "DEAD" || ok=0
  attempts="$(sql "SELECT attempt_count FROM decision_outbox_event WHERE id=$id")"
  haserr="$(sql "SELECT CASE WHEN last_error IS NOT NULL THEN 'si' ELSE 'no' END FROM decision_outbox_event WHERE id=$id")"
  # No debe reintentar más allá del tope: reintentos infinitos son el fallo que esto previene.
  [ "$attempts" = "3" ] || ok=0
  [ "$haserr" = "si" ] || ok=0
  record R02 "Error permanente a DLQ" "DEAD tras exactamente 3 intentos, con last_error" \
    "estado=$(sql "SELECT status FROM decision_outbox_event WHERE id=$id") intentos=$attempts last_error=$haserr" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R03 · Reproceso desde la DLQ
# ---------------------------------------------------------------------------------------
if selected R03; then
  log "R03 · Reproceso de un evento muerto, ya corregida su causa"
  dead="$(sql "SELECT id FROM decision_outbox_event WHERE status='DEAD' ORDER BY id DESC LIMIT 1")"
  if [ -z "$dead" ]; then
    record R03 "Reproceso desde DLQ" "un evento DEAD disponible" "no había ninguno (ejecute R02 antes)" "MAL"
  else
    # Se corrige el dato y se reencola, que es justo el procedimiento del runbook.
    sql "UPDATE decision_outbox_event
         SET payload_json = jsonb_set(payload_json,'{reviewerRoles}','$ROLE_OK'::jsonb),
             status='PENDING', attempt_count=0, available_at=now(),
             lease_expires_at=NULL, locked_by=NULL, last_error=NULL
         WHERE id=$dead" >/dev/null
    ok=1
    wait_for "estado tras reencolar" 40 "sql \"SELECT status FROM decision_outbox_event WHERE id=$dead\"" "DISPATCHED" || ok=0
    record R03 "Reproceso desde DLQ" "DISPATCHED tras corregir y reencolar" \
      "estado=$(sql "SELECT status FROM decision_outbox_event WHERE id=$dead")" \
      "$([ $ok -eq 1 ] && echo OK || echo MAL)"
  fi
fi

# ---------------------------------------------------------------------------------------
# R04 · Mensaje duplicado: idempotencia del consumidor
# ---------------------------------------------------------------------------------------
if selected R04; then
  log "R04 · Reentrega del MISMO evento -> sin efecto duplicado"
  id="$(publish 'version.submitted_for_review' 'R04' "{\"artifactCode\":\"R04\",\"reviewerRoles\":$ROLE_OK}")"
  wait_for "primera entrega" 30 "sql \"SELECT status FROM decision_outbox_event WHERE id=$id\"" "DISPATCHED" || true
  n1="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id='R04'")"
  marks1="$(sql "SELECT count(*) FROM decision_processed_event WHERE outbox_event_id=$id")"
  # Se fuerza la reentrega exactamente como ocurriría tras un lease vencido o un reinicio.
  sql "UPDATE decision_outbox_event SET status='PENDING', available_at=now(),
       lease_expires_at=NULL, locked_by=NULL WHERE id=$id" >/dev/null
  wait_for "segunda entrega" 30 "sql \"SELECT status FROM decision_outbox_event WHERE id=$id\"" "DISPATCHED" || true
  n2="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id='R04'")"
  ok=1
  [ "$n1" = "$n2" ] || ok=0
  [ "$marks1" = "1" ] || ok=0
  record R04 "Duplicado sin efecto duplicado" "notificaciones iguales antes y después; 1 marca de proceso" \
    "antes=$n1 despues=$n2 marcas=$marks1" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R05 · Consumidores detenidos y reanudados: nada se pierde
# ---------------------------------------------------------------------------------------
if selected R05; then
  log "R05 · Detener TODOS los consumidores, publicar, reanudar"
  $COMPOSE stop worker >/dev/null 2>&1
  for i in $(seq 1 20); do
    publish 'version.submitted_for_review' "R05-$i" "{\"artifactCode\":\"R05\",\"reviewerRoles\":$ROLE_OK}" >/dev/null
  done
  pending="$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R05-%'")"
  info "con el worker parado quedan $pending pendientes (no se pierde ninguno)"
  $COMPOSE start worker >/dev/null 2>&1
  ok=1
  wait_for "drenaje tras reanudar" 120 \
    "sql \"SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R05-%'\"" "0" || ok=0
  disp="$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='DISPATCHED' AND aggregate_id LIKE 'R05-%'")"
  [ "$pending" = "20" ] || ok=0
  [ "$disp" = "20" ] || ok=0
  record R05 "Consumidores detenidos y reanudados" "20 encolados sin consumidor; 20 repartidos al volver" \
    "pendientes_con_worker_parado=$pending repartidos=$disp" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R06 · Redundancia: N réplicas no se duplican el trabajo
# ---------------------------------------------------------------------------------------
if selected R06; then
  log "R06 · Tres réplicas de worker sobre una cola saturada"
  $COMPOSE stop worker >/dev/null 2>&1
  for i in $(seq 1 150); do
    publish 'version.submitted_for_review' "R06-$i" "{\"artifactCode\":\"R06\",\"reviewerRoles\":$ROLE_OK}" >/dev/null
  done
  info "150 eventos encolados; se levantan 3 réplicas"
  $COMPOSE up -d --scale worker=3 worker >/dev/null 2>&1
  ok=1
  wait_for "drenaje con 3 réplicas" 180 \
    "sql \"SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R06-%'\"" "0" || ok=0
  # La prueba REAL de que no hubo trabajo duplicado: una notificación por evento, ni una más.
  notif="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id LIKE 'R06-%'")"
  marks="$(sql "SELECT count(*) FROM decision_processed_event pe
                JOIN decision_outbox_event oe ON oe.id = pe.outbox_event_id
                WHERE oe.aggregate_id LIKE 'R06-%'")"
  # Cuántas réplicas había DE VERDAD, preguntándoselo a Docker.
  #
  # No se cuenta `DISTINCT locked_by` sobre las filas ya repartidas, que sería lo intuitivo:
  # el relay pone `locked_by = NULL` al confirmar, así que esa consulta devuelve 0 aunque
  # hayan participado las tres. Publicarlo como «réplicas distintas: 0» daba una evidencia
  # que parecía contradecir justo lo que la prueba demuestra.
  replicas="$($COMPOSE ps worker --format '{{.Name}}' 2>/dev/null | grep -c . || echo 0)"
  [ "$notif" = "150" ] || ok=0
  [ "$marks" = "150" ] || ok=0
  [ "$replicas" -ge 3 ] || ok=0
  record R06 "Redundancia sin duplicar trabajo" "150 notificaciones y 150 marcas con 3 réplicas activas" \
    "notificaciones=$notif marcas=$marks replicas_activas=$replicas" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
  $COMPOSE up -d --scale worker=1 worker >/dev/null 2>&1
fi

# ---------------------------------------------------------------------------------------
# R07 · Apagado controlado con trabajo en vuelo
# ---------------------------------------------------------------------------------------
if selected R07; then
  log "R07 · SIGTERM con la cola llena: ni se pierde ni se confirma de más"
  for i in $(seq 1 60); do
    publish 'version.submitted_for_review' "R07-$i" "{\"artifactCode\":\"R07\",\"reviewerRoles\":$ROLE_OK}" >/dev/null
  done
  sleep 1
  $COMPOSE stop worker >/dev/null 2>&1   # `stop` envía SIGTERM y respeta stop_grace_period
  half="$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='DISPATCHED' AND aggregate_id LIKE 'R07-%'")"
  # Nadie puede quedar reclamado por un proceso que ya no existe más allá del lease.
  stuck="$(sql "SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND locked_by IS NOT NULL AND lease_expires_at > now() + interval '1 hour' AND aggregate_id LIKE 'R07-%'")"
  info "repartidos antes del apagado: $half; bloqueados indefinidamente: $stuck"
  $COMPOSE start worker >/dev/null 2>&1
  ok=1
  wait_for "drenaje tras reiniciar" 150 \
    "sql \"SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R07-%'\"" "0" || ok=0
  notif="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id LIKE 'R07-%'")"
  [ "$notif" = "60" ] || ok=0
  [ "$stuck" = "0" ] || ok=0
  record R07 "Apagado controlado" "60 eventos, 60 notificaciones, ninguno bloqueado" \
    "notificaciones=$notif bloqueados=$stuck repartidos_antes=$half" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R08 · Caída de PostgreSQL, que es el bus de este sistema
# ---------------------------------------------------------------------------------------
if selected R08; then
  log "R08 · Reinicio de PostgreSQL bajo carga"
  for i in $(seq 1 40); do
    publish 'version.submitted_for_review' "R08-$i" "{\"artifactCode\":\"R08\",\"reviewerRoles\":$ROLE_OK}" >/dev/null
  done
  $COMPOSE restart postgres >/dev/null 2>&1
  wait_for "postgres sano de nuevo" 120 \
    "$COMPOSE ps postgres --format '{{.Health}}' 2>/dev/null | head -1" "healthy" || true
  ok=1
  # El worker debe RECUPERARSE solo: sin intervención, sin reinicio manual.
  wait_for "el worker recupera y drena" 180 \
    "sql \"SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R08-%'\"" "0" || ok=0
  notif="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id LIKE 'R08-%'")"
  alive="$($COMPOSE ps --status running --services 2>/dev/null | grep -cx worker)"
  [ "$notif" = "40" ] || ok=0
  record R08 "Reinicio de la base de datos" "el worker se recupera solo y no pierde eventos" \
    "notificaciones=$notif worker_vivo=$alive" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R09 · Caída de Redis
# ---------------------------------------------------------------------------------------
if selected R09; then
  log "R09 · Reinicio de Redis"
  $COMPOSE restart redis >/dev/null 2>&1
  wait_for "redis sano de nuevo" 90 \
    "$COMPOSE ps redis --format '{{.Health}}' 2>/dev/null | head -1" "healthy" || true
  id="$(publish 'version.submitted_for_review' 'R09' "{\"artifactCode\":\"R09\",\"reviewerRoles\":$ROLE_OK}")"
  ok=1
  wait_for "reparto tras perder Redis" 60 "sql \"SELECT status FROM decision_outbox_event WHERE id=$id\"" "DISPATCHED" || ok=0
  record R09 "Reinicio de la caché" "el reparto de eventos NO depende de Redis" \
    "estado=$(sql "SELECT status FROM decision_outbox_event WHERE id=$id")" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# R10 · Pérdida temporal de red entre el worker y la base
# ---------------------------------------------------------------------------------------
if selected R10; then
  log "R10 · Desconexión de red del worker y reconexión"
  net="$($COMPOSE ps -q worker | head -1)"
  netname="atlas-resilience_res_data"
  for i in $(seq 1 25); do
    publish 'version.submitted_for_review' "R10-$i" "{\"artifactCode\":\"R10\",\"reviewerRoles\":$ROLE_OK}" >/dev/null
  done
  docker network disconnect "$netname" "$net" >/dev/null 2>&1
  info "worker desconectado de la red"
  sleep 8
  docker network connect "$netname" "$net" >/dev/null 2>&1
  info "worker reconectado"
  ok=1
  wait_for "drenaje tras recuperar la red" 180 \
    "sql \"SELECT count(*) FROM decision_outbox_event WHERE status='PENDING' AND aggregate_id LIKE 'R10-%'\"" "0" || ok=0
  notif="$(sql "SELECT count(*) FROM decision_notification WHERE entity_id LIKE 'R10-%'")"
  [ "$notif" = "25" ] || ok=0
  record R10 "Pérdida temporal de red" "sin pérdida de eventos; recuperación automática" \
    "notificaciones=$notif" \
    "$([ $ok -eq 1 ] && echo OK || echo MAL)"
fi

# ---------------------------------------------------------------------------------------
# Informe
# ---------------------------------------------------------------------------------------
log "Resultado: $PASS correctos, $FAIL fallidos"

mkdir -p "$EVIDENCE_DIR"
{
  echo "<!-- GENERADO POR scripts/resilience-test.sh — no editar a mano. -->"
  echo
  echo "# Matriz de resiliencia — ejecución"
  echo
  echo "Generado por \`./scripts/resilience-test.sh\` contra \`compose.resilience.yml\`, un"
  echo "proyecto de Compose aislado del entorno de desarrollo."
  echo
  echo "**Resultado: $PASS correctos, $FAIL fallidos.**"
  echo
  echo "| Id | Escenario | Esperado | Observado | Veredicto |"
  echo "| --- | --- | --- | --- | --- |"
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r id title expected observed verdict <<< "$r"
    echo "| $id | $title | $expected | \`$observed\` | **$verdict** |"
  done
} > "$EVIDENCE"

info "Evidencia escrita en $EVIDENCE"
[ "$FAIL" -eq 0 ]

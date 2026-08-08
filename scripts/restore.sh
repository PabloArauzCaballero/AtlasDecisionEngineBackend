#!/usr/bin/env bash
#
# Restauración de una copia creada por scripts/backup.sh.
#
#   ./scripts/restore.sh backups/atlas-20260804T221500Z.dump
#   ASSUME_YES=1 ./scripts/restore.sh <fichero>     # sin confirmación interactiva
#
# Es una operación DESTRUCTIVA: el volcado se crea con `--clean --if-exists`, así que borra los
# objetos existentes antes de recrearlos. Por eso el script pide confirmación explícita
# escribiendo el nombre de la base de datos, y no un "sí": durante una incidencia, un "sí"
# reflejo sobre la consola equivocada es exactamente cómo se pierde el entorno bueno.
set -euo pipefail

ARCHIVE="${1:-}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

# `COMPOSE_FILE` es una variable que Docker Compose ya entiende por sí solo, y admite VARIOS
# ficheros. Por eso, cuando está definida, no se pasa ningún `-f`: se deja que mande su valor.
# Forzar `-f docker-compose.yml` ignoraba las superposiciones y, en una máquina sin gVisor, la
# reanudación fallaba al intentar arrancar `script-runner` —del que depende `api`— con un
# runtime `runsc` que no existe.
#
# OJO al separador, que depende de la plataforma (`COMPOSE_PATH_SEPARATOR`): `:` en Linux y
# macOS, `;` en Windows, donde `:` ya forma parte de la letra de unidad.
#
#   # Linux / macOS
#   COMPOSE_FILE='docker-compose.yml:docker-compose.no-gvisor.yml' ./scripts/restore.sh <fichero>
#   # Windows
#   COMPOSE_FILE='docker-compose.yml;docker-compose.no-gvisor.yml' ./scripts/restore.sh <fichero>
if [ -n "${COMPOSE_FILE:-}" ]; then
  compose() { docker compose "$@"; }
else
  compose() { docker compose -f docker-compose.yml "$@"; }
fi

if [ -z "$ARCHIVE" ]; then
  echo "Uso: $0 <fichero.dump>" >&2
  exit 2
fi
if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: no existe el archivo '$ARCHIVE'." >&2
  exit 2
fi


# La integridad se comprueba ANTES de tocar la base: restaurar a medias desde un fichero
# corrupto deja un esquema entre dos estados, que es peor que no haber empezado.
if [ -f "$ARCHIVE.sha256" ]; then
  echo "==> Verificando la suma de comprobación"
  expected="$(cat "$ARCHIVE.sha256")"
  actual="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  if [ "$expected" != "$actual" ]; then
    echo "ERROR: la suma no coincide. El archivo está corrupto o incompleto." >&2
    echo "  esperada: $expected" >&2
    echo "  obtenida: $actual" >&2
    exit 1
  fi
  echo "==> Suma correcta"
else
  echo "AVISO: no hay '$ARCHIVE.sha256'; se restaura sin verificar la integridad." >&2
fi

if ! compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "ERROR: el servicio '$SERVICE' no está en ejecución." >&2
  exit 1
fi

database="$(compose exec -T "$SERVICE" sh -c 'printf %s "$POSTGRES_DB"')"

echo
echo "  Se va a RESTAURAR sobre la base de datos '$database'."
echo "  Los datos actuales de esa base se PIERDEN."
echo
if [ "${ASSUME_YES:-0}" != "1" ]; then
  printf "  Escriba el nombre de la base de datos para confirmar: "
  read -r confirmation
  if [ "$confirmation" != "$database" ]; then
    echo "==> Cancelado: la confirmación no coincide."
    exit 130
  fi
fi

# Los procesos de la aplicación se detienen durante la restauración. Dejarlos vivos significa
# que la API escribe contra un esquema que se está reemplazando por debajo, y que el worker
# reclama filas de trabajo que están a punto de desaparecer.
echo "==> Deteniendo api y worker mientras dure la restauración"
stopped=""
for service in api worker; do
  if compose ps --status running --services 2>/dev/null | grep -qx "$service"; then
    compose stop "$service" >/dev/null
    stopped="$stopped $service"
  fi
done
# El arranque se repone pase lo que pase: si `pg_restore` falla, dejar la pila apagada añade
# una segunda incidencia a la que ya se estaba atendiendo.
#
# `up -d` y NO `start`: `compose start` sobre un servicio con `depends_on` intenta levantar
# también sus dependencias de un solo disparo (`migrate`, `bootstrap-app-role`, `seed`) sin
# esperar a que estén sanas, y basta que una falle para que la reanudación entera se caiga
# dejando la API parada. Ocurrió: `migrate` respondió `P1001: Can't reach database server`
# durante la ventana de reanudación. `up -d` respeta las condiciones de `depends_on` y vuelve
# a dejar la pila como estaba.
restore_services() {
  if [ -n "$stopped" ]; then
    echo "==> Reanudando:$stopped"
    # shellcheck disable=SC2086
    compose up -d $stopped >/dev/null 2>&1 || \
      echo "AVISO: no se pudo reanudar automáticamente. Ejecute: docker compose up -d$stopped" >&2
  fi
}
trap restore_services EXIT

echo "==> Restaurando desde $ARCHIVE"
# `--clean --if-exists` va AQUÍ y no en el volcado. En formato `custom` el archivo es un
# catálogo de objetos y es `pg_restore` quien decide qué DDL emite; ponerlo en `pg_dump` no
# tiene efecto alguno. Sin esto, restaurar sobre una base que ya tiene el esquema aborta al
# primer objeto existente («type "ApprovalOutcome" already exists»), que es exactamente cómo
# se descubrió. `--if-exists` evita que los `DROP` fallen sobre una base vacía, de modo que el
# mismo mandato sirve para restaurar encima y para restaurar de cero.
#
# `--single-transaction` para que la restauración sea todo o nada. Sin él, un error a mitad
# deja la base parcialmente restaurada y sin forma sencilla de saber por dónde iba.
# `--exit-on-error` es su condición necesaria: sin ella pg_restore continúa tras un fallo y la
# transacción termina confirmando un estado incompleto.
if compose exec -T "$SERVICE" sh -c '
  pg_restore \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --clean --if-exists \
    --single-transaction \
    --exit-on-error \
    --no-owner --no-privileges
' < "$ARCHIVE"; then
  echo "==> Restauración completada"
else
  echo "ERROR: la restauración falló. La transacción se revirtió; la base queda como estaba." >&2
  exit 1
fi

# La contraseña del rol de aplicación NO viaja en el volcado (`--no-privileges`), así que hay
# que reponerla o la API no podrá conectarse como `atlas_app` y arrancará en bucle con un
# error de autenticación que no parece tener relación con la restauración.
echo "==> Reponiendo la credencial del rol de aplicación"
compose run --rm bootstrap-app-role >/dev/null

# Las migraciones se aplican después: la copia puede ser anterior al esquema que espera el
# código desplegado. Es idempotente — si el volcado ya estaba al día, no hay nada que aplicar.
echo "==> Aplicando migraciones pendientes"
compose run --rm migrate

echo "==> Verificando"
compose exec -T "$SERVICE" sh -c '
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -tAc \
    "SELECT '\''tablas restauradas: '\'' || count(*) FROM information_schema.tables WHERE table_schema = '\''public'\''"
'

echo "==> Listo. Revise el estado antes de reanudar el tráfico: docker compose ps"

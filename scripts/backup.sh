#!/usr/bin/env bash
#
# Copia de seguridad lógica de la base de decisiones.
#
#   ./scripts/backup.sh                      # a ./backups
#   BACKUP_DIR=/mnt/nas ./scripts/backup.sh  # a otro destino
#   RETENTION_DAYS=30 ./scripts/backup.sh
#
# Se ejecuta DENTRO del contenedor de Postgres (`docker compose exec`) y no con un `pg_dump`
# del anfitrión, por dos razones que no son de comodidad:
#
#   1. La versión de `pg_dump` debe ser >= la del servidor. Un `pg_dump` 14 del portátil
#      contra un servidor 16 aborta, y el momento de descubrirlo no puede ser el primer
#      intento de copia antes de una migración.
#   2. Con la superposición de producción, Postgres no publica ningún puerto. Un cliente del
#      anfitrión no tendría por dónde conectarse; `exec` no lo necesita.
#
# Formato `custom` (-Fc) y no SQL plano: permite restaurar tablas sueltas, va comprimido de
# origen y `pg_restore` puede paralelizar. El fichero NO es legible con un editor, que es
# justo lo que se quiere de un volcado que contiene decisiones de crédito.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

# Las credenciales salen del entorno del propio contenedor y NO de este script ni de la línea
# de órdenes: un argumento se ve en `ps` de cualquier usuario de la máquina.
#
# `COMPOSE_FILE` la entiende Docker Compose por sí solo y admite varios ficheros separados por
# `:`, así que cuando está definida no se pasa ningún `-f` y manda su valor.
if [ -n "${COMPOSE_FILE:-}" ]; then
  compose() { docker compose "$@"; }
else
  compose() { docker compose -f docker-compose.yml "$@"; }
fi

if ! compose ps --status running --services 2>/dev/null | grep -qx "$SERVICE"; then
  echo "ERROR: el servicio '$SERVICE' no está en ejecución. Arranque la pila antes de la copia." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/atlas-${timestamp}.dump"

echo "==> Volcando la base de datos a $target"

# NO se pasa `--clean` aquí, y no es un olvido. En formato `custom` el volcado es un CATÁLOGO
# de objetos, no un guion SQL: quien decide qué DDL se emite —y por tanto si se emiten los
# `DROP`— es `pg_restore`, no `pg_dump`. Poner `--clean` en el volcado no hace nada y da una
# falsa sensación de que la restauración limpiará sola; el resultado es que restaurar sobre una
# base poblada falla con «type ... already exists». Por eso el `--clean --if-exists` vive en
# `restore.sh`, que es donde surte efecto. Comprobado a base de fallar la primera restauración.
#
# `--no-owner` y `--no-privileges` evitan que la restauración falle en un servidor donde el rol
# `atlas` o `atlas_app` todavía no existe: la propiedad la reponen las migraciones y
# `set-app-db-role.mjs`, no el volcado.
#
# `-T` (sin TTY): con TTY, Docker traduce saltos de línea y CORROMPE el binario en silencio.
# Es el fallo clásico de este script y solo se descubre al intentar restaurar.
compose exec -T "$SERVICE" sh -c '
  set -e
  pg_dump \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format=custom \
    --compress=9 \
    --no-owner --no-privileges
' > "$target"

if [ ! -s "$target" ]; then
  echo "ERROR: el volcado quedó vacío. No se conserva un fichero que no restaura." >&2
  rm -f "$target"
  exit 1
fi

# Suma de comprobación junto al volcado: una copia que se corrompió en el almacenamiento y una
# copia íntegra son indistinguibles hasta que se intenta restaurar, que siempre es el peor
# momento para enterarse. `restore.sh` la verifica antes de tocar nada.
sha256sum "$target" | awk '{print $1}' > "$target.sha256"

size="$(du -h "$target" | cut -f1)"
echo "==> Copia completada: $target ($size)"
echo "==> SHA-256: $(cat "$target.sha256")"

# Verificación real de que el fichero es un archivo de pg_restore legible y no un flujo
# truncado. Cuesta segundos y convierte "se creó un fichero" en "se creó una copia".
#
# El archivo se materializa en /tmp DENTRO del contenedor antes de listarlo. No es un rodeo:
# un archivo en formato `custom` lleva su índice al final y `pg_restore` necesita poder hacer
# `seek`. Alimentarlo por una tubería —`pg_restore --list /dev/stdin`— falla siempre, incluso
# con un volcado perfectamente válido, porque la tubería no es posicionable. Es justo el error
# que dio esta comprobación en su primera versión, y habría marcado como inservible una copia
# que estaba bien.
echo "==> Verificando la integridad del archivo"
if compose exec -T "$SERVICE" sh -c '
  set -e
  tmp="$(mktemp /tmp/atlas-verify.XXXXXX)"
  # `trap` y no un `rm` al final: si `pg_restore` falla, el temporal se borra igual y no queda
  # una copia del volcado dentro del contenedor.
  trap "rm -f \"$tmp\"" EXIT INT TERM
  cat > "$tmp"
  pg_restore --list "$tmp" > /dev/null
' < "$target"; then
  echo "==> Verificación correcta: el archivo tiene un índice legible"
else
  echo "ERROR: pg_restore no puede leer el archivo recién creado." >&2
  echo "       Se CONSERVA en $target para inspección, pero NO cuenta como copia válida" >&2
  echo "       y no se ha purgado ninguna copia anterior." >&2
  exit 1
fi

if [ "$RETENTION_DAYS" -gt 0 ]; then
  echo "==> Purgando copias de más de $RETENTION_DAYS días en $BACKUP_DIR"
  # `-mtime +N` sobre los dos ficheros. Se hace DESPUÉS de verificar la copia nueva: purgar
  # antes dejaría una ventana en la que se han borrado las antiguas y la nueva no sirve.
  find "$BACKUP_DIR" -maxdepth 1 -name 'atlas-*.dump' -mtime "+$RETENTION_DAYS" -print -delete
  find "$BACKUP_DIR" -maxdepth 1 -name 'atlas-*.dump.sha256' -mtime "+$RETENTION_DAYS" -delete
fi

echo "==> Listo. Para restaurar:  ./scripts/restore.sh $target"

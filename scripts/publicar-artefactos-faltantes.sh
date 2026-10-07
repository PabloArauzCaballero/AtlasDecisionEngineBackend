#!/bin/sh
# Publica en el Motor de un entorno los artefactos que faltan y los manda a revisión (NO despliega:
# eso lo hacen después dos personas distintas; ver docs/runbooks/publicar-todos-los-artefactos.md).
# Es el nombre histórico: hoy sólo llama a publicar-todos-los-artefactos.mjs, que lee la lista de
# lib/artefactos.manifiesto.json en vez de llevar tres guiones escritos aquí.
#
#   MANAGEMENT_API_KEY=… sh scripts/publicar-artefactos-faltantes.sh http://161.97.85.216:<puerto> [--environments STAGING] [--dry-run]
set -eu
BASE="${1:?Falta la URL base del Motor}"; shift || true
: "${MANAGEMENT_API_KEY:?Falta MANAGEMENT_API_KEY (la de gestión, no la de runtime)}"
cd "$(dirname "$0")/.."
exec node scripts/publicar-todos-los-artefactos.mjs --base "$BASE" "$@"

#!/bin/sh
# Publica en el Motor de un entorno los artefactos que faltan y los manda a revisión (NO despliega:
# eso lo hacen después dos personas distintas; ver docs/runbooks/artefactos-en-un-entorno-nuevo.md).
#
#   MANAGEMENT_API_KEY=… sh scripts/publicar-artefactos-faltantes.sh http://161.97.85.216:<puerto> [--dry-run]
set -eu
BASE="${1:?Falta la URL base del Motor}"; shift || true
: "${MANAGEMENT_API_KEY:?Falta MANAGEMENT_API_KEY (la de gestión, no la de runtime)}"
cd "$(dirname "$0")/.."
echo "== Antes"; node scripts/verificar-artefactos-publicados.mjs --base "$BASE" || true
for guion in atlas-underwriting-v2 riesgo-onboarding-cliente partner-kyb-review; do
  echo "== $guion"; node "scripts/$guion.mjs" --base "$BASE" "$@"
done
echo "== Después"; node scripts/verificar-artefactos-publicados.mjs --base "$BASE"

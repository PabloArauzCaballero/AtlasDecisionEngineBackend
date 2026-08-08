#!/usr/bin/env bash
# Envoltorio POSIX de scripts/verify-jaeger.mjs.
#
# La verificación se escribió en Node y no en bash porque este repositorio se desarrolla también
# en Windows —donde `scripts/smoke.sh` convive con `smoke.ps1` por el mismo motivo— y porque así
# no depende de `curl` ni de `jq`, que no están garantizados en toda máquina de CI. Node ya es
# un requisito del proyecto.
#
# Uso:
#   ./scripts/verify-jaeger.sh
#   BASE_URL=http://localhost:3000 JAEGER_URL=http://localhost:16686 ./scripts/verify-jaeger.sh
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "node no está en el PATH; es un requisito del proyecto (ver docs/getting-started)." >&2
  exit 1
fi

exec node "$(dirname "$0")/verify-jaeger.mjs" "$@"

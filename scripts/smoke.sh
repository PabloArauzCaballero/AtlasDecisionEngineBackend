#!/usr/bin/env bash
set -euo pipefail

export BASE_URL="${BASE_URL:-http://localhost:3000}"
export RUNTIME_API_KEY="${RUNTIME_API_KEY:-local-runtime-key-change-before-sharing}"
export MANAGEMENT_API_KEY="${MANAGEMENT_API_KEY:-local-management-key-change-before-sharing}"
export TENANT_ID="${TENANT_ID:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/smoke.mjs"

#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper: every setting comes from .env (loaded by smoke.mjs) or from the environment,
# so the smoke can never authenticate with a credential that lives in this file instead of in
# configuration. Exported values already present here still win over the file.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/smoke.mjs"

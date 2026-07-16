#!/usr/bin/env bash
set -euo pipefail
JAR="${1:-plantuml.jar}"
FORMAT="${2:-svg}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/rendered"
mkdir -p "$OUT"

if [[ ! -f "$JAR" ]]; then
  echo "No se encontró plantuml.jar en: $JAR" >&2
  exit 1
fi

count=0
for file in "$ROOT"/*.puml; do
  [[ -e "$file" ]] || continue
  echo "[ATLAS] Compilando $(basename "$file")..."
  java -jar "$JAR" "-t$FORMAT" -charset UTF-8 -o "$OUT" "$file"
  count=$((count+1))
done

echo "OK: $count diagramas compilados en $OUT"

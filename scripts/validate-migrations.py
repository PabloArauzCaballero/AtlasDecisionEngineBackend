#!/usr/bin/env python3
"""Static consistency checks for the complete PostgreSQL migration chain."""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema = (ROOT / "prisma/schema.prisma").read_text(encoding="utf-8")
migration_files = sorted((ROOT / "prisma/migrations").glob("*/migration.sql"))
if not migration_files:
    raise SystemExit("No Prisma migrations found")
sql = "\n".join(path.read_text(encoding="utf-8") for path in migration_files)

model_tables: set[str] = set()
for match in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", schema, flags=re.M | re.S):
    model_name, body = match.groups()
    mapped = re.search(r'@@map\("([^"]+)"\)', body)
    model_tables.add(mapped.group(1) if mapped else model_name)
tables = set(re.findall(r'^CREATE TABLE\s+"([^"]+)"', sql, flags=re.M))
if model_tables != tables:
    raise SystemExit(
        f"Model/table mismatch: SQL-only={sorted(tables-model_tables)}, "
        f"schema-only={sorted(model_tables-tables)}"
    )

if "DEFAULT 'now(" in sql:
    raise SystemExit("Malformed now() default found")

created_names = [
    *re.findall(r'CONSTRAINT\s+"([^"]+)"', sql),
    *re.findall(r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"', sql),
]
renamed_names = re.findall(r'RENAME TO\s+"([^"]+)"', sql)
long_names = sorted(
    name for name in [*created_names, *renamed_names] if len(name.encode("utf-8")) > 63
)
if long_names:
    raise SystemExit(f"PostgreSQL identifiers exceed 63 bytes: {long_names}")
duplicates = sorted(name for name, count in Counter(created_names).items() if count > 1)
if duplicates:
    raise SystemExit(f"Duplicate SQL object names: {duplicates}")

created_types = set(re.findall(r'^CREATE TYPE\s+"([^"]+)"', sql, flags=re.M))
schema_enums = set(re.findall(r"^enum\s+(\w+)\s*\{", schema, flags=re.M))
if created_types != schema_enums:
    raise SystemExit(f"Enum mismatch: SQL-only={created_types-schema_enums}, schema-only={schema_enums-created_types}")

print(
    f"OK: {len(migration_files)} migrations, {len(model_tables)} models/tables, "
    f"{len(schema_enums)} enums, {len(created_names)} named constraints/indexes"
)

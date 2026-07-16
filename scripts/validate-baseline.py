#!/usr/bin/env python3
"""Static consistency checks for the generated PostgreSQL baseline."""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema = (ROOT / "prisma/schema.prisma").read_text(encoding="utf-8")
sql = (ROOT / "prisma/migrations/20260712190000_init/migration.sql").read_text(encoding="utf-8")

models = re.findall(r"^model\s+(\w+)\s*\{", schema, flags=re.M)
tables = re.findall(r'^CREATE TABLE\s+"([^"]+)"', sql, flags=re.M)
if len(models) != len(tables):
    raise SystemExit(f"Model/table mismatch: {len(models)} Prisma models vs {len(tables)} SQL tables")

if "DEFAULT 'now(" in sql:
    raise SystemExit("Malformed now() default found")

names = re.findall(r'(?:CONSTRAINT|INDEX)\s+"([^"]+)"', sql)
long_names = sorted(name for name in names if len(name.encode("utf-8")) > 63)
if long_names:
    raise SystemExit(f"PostgreSQL identifiers exceed 63 bytes: {long_names}")
duplicates = sorted(name for name, count in Counter(names).items() if count > 1)
if duplicates:
    raise SystemExit(f"Duplicate SQL object names: {duplicates}")

created_types = set(re.findall(r'^CREATE TYPE\s+"([^"]+)"', sql, flags=re.M))
schema_enums = set(re.findall(r"^enum\s+(\w+)\s*\{", schema, flags=re.M))
if created_types != schema_enums:
    raise SystemExit(f"Enum mismatch: SQL-only={created_types-schema_enums}, schema-only={schema_enums-created_types}")

print(f"OK: {len(models)} models/tables, {len(schema_enums)} enums, {len(names)} named constraints/indexes")

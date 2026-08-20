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
tenant_tables: set[str] = set()
for match in re.finditer(r"^model\s+(\w+)\s*\{(.*?)^\}", schema, flags=re.M | re.S):
    model_name, body = match.groups()
    mapped = re.search(r'@@map\("([^"]+)"\)', body)
    table_name = mapped.group(1) if mapped else model_name
    model_tables.add(table_name)
    if re.search(r'^\s+tenantId\s+.*@map\("tenant_id"\)', body, flags=re.M):
        tenant_tables.add(table_name)
tables = set(re.findall(r'^CREATE TABLE\s+"([^"]+)"', sql, flags=re.M))
if model_tables != tables:
    raise SystemExit(
        f"Model/table mismatch: SQL-only={sorted(tables-model_tables)}, "
        f"schema-only={sorted(model_tables-tables)}"
    )

# A tenant_id column without database-enforced RLS is an isolation vulnerability even
# when every current service remembers a tenant filter. Check the full chain rather than
# only the latest migration, because policies are intentionally added after baseline tables.
#
# Two forms count. The literal one, and the DO-block loop that applies the same statements
# to a list of tables through `EXECUTE format(..., %I)`. Reading only the literal form made
# this gate report six tables as unprotected while the database had RLS enabled, forced and
# policied on all six — a security check that cries wolf gets waved through, and the next
# time it is right nobody will believe it.
def _static(pattern: str) -> set[str]:
    return set(re.findall(pattern, sql))


def _dynamic(template: str) -> set[str]:
    """Tables covered by `EXECUTE format('<template with %I>', target)` inside a DO block."""
    covered: set[str] = set()
    for block in re.findall(r"DO\s+\$\$(.*?)\$\$\s*;", sql, flags=re.S):
        if not re.search(r"format\(\s*'" + template + r"'", block):
            continue
        for array in re.findall(r"IN ARRAY ARRAY\[(.*?)\]", block, flags=re.S):
            covered.update(re.findall(r"'([^']+)'", array))
    return covered


rls_enabled = _static(r'ALTER TABLE\s+"([^"]+)"\s+ENABLE ROW LEVEL SECURITY') | _dynamic(
    r"ALTER TABLE %I ENABLE ROW LEVEL SECURITY"
)
rls_forced = _static(r'ALTER TABLE\s+"([^"]+)"\s+FORCE ROW LEVEL SECURITY') | _dynamic(
    r"ALTER TABLE %I FORCE ROW LEVEL SECURITY"
)
# El nombre de la política se acepta con comillas y sin ellas. En SQL son el mismo objeto
# —`tenant_isolation` va en minúsculas y no necesita comillas—, pero leyendo sólo la forma
# desnuda este gate declaraba desprotegida `decision_unresolved_classification`, que llevaba
# sus tres sentencias desde el día que se creó. Es el mismo error que el bloque de arriba
# documenta haber cometido con las tablas del DO-block: un control que acusa en falso se
# desactiva a mano la segunda vez, y entonces ya no protege de nada.
tenant_policies = _static(r'CREATE POLICY\s+"?tenant_isolation"?\s+ON\s+"([^"]+)"') | _dynamic(
    r"CREATE POLICY tenant_isolation ON %I.*?"
)
for label, protected in [
    ("RLS ENABLE", rls_enabled),
    ("RLS FORCE", rls_forced),
    ("tenant_isolation policy", tenant_policies),
]:
    missing = sorted(tenant_tables - protected)
    if missing:
        raise SystemExit(f"Tenant tables missing {label}: {missing}")

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
# Un índice que se BORRA y se vuelve a crear con el mismo nombre no es un duplicado: es el mismo
# objeto rehecho, que es la forma correcta de cambiarle la definición (PostgreSQL no tiene ALTER
# INDEX para eso). Contando sólo las creaciones, este gate acusaba de duplicado a un `DROP INDEX`
# + `CREATE INDEX` legítimo — y la única salida que deja es renombrar el índice, es decir,
# empeorar el esquema para contentar al validador.
#
# Se descuenta una creación por cada borrado previo del mismo nombre. Dos creaciones sin borrado
# entre medias siguen siendo el error que este control busca.
dropped_names = Counter(re.findall(r'DROP INDEX\s+(?:IF EXISTS\s+)?"([^"]+)"', sql))
duplicates = sorted(
    name
    for name, count in Counter(created_names).items()
    if count - dropped_names.get(name, 0) > 1
)
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

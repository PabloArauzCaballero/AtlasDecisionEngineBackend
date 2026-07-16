#!/usr/bin/env python3
"""Generate a PostgreSQL baseline migration from this project's Prisma schema.

This intentionally supports the schema constructs used by ATLAS and is not a
replacement for Prisma Migrate. It exists so the source archive contains a
reviewable, deterministic initial migration even in restricted build networks.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "prisma" / "schema.prisma"
OUTPUT = ROOT / "prisma" / "migrations" / "20260712190000_init" / "migration.sql"

@dataclass
class Field:
    name: str
    column: str
    type_name: str
    optional: bool
    attrs: str

@dataclass
class Relation:
    local_fields: list[str]
    target_model: str
    target_fields: list[str]
    on_delete: str | None

@dataclass
class Model:
    name: str
    table: str
    fields: list[Field] = field(default_factory=list)
    relations: list[Relation] = field(default_factory=list)
    uniques: list[list[str]] = field(default_factory=list)
    indexes: list[list[str]] = field(default_factory=list)

text = SCHEMA.read_text(encoding="utf-8")

enums: dict[str, list[str]] = {}
for match in re.finditer(r"enum\s+(\w+)\s*\{(.*?)\n\}", text, flags=re.S):
    values = []
    for raw in match.group(2).splitlines():
        raw = raw.strip()
        if raw and not raw.startswith("//"):
            values.append(raw.split()[0])
    enums[match.group(1)] = values

raw_models: dict[str, str] = {
    match.group(1): match.group(2)
    for match in re.finditer(r"model\s+(\w+)\s*\{(.*?)\n\}", text, flags=re.S)
}

models: dict[str, Model] = {}
scalar_types = {"BigInt", "String", "Int", "Boolean", "DateTime", "Json", "Decimal", "Float", "Bytes"}

for name, body in raw_models.items():
    table_match = re.search(r"@@map\(\"([^\"]+)\"\)", body)
    model = Model(name=name, table=table_match.group(1) if table_match else name)
    models[name] = model

for name, body in raw_models.items():
    model = models[name]
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("@@unique"):
            model.uniques.append(re.findall(r"\w+", re.search(r"\[(.*?)\]", line).group(1)))
            continue
        if line.startswith("@@index"):
            model.indexes.append(re.findall(r"\w+", re.search(r"\[(.*?)\]", line).group(1)))
            continue
        if line.startswith("@@"):
            continue
        parts = line.split(None, 2)
        if len(parts) < 2:
            continue
        field_name, type_token = parts[0], parts[1]
        attrs = parts[2] if len(parts) > 2 else ""
        optional = type_token.endswith("?")
        list_type = type_token.endswith("[]")
        base_type = type_token.rstrip("?[]")
        if list_type:
            continue
        if base_type not in scalar_types and base_type not in enums:
            relation_match = re.search(r"@relation\((.*?)\)", attrs)
            if relation_match and "fields:" in relation_match.group(1):
                args = relation_match.group(1)
                local = re.findall(r"\w+", re.search(r"fields:\s*\[(.*?)\]", args).group(1))
                target = re.findall(r"\w+", re.search(r"references:\s*\[(.*?)\]", args).group(1))
                delete_match = re.search(r"onDelete:\s*(\w+)", args)
                model.relations.append(Relation(local, base_type, target, delete_match.group(1) if delete_match else None))
            continue
        map_match = re.search(r"@map\(\"([^\"]+)\"\)", attrs)
        column = map_match.group(1) if map_match else field_name
        model.fields.append(Field(field_name, column, base_type, optional, attrs))
        if "@unique" in attrs:
            model.uniques.append([field_name])


def q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def db_object_name(raw: str) -> str:
    """Keep PostgreSQL identifiers at <=63 bytes with a deterministic suffix."""
    encoded = raw.encode("utf-8")
    if len(encoded) <= 63:
        return raw
    digest = hashlib.sha1(encoded).hexdigest()[:8]
    # Current generated names are ASCII, so character and byte lengths match.
    return f"{raw[:54]}_{digest}"


def sql_type(f: Field) -> str:
    a = f.attrs
    if f.type_name in enums:
        return q(f.type_name)
    if f.type_name == "BigInt":
        return "BIGINT"
    if f.type_name == "Int":
        return "INTEGER"
    if f.type_name == "Boolean":
        return "BOOLEAN"
    if f.type_name == "Float":
        return "DOUBLE PRECISION"
    if f.type_name == "DateTime":
        m = re.search(r"@db\.Timestamptz\((\d+)\)", a)
        return f"TIMESTAMPTZ({m.group(1)})" if m else "TIMESTAMPTZ"
    if f.type_name == "Json":
        return "JSONB"
    if f.type_name == "Decimal":
        m = re.search(r"@db\.Decimal\((\d+)\s*,\s*(\d+)\)", a)
        return f"DECIMAL({m.group(1)}, {m.group(2)})" if m else "DECIMAL"
    if f.type_name == "Bytes":
        return "BYTEA"
    if f.type_name == "String":
        m = re.search(r"@db\.VarChar\((\d+)\)", a)
        if m:
            return f"VARCHAR({m.group(1)})"
        if "@db.Text" in a:
            return "TEXT"
        return "TEXT"
    raise ValueError(f"Unsupported field type: {f.type_name}")


def default_sql(f: Field) -> str:
    a = f.attrs
    if "@default(autoincrement())" in a:
        return " GENERATED BY DEFAULT AS IDENTITY"
    if "@default(now())" in a:
        return " DEFAULT CURRENT_TIMESTAMP"
    m = re.search(r"@default\((.*?)\)", a)
    if not m:
        return " DEFAULT CURRENT_TIMESTAMP" if "@updatedAt" in a else ""
    value = m.group(1).strip()
    if value == "now()":
        return " DEFAULT CURRENT_TIMESTAMP"
    if value in {"true", "false"}:
        return f" DEFAULT {value.upper()}"
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return f" DEFAULT {value}"
    if value.startswith('"') and value.endswith('"'):
        return " DEFAULT '" + value[1:-1].replace("'", "''") + "'"
    return " DEFAULT '" + value.replace("'", "''") + "'"

lines: list[str] = [
    "-- ATLAS Decision Platform baseline migration",
    "-- Generated from prisma/schema.prisma by scripts/generate-baseline-sql.py",
    "-- Review before applying to an existing database.",
    "",
]
for enum_name, values in enums.items():
    rendered = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    lines.append(f"CREATE TYPE {q(enum_name)} AS ENUM ({rendered});")
lines.append("")

for model in models.values():
    definitions: list[str] = []
    primary_fields: list[str] = []
    for f in model.fields:
        definition = f"  {q(f.column)} {sql_type(f)}{default_sql(f)}"
        if not f.optional:
            definition += " NOT NULL"
        definitions.append(definition)
        if "@id" in f.attrs:
            primary_fields.append(f.column)
    if primary_fields:
        definitions.append("  PRIMARY KEY (" + ", ".join(q(c) for c in primary_fields) + ")")
    lines.append(f"CREATE TABLE {q(model.table)} (\n" + ",\n".join(definitions) + "\n);")
    lines.append("")

for model in models.values():
    field_map = {f.name: f.column for f in model.fields}
    for index, unique in enumerate(model.uniques, start=1):
        cols = [field_map[n] for n in unique]
        cname = db_object_name(f"{model.table}_{'_'.join(cols)}_key")
        lines.append(f"ALTER TABLE {q(model.table)} ADD CONSTRAINT {q(cname)} UNIQUE ({', '.join(q(c) for c in cols)});")
    for index, cols_raw in enumerate(model.indexes, start=1):
        cols = [field_map[n] for n in cols_raw]
        iname = db_object_name(f"{model.table}_{'_'.join(cols)}_idx")
        lines.append(f"CREATE INDEX {q(iname)} ON {q(model.table)} ({', '.join(q(c) for c in cols)});")
    for rel_idx, rel in enumerate(model.relations, start=1):
        target = models[rel.target_model]
        target_map = {f.name: f.column for f in target.fields}
        local_cols = [field_map[n] for n in rel.local_fields]
        target_cols = [target_map[n] for n in rel.target_fields]
        cname = db_object_name(f"{model.table}_{'_'.join(local_cols)}_fkey")
        delete = {
            "Cascade": "CASCADE",
            "Restrict": "RESTRICT",
            "SetNull": "SET NULL",
            "NoAction": "NO ACTION",
        }.get(rel.on_delete or "", "NO ACTION")
        lines.append(
            f"ALTER TABLE {q(model.table)} ADD CONSTRAINT {q(cname)} "
            f"FOREIGN KEY ({', '.join(q(c) for c in local_cols)}) "
            f"REFERENCES {q(target.table)} ({', '.join(q(c) for c in target_cols)}) "
            f"ON DELETE {delete} ON UPDATE CASCADE;"
        )
    if model.uniques or model.indexes or model.relations:
        lines.append("")

OUTPUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
print(f"Wrote {OUTPUT} ({len(lines)} statements/blocks)")

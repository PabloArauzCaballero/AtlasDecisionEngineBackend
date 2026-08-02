# Migración: contexto RLS vacío

Corrige el caso PostgreSQL donde un GUC transaccional revertido queda como cadena vacía. A nivel de
negocio evita fallos intermitentes sin relajar aislamiento; a nivel de sistema usa `NULLIF` antes de
convertir `app.tenant_id` a BIGINT.

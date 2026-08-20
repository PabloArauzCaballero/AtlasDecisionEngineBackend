---
title: "Verificación de producción — Atlas Decision Engine (backend)"
tags:
  - skills
  - entorno-asistido
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/skills/production-verification/SKILL.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Verificación de producción — Atlas Decision Engine (backend)

!!! abstract "Ficha de la skill"
    **Invocación:** `production-verification` · **Fuente canónica:** `.claude/skills/production-verification/SKILL.md`

    **Descripción registrada:** Corre y evidencia todos los gates del backend Atlas (prisma validate, migrate, typecheck, build, test, e2e, smoke, OpenAPI) contra infraestructura real, y solo declara "listo" con salida real. Úsala antes de decir que un cambio funciona o antes de un release.

    **Naturaleza:** es un procedimiento, no una autorización. No habilita tocar producción,
    publicar cambios ni reiniciar datos.

## Propósito
Producir evidencia real de que el backend está sano, no una declaración de fe.

## Cuándo usarla
- Antes de declarar que una feature "funciona".
- Antes de un merge a `main` o un release.

## Cuándo NO usarla
- Para cambios que solo tocan docs o comentarios sin superficie de ejecución.

## Fuentes obligatorias
`package.json` (scripts), `docker-compose.yml`, `docs/testing-report.md`.

## Condiciones para detenerse
- Falta infraestructura (Postgres/Redis) que no puedas levantar de forma segura y
  aislada → documenta el dato exacto que falta y sigue con lo que sí puedas.
- Cualquier gate requiere producción, secretos u OAuth → detente y reporta.

## Flujo por fases
1. Levanta infraestructura **aislada y desechable** (NO la base compartida):
   `POSTGRES_PORT=<libre> REDIS_PORT=<libre> POSTGRES_DB=<propia> docker compose -p <proyecto-propio> up -d postgres redis`.
2. `yarn prisma:validate`.
3. Aplica la cadena completa: `prisma migrate deploy` (usa el rol elevado /
   `ADMIN_DATABASE_URL`; NUNCA `prisma migrate reset` — está prohibido para
   agentes). Activa el rol `atlas_app` con `scripts/set-app-db-role.mjs`.
4. `yarn typecheck` → `yarn build`.
5. `yarn test` (unit + integración) → `yarn test:e2e`.
6. Siembra (`yarn prisma:seed`) y corre `yarn smoke` contra una instancia viva.
7. Con `SWAGGER_ENABLED=true`, descarga `/docs/openapi.json` y confirma que los
   endpoints nuevos aparecen.

## Comandos permitidos
Los gates de arriba; `docker compose up -d`/`down -v` sobre un proyecto Docker
propio.

## Comandos prohibidos
`prisma migrate reset`, `git push`, tocar la base compartida de otra sesión,
cualquier cosa que requiera secretos/producción.

## Evidencia requerida
Salida literal de cada gate. Sin `PASS` sin salida.

## Entregable
Una tabla criterio → PASS/FAIL → evidencia (ver `docs/testing-report.md` como
formato de referencia).

## Lista de verificación final
- [ ] Infra aislada, no la compartida.
- [ ] Cadena de migraciones completa aplicada.
- [ ] Todos los gates con salida real.
- [ ] Límites externos documentados, no ocultados.

## Limitaciones
La ejecución real de scripts requiere `SCRIPT_NODES_ENABLED=true` (fuera de
producción, modo IN_PROCESS) o el sidecar gVisor (producción).

## Trazabilidad
`CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §9; `docs/testing-report.md`.

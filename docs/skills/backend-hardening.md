---
title: "Endurecimiento del backend — Atlas Decision Engine"
tags:
  - skills
  - entorno-asistido
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/skills/backend-hardening/SKILL.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Endurecimiento del backend — Atlas Decision Engine

!!! abstract "Ficha de la skill"
    **Invocación:** `backend-hardening` · **Fuente canónica:** `.claude/skills/backend-hardening/SKILL.md`

    **Descripción registrada:** Auditoría por fases del backend Atlas (inventario, correctitud, seguridad, integridad de datos, observabilidad, rendimiento, pruebas) para endurecerlo antes de producción, con evidencia real y sin cambios destructivos. Úsala para una revisión integral de una feature o del servicio.

    **Naturaleza:** es un procedimiento, no una autorización. No habilita tocar producción,
    publicar cambios ni reiniciar datos.

## Propósito
Recorrer el backend por fases y dejar una lista priorizada de mejoras concretas,
apoyada en evidencia, sin romper nada.

## Cuándo usarla
- Revisión integral de una feature nueva o del servicio antes de producción.

## Cuándo NO usarla
- Un cambio pequeño y acotado (usa `security-audit` o `production-verification`).

## Fuentes obligatorias
`src/**`, `prisma/schema.prisma`, `.claude/rules/**`, `docs/**`.

## Condiciones para detenerse
Contradicción crítica, secreto expuesto, o necesidad de tocar producción.

## Flujo por fases
1. **Inventario**: módulos, endpoints, tablas, migraciones, jobs. Mapea la
   superficie (usa graphify si está: `graphify query "..."`).
2. **Correctitud**: caminos de decisión deterministas; el motor falla cerrado
   (fail-closed) ante entrada faltante; salidas requeridas verificadas.
3. **Seguridad**: aplica la skill `security-audit`.
4. **Integridad de datos**: transacciones atómicas acción+auditoría; FKs y CHECKs
   en migraciones; idempotencia con lease donde aplique.
5. **Observabilidad**: logs estructurados, métricas nombradas, correlación.
6. **Rendimiento**: paginación/keyset, sin I/O en transacciones, cotas de
   ejecución.
7. **Pruebas**: cobertura del núcleo de lógica + e2e del camino crítico.

## Comandos permitidos
Lectura, `grep`, graphify, y los gates de `production-verification`.

## Comandos prohibidos
Cambios destructivos; `git push`; producción; secretos.

## Evidencia requerida
Cada hallazgo cita archivo/línea o salida de gate.

## Entregable
Reporte con hallazgos por fase, severidad y recomendación accionable.

## Lista de verificación final
- [ ] Cada fase recorrida con evidencia.
- [ ] Hallazgos priorizados, no genéricos.
- [ ] Ningún cambio destructivo aplicado sin aprobación.

## Limitaciones
Es una auditoría; aplicar los cambios es un paso posterior, uno a uno, con sus
propias pruebas.

## Trazabilidad
`CLAUDE_ORGANIZAR_SKILLS_BACKEND.md` §11; `.claude/rules/**`;
`docs/final-implementation-report.md`.

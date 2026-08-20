---
title: "Skills del proyecto"
tags:
  - skills
  - entorno-asistido
  - indice
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/skills/. Ejecute `yarn docs:vault` tras cambiarla. -->

# Skills del proyecto

Una skill es un procedimiento repetible escrito una sola vez: qué fuentes leer, en qué
fases avanzar, qué comandos están permitidos, qué evidencia hay que dejar y cuándo
detenerse. Su valor de negocio es que la revisión de un cambio no dependa de quién la haga;
su valor de sistema es que los gates y las invariantes que protegen la plataforma se
ejecuten siempre en el mismo orden y con la misma exigencia de prueba.

| Skill | Nombre de invocación | Cuándo usarla |
| --- | --- | --- |
| [Endurecimiento del backend](backend-hardening.md) | `backend-hardening` | Auditoría por fases del backend Atlas (inventario, correctitud, seguridad, integridad de datos, observabilidad, rendimiento, pruebas) para endurecerlo antes de producción, con evidencia real y sin cambios destructivos. Úsala para una revisión integral de una feature o del servicio. |
| [Verificación de producción](production-verification.md) | `production-verification` | Corre y evidencia todos los gates del backend Atlas (prisma validate, migrate, typecheck, build, test, e2e, smoke, OpenAPI) contra infraestructura real, y solo declara "listo" con salida real. Úsala antes de decir que un cambio funciona o antes de un release. |
| [Auditoría de seguridad](security-audit.md) | `security-audit` | Revisión de seguridad enfocada del backend Atlas — RBAC real en backend, RLS por tenant en tablas nuevas, aislamiento de ejecución de código importado, cadena de auditoría append-only, y ausencia de secretos. Úsala al añadir endpoints, tablas o ejecución de código, o antes de un release. |

!!! warning "Páginas generadas"
    La fuente canónica vive en `.claude/skills/<skill>/SKILL.md`. Estas páginas son su
    espejo: edite la skill en su origen y ejecute `yarn docs:vault`.

## Qué NO es una skill

Ninguna de estas skills concede permisos. Las prohibiciones de
[gobernanza](../design-rules/00-governance.md) siguen vigentes durante su ejecución:
nada de `git push`, `prisma migrate reset`, borrado de datos, acceso a producción ni uso
de secretos sin aprobación explícita. Una skill que exige evidencia tampoco la sustituye:
un `PASS` sin la salida real del gate no es un `PASS`.

El catálogo de skills provistas por el entorno —las que no viven en este repositorio y por
tanto no están versionadas con él— se explica en
[skills del entorno](entorno.md).

---
title: Skills del entorno
tags:
  - skills
  - entorno-asistido
---

# Skills del entorno

No todas las skills disponibles durante una sesión de trabajo pertenecen a este repositorio. La
distinción importa: solo lo versionado aquí es reproducible, revisable en un *pull request* y
exigible a quien contribuye.

| Origen | Dónde vive | ¿Versionado con el backend? | ¿Se puede exigir en revisión? |
| --- | --- | --- | --- |
| Skills del proyecto | `.claude/skills/` (espejo en [este índice](index.md)) | Sí | Sí |
| Skills de usuario | Configuración personal de la máquina | No | No |
| Skills de *plugin* / *marketplace* | Instaladas en el entorno, fuera del repositorio | No | No |

## Consecuencia práctica

Un procedimiento del que dependa la calidad de una entrega —los gates de verificación, la
revisión de invariantes de seguridad, la auditoría por fases— **debe vivir en
`.claude/skills/`**. Si depende de una skill del entorno, deja de estar garantizado en la
máquina de otra persona o en CI, y el resultado no es reproducible.

Las skills del entorno son, por tanto, comodidad: aceleran una tarea concreta pero no forman
parte del contrato de este backend. Ninguna afirmación de la documentación puede apoyarse en
que estén instaladas.

## Plugins evaluados

El análisis de idoneidad de *plugins* para este stack —qué aporta valor sobre NestJS, Prisma,
PostgreSQL, Redis, Jest y OpenAPI, y qué se descartó por no aplicar a un backend sin interfaz
web ni infraestructura como código— está registrado como evidencia fechada en
`docs/claude/plugin-selection-matrix.md`, junto con el inventario del entorno y el informe de
instalación en la misma carpeta.

Ese registro es deliberadamente una recomendación y no un estado: instalar un *plugin* que
requiera OAuth, una cuenta externa o privilegios elevados es un punto de parada que exige
aprobación humana explícita, según [gobernanza](../design-rules/00-governance.md).

## Límites que ninguna skill levanta

Sea del proyecto o del entorno, una skill no concede permisos. Siguen prohibidos sin
aprobación explícita: `git push`, `prisma migrate reset`, borrar datos, tocar producción,
iniciar OAuth y usar secretos. Y ningún procedimiento convierte una afirmación en evidencia:
un `PASS` sin la salida real del gate no es un `PASS`.

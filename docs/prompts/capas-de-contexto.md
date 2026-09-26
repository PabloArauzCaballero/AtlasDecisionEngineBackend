---
title: Capas de contexto
tags:
  - prompts
  - entorno-asistido
---

# Capas de contexto

Cada capa responde a una pregunta distinta y se carga en un momento distinto. Confundirlas es
lo que produce, por un lado, instrucciones que nadie lee porque están enterradas y, por otro,
contexto irrelevante que desplaza al que hacía falta.

## 1. `CLAUDE.md` — lo invariante

Vive en la raíz y entra en contexto en toda sesión. Contiene únicamente lo que aplica siempre y
no cabe deducir del código:

- El grafo de conocimiento `graphify-out/` y el orden de consulta (`graphify query` antes que
  búsquedas en crudo), incluida la obligación de `graphify update .` tras modificar código.
- Los contratos de variables: tipos canónicos, motor de restricciones autoritativo en el
  backend, variables intermedias y contrato de salida explícito. Ver
  [contratos de variables](../variable-contracts.md).
- Los campos calculados, las librerías y el QA Lab, con sus guardianes: catálogo cerrado de
  operaciones, límite de líneas ejecutables, preludios que solo se habilitan y nunca se
  aportan. Ver [campos calculados](../calculated-fields.md).

Lo que **no** va aquí: procedimientos largos, cualquier cosa aplicable a una sola carpeta, y
copias de documentos que ya existen en `docs/`.

## 2. `.claude/rules/` — lo condicional

Una regla por tema. Las que declaran `paths` en su encabezado solo se cargan al editar esas
rutas; las que no, aplican a todo el repositorio. El espejo legible está en
[reglas de diseño](../design-rules/index.md).

La consecuencia de diseño es concreta: la regla de [base de datos](../design-rules/80-database.md)
—convenciones del esquema, migraciones aditivas, RLS en el SQL, auditoría en la misma
transacción— no ocupa contexto mientras se edita un controlador, y es imposible de ignorar
cuando se toca `prisma/**`.

## 3. `.claude/skills/` — lo procedimental

Un procedimiento se carga solo cuando la tarea lo invoca por nombre. Cada uno declara sus
fuentes obligatorias, sus fases, los comandos permitidos y prohibidos, la evidencia requerida y
las condiciones para detenerse. Los tres del proyecto están en [skills](../skills/index.md):

| Skill | Se invoca cuando |
| --- | --- |
| `production-verification` | Antes de afirmar que algo funciona, y antes de un *merge* a `main`. |
| `security-audit` | Al añadir o modificar un endpoint, una tabla con ámbito de tenant, o cualquier ejecución de código. |
| `backend-hardening` | Revisión integral previa a producción. |

## 4. El prompt de la tarea — lo variable

Es la única capa que no está versionada. Un prompt útil en este repositorio nombra cuatro
cosas: **el objetivo**, **la evidencia que se espera**, **los límites** y **el alcance**. Las
plantillas están en el [catálogo de prompts operativos](catalogo.md).

## Orden de resolución ante un conflicto

Cuando dos capas parecen decir cosas distintas, no gana la más reciente ni la más específica al
prompt: gana la precedencia de [gobernanza](../design-rules/00-governance.md). Un requisito
aprobado vence a una regla; un contrato o una migración vigente vence al código; el código y sus
pruebas vencen a un supuesto. Y ante una contradicción crítica el trabajo se detiene y se
reporta, en vez de resolverse inventando el requisito que falta.

---
title: Límites e higiene
tags:
  - prompts
  - entorno-asistido
  - gobernanza
---

# Límites e higiene

## Acciones que exigen aprobación explícita

Ninguna instrucción de una sesión levanta estas prohibiciones, y pedirlas de forma indirecta
—"haz lo que haga falta para que pase"— tampoco. Vienen de
[gobernanza](../design-rules/00-governance.md):

| Acción | Por qué está bloqueada |
| --- | --- |
| `git push` | Publica trabajo no revisado en una rama compartida. |
| `git reset --hard` | Destruye trabajo local sin registro. |
| `prisma migrate reset` | Borra la base y su cadena de migraciones; Prisma lo bloquea para agentes. |
| Borrado de datos | Irreversible y, sobre la cadena de auditoría, ilegítimo por diseño. |
| Tocar producción | Fuera del alcance de cualquier tarea de desarrollo. |
| Iniciar OAuth o usar secretos | Requiere una persona presente y consciente del alcance. |

La cadena de auditoría merece mención aparte: `DecisionAuditEvent` es *append-only* y encadenada
por hash, y el rol de aplicación tiene `REVOKE UPDATE/DELETE`. Un cambio que "arregle" un
registro de auditoría no es un arreglo, es la pérdida de la garantía que justifica el sistema.
Ver [auditabilidad](../security/auditability.md).

## Evidencia: la regla que más se incumple

Una afirmación de que algo funciona vale exactamente lo que vale su salida. No se declara `PASS`
sin la salida real del gate que lo respalda, y un documento fechado no se reescribe después para
simular que siempre describió el estado actual.

Cuando falte infraestructura externa que no se pueda levantar de forma segura y aislada, el
comportamiento correcto no es omitir el gate ni aprobarlo por analogía: se implementa igualmente
lo que se pueda, se documenta **el dato exacto que falta** y se sigue con el resto. Ver
[pruebas](../design-rules/60-testing.md) y la skill
[verificación de producción](../skills/production-verification.md).

## Qué revisar en una respuesta antes de aceptarla

Estos son los fallos que este repositorio ha visto de verdad, no una lista genérica:

1. **Un `PASS` sin salida.** Pídala; si no existe, el gate no se corrió.
2. **Una dependencia nueva** que duplica algo del stack. `class-validator`, `zod`, NestJS,
   Prisma, `ioredis`, OpenTelemetry, `prom-client` y `pino` ya cubren validación, HTTP, ORM,
   caché, colas y observabilidad. Ver
   [selección de librerías](../design-rules/70-library-selection.md).
3. **Un `npm install`** en un repositorio de Yarn: resuelve un árbol distinto y crea un segundo
   lockfile.
4. **Una tabla nueva con ámbito de tenant sin política RLS en el SQL de la migración.** El
   esquema de Prisma no la aporta. Ver [aislamiento por tenant](../security/tenant-isolation.md).
5. **Una escritura de negocio cuya auditoría queda fuera de la transacción.** La acción y su
   evidencia deben ser atómicas.
6. **Un endpoint sin `@Roles(...)`**, o cuya autorización se argumenta desde el frontend.
7. **Documentación no actualizada**: toda feature o endpoint nuevo actualiza su documento de
   dominio y su anotación OpenAPI. Ver
   [documentación](../design-rules/90-documentation.md).
8. **Un requisito inventado** para rellenar un hueco del enunciado, en vez de detenerse y
   preguntar.

## Higiene de contexto

- Consultar el grafo de conocimiento antes que recorrer el árbol en crudo: devuelve un subgrafo
  acotado en lugar de volcados de archivos.
- Preferir el documento de dominio al código cuando la pregunta es "por qué"; preferir el código
  y sus pruebas cuando la pregunta es "qué hace hoy".
- No copiar documentos extensos dentro de `CLAUDE.md`: un procedimiento largo se convierte en
  skill y una restricción por ruta en regla.

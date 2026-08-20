---
title: Catálogo de prompts operativos
tags:
  - prompts
  - entorno-asistido
---

# Catálogo de prompts operativos

Plantillas para las tareas que se repiten en este backend. No son fórmulas mágicas: son la forma
corta de decir lo que de otro modo se olvida —el alcance, la evidencia y los límites— y de que
dos personas distintas obtengan un trabajo comparable.

Todas asumen las capas ya cargadas ([capas de contexto](capas-de-contexto.md)). No hay que
repetir en el prompt lo que ya dice una regla; sí hay que decir lo que la regla no puede saber:
qué se quiere y hasta dónde.

## Anatomía

Un prompt útil aquí nombra cuatro cosas:

| Elemento | Pregunta que responde | Ejemplo |
| --- | --- | --- |
| Objetivo | Qué debe existir al terminar | "un endpoint que liste versiones aprobadas por artefacto" |
| Evidencia | Cómo se demuestra | "e2e que cubra 200 y 403, con la salida del runner" |
| Límites | Qué no se toca | "sin migraciones destructivas, sin dependencias nuevas" |
| Alcance | Dónde vive el cambio | "`src/modules/artifacts/`, contrato OpenAPI y su documento de dominio" |

---

## Endpoint nuevo o modificado

```text
Añade el endpoint <método> <ruta> en el módulo <módulo>.

Objetivo: <qué devuelve o qué cambia, y para qué rol de negocio>.
Alcance: src/modules/<módulo>/, DTOs validados, anotación OpenAPI y el documento
  de dominio correspondiente en docs/.
Evidencia: unit del núcleo de lógica + e2e que ejercite el camino completo,
  incluyendo un 403 para un rol sin acceso. Pega la salida real del runner.
Límites: sin lógica de negocio en el controlador, sin devolver modelos Prisma
  crudos, sin dependencias nuevas. Declara @Roles(...) explícitamente.
Al terminar: resume qué quedó sin cubrir y por qué.
```

Complementa: [arquitectura backend](../design-rules/10-backend-architecture.md) ·
[convenciones de API](../api/conventions.md) · skill
[auditoría de seguridad](../skills/security-audit.md).

---

## Tabla o migración nueva

```text
Modela <entidad> y su migración.

Objetivo: <qué representa en el negocio y quién la escribe/lee>.
Alcance: prisma/schema.prisma + migración SQL + servicio que la usa.
Requisitos no negociables:
  - convenciones del esquema (BigInt @id, @map snake_case, @@map("decision_..."),
    Timestamptz(6), tenantId en modelos raíz con ámbito de tenant);
  - política RLS en el SQL de la migración, espejo del patrón existente;
  - migración aditiva; si no puede serlo, para y propón la estrategia
    expand-contract antes de escribir nada;
  - la escritura de negocio y su AuditService.append, en la misma transacción.
Evidencia: yarn prisma:validate y la migración aplicada sobre una base
  desechable, con la salida. Nunca prisma migrate reset.
```

Complementa: [base de datos](../design-rules/80-database.md) ·
[migraciones](../data/migrations.md) · [aislamiento por tenant](../security/tenant-isolation.md).

---

## Investigar un comportamiento

```text
Explica cómo <comportamiento> ocurre hoy, sin cambiar código.

Empieza por el grafo de conocimiento (graphify query / path / explain) y cita
archivo:línea para cada afirmación. Si la documentación y el código discrepan,
repórtalo en vez de elegir uno.
Entregable: la secuencia real de llamadas, los puntos donde el flujo puede
fallar cerrado, y qué prueba lo cubre (o la ausencia de prueba).
```

Complementa: [ciclo de vida de una petición](../architecture/request-lifecycle.md).

---

## Antes de declarar que algo funciona

```text
Aplica la skill production-verification sobre <cambio>.

Levanta infraestructura aislada y desechable con puertos y proyecto Docker
propios; no uses la base compartida. Corre la cadena completa de gates y
devuelve una tabla criterio → PASS/FAIL → evidencia con la salida literal.
Si un gate necesita algo que no puedes levantar de forma segura, documenta el
dato exacto que falta y sigue con el resto; no lo declares PASS.
```

Complementa: [verificación de producción](../skills/production-verification.md) ·
[ejecutar las pruebas](../getting-started/running-tests.md).

---

## Revisión de seguridad de un cambio

```text
Aplica la skill security-audit sobre <cambio>.

Para cada punto —RBAC en el guard, RLS de tablas con ámbito de tenant,
aislamiento de la ejecución de código importado, auditoría transaccional e
inmutable, ausencia de secretos, validación de entrada— devuelve el archivo:línea
que lo satisface o el e2e que lo demuestra. Sin hallazgos inventados y sin
declarar "seguro" lo que no verificaste.
Si encuentras un secreto versionado, detente y repórtalo; no lo "arregles"
exponiéndolo.
```

Complementa: [seguridad](../design-rules/30-security.md) ·
[modelo de amenazas](../security/threat-model.md).

---

## Documentar una feature ya implementada

```text
Actualiza la documentación de <feature>, ya implementada en <rutas>.

Alcance: el documento de dominio en docs/, la anotación OpenAPI del controller y
el índice de la carpeta afectada.
Requisitos: enlaza a los archivos y servicios reales; explica el porqué de las
restricciones, no reescribas lo que el código ya dice; no inventes garantías que
el código no ofrece.
Evidencia: yarn docs:validate con su salida.
```

Complementa: [documentación](../design-rules/90-documentation.md) ·
[política de documentación](../governance/documentation-policy.md).

---

## Antipatrones

| En vez de | Pida |
| --- | --- |
| "arregla los tests" | "diagnostica por qué falla `<test>` y corrige la causa; si el test estaba mal, explica por qué antes de tocarlo" |
| "haz que funcione" | el objetivo y la evidencia que lo demostraría |
| "optimiza esto" | la métrica que debe mejorar y su medición actual |
| "revisa todo el backend" | una fase concreta de [endurecimiento](../skills/backend-hardening.md) |
| "actualiza la librería X a la última" | la razón del cambio; un salto de versión mayor del núcleo exige aprobación explícita |

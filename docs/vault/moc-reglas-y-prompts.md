---
title: MOC — Reglas, prompts y skills
tags:
  - moc
  - reglas-de-diseno
  - prompts
  - skills
---

# Mapa de contenido — Reglas, prompts y skills

Cómo se decide aquí qué cambio es aceptable, y cómo se trabaja para producirlo. Es la parte de la
documentación que gobierna a la documentación y al código.

← [Inicio](inicio.md)

## 1. Reglas de diseño

Diez reglas fijan la forma de un cambio aceptable. Viven en `.claude/rules/` —donde la
herramienta de asistencia las carga por ruta de archivo— y se espejan en el portal para que sean
legibles y revisables por cualquiera.

| Regla | Qué protege |
| --- | --- |
| [Gobernanza](../design-rules/00-governance.md) | Precedencia, evidencia, prohibición de acciones destructivas. |
| [Arquitectura backend](../design-rules/10-backend-architecture.md) | Forma de los módulos NestJS y de los errores. |
| [Clean code](../design-rules/20-clean-code.md) | Cohesión, ausencia de duplicación semántica, nombres del dominio. |
| [Seguridad](../design-rules/30-security.md) | RBAC real, RLS por tenant, aislamiento de código, auditoría inmutable. |
| [Observabilidad](../design-rules/40-observability.md) | Logs estructurados, métricas nombradas, sin PII ni secretos. |
| [Rendimiento](../design-rules/50-performance.md) | Keyset, transacciones sin I/O, caché con tenant, cotas. |
| [Pruebas](../design-rules/60-testing.md) | Jest unit y e2e reales; sin `PASS` sin salida. |
| [Selección de librerías](../design-rules/70-library-selection.md) | Yarn, sin majors del núcleo, sin dependencias redundantes. |
| [Base de datos](../design-rules/80-database.md) | Convenciones del esquema, migraciones aditivas, RLS en el SQL. |
| [Documentación](../design-rules/90-documentation.md) | Doc de dominio y OpenAPI por cada endpoint. |

Índice completo: [reglas de diseño](../design-rules/index.md).

## 2. Prompts y contexto

- [Prompts y contexto](../prompts/index.md) — las tres capas versionadas más el prompt de la
  tarea, que no lo está.
- [Capas de contexto](../prompts/capas-de-contexto.md) — qué carga `CLAUDE.md`, qué cargan las
  reglas por ruta y qué cargan las skills bajo demanda.
- [Catálogo de prompts operativos](../prompts/catalogo.md) — plantillas para endpoint nuevo,
  migración, investigación, verificación, revisión de seguridad y documentación.
- [Límites e higiene](../prompts/limites.md) — qué exige aprobación explícita y qué revisar en
  una respuesta antes de aceptarla.

## 3. Skills

Procedimientos repetibles, cargados solo cuando la tarea los invoca:

| Skill | Cuándo | Entregable |
| --- | --- | --- |
| [Verificación de producción](../skills/production-verification.md) | Antes de afirmar que algo funciona o de un release. | Tabla criterio → PASS/FAIL → evidencia literal. |
| [Auditoría de seguridad](../skills/security-audit.md) | Endpoint, tabla con ámbito de tenant o ejecución de código. | Hallazgos con severidad, ubicación y recomendación. |
| [Endurecimiento del backend](../skills/backend-hardening.md) | Revisión integral previa a producción. | Reporte por fases, priorizado. |

Índice: [skills del proyecto](../skills/index.md). La diferencia entre lo versionado aquí y lo
que aporta el entorno de cada máquina: [skills del entorno](../skills/entorno.md).

## 4. Gobierno del proceso

| Nota | Qué fija |
| --- | --- |
| [Propiedad](../governance/ownership.md) | Quién responde por cada área. |
| [Proceso de revisión](../governance/review-process.md) | Qué se exige antes de aprobar. |
| [Gestión del cambio](../governance/change-management.md) | Cómo entra un cambio y cómo se revierte. |
| [Política de documentación](../governance/documentation-policy.md) | Qué se genera, qué se escribe y qué no se reescribe. |
| [Matriz de trazabilidad](../governance/traceability-matrix.md) | De requisito a evidencia. |

## 5. La regla que sostiene a las demás

Ninguna instrucción de una sesión levanta las prohibiciones de
[gobernanza](../design-rules/00-governance.md), y ninguna afirmación de que algo funciona vale
sin la salida real del gate que la respalda. Todo lo demás en esta bóveda —arquitectura,
seguridad, operación— asume que esas dos cosas se cumplen.

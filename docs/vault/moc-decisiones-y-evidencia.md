---
title: MOC — Decisiones y evidencia
tags:
  - moc
  - adr
  - evidencia
---

# Mapa de contenido — Decisiones y evidencia

Por qué el sistema es como es, y qué se comprobó y cuándo. Estas dos cosas envejecen de forma
distinta: una decisión sigue vigente hasta que otra la sustituye; una verificación describe una
fecha y nada más.

← [Inicio](inicio.md)

## 1. Decisiones de arquitectura (ADR)

| ADR | Decisión |
| --- | --- |
| [ADR-0011](../adr/ADR-0011-contract-extensions.md) | Extensiones del contrato de variables. |
| [ADR-0021](../adr/ADR-0021-worker-role-separation.md) | Separación de roles API / worker. |
| [ADR-0022](../adr/ADR-0022-openapi-source-of-truth.md) | OpenAPI como fuente de verdad. |
| [ADR-0023](../adr/ADR-0023-generated-documentation.md) | Documentación generada del código. |
| [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md) | Adopción de SLO, RTO y RPO. |
| [ADR-0025](../adr/ADR-0025-execution-archival-threshold.md) | Umbral de archivado de ejecuciones. |
| [ADR-0026](../adr/ADR-0026-additional-workers-integration.md) | Integración de workers adicionales. |

Índice y plantilla: [ADR](../adr/index.md). Para redactar uno nuevo:
[plantilla de ADR](plantillas/plantilla-adr.md).

## 2. Informes vigentes

- [Línea base](../reports/baseline.md) — punto de partida documental.
- [Análisis de brechas](../reports/documentation-gap-analysis.md) ·
  [métricas documentales](../reports/documentation-metrics.md)
- [Preparación para producción](../reports/production-readiness.md) ·
  [validación final](../reports/final-validation.md)
- [Plan de corrección 2026-07-31](../reports/correction-plan-2026-07-31.md)
- [Auditoría Graphify](../reports/graphify-audit.md)

## 3. Evidencia fechada

Estos documentos **no describen el estado actual**: describen lo que se comprobó un día
concreto. Su valor es exactamente ese, y por eso no se reescriben para simular que siempre
dijeron lo que hoy es cierto.

| Documento | Qué registra |
| --- | --- |
| [Auditoría de endurecimiento 2026-07-30](../audit-2026-07-30-hardening.md) | Las siete fases con hallazgos y correcciones reproducidas. |
| [Verificación 2026-07-30](../verification-2026-07-30.md) · [2026-07-28](../verification-2026-07-28.md) · [2026-07-24](../verification-2026-07-24.md) | Corridas de gates con su salida. |
| [Auditoría de extensión de contratos](../contract-extension-audit-2026-07-30.md) | Revisión del contrato de variables. |
| [Informe de pruebas](../testing-report.md) | Salida de las rebanadas 2–5. |
| [Informe final de implementación](../final-implementation-report.md) | Alcance e integración originales. |
| [Auditoría de seguridad inicial](../SECURITY_AUDIT.md) | Hallazgos y correcciones de la primera revisión. |

Al leer cualquiera de ellos: contrástelo con los gates vigentes antes de asumir que sigue siendo
cierto. Formato para producir uno nuevo:
[plantilla de informe de verificación](plantillas/plantilla-verificacion.md).

## 4. Trabajo en curso y pendientes

- [Progreso](../progress/README.md) ·
  [workers adicionales 2026-08-04](../progress/workers-adicionales-2026-08-04.md)
- [Pendientes de la ampliación de contratos](../PENDIENTES-ampliacion-contratos.md)
- [Matriz de implementación](../IMPLEMENTATION_MATRIX.md) — objetivos de diseño frente a
  evidencia real, incluidas las brechas.
- [Análisis de integración de workers adicionales](../workers/additional-workers-integration-analysis.md)

## 5. Configuración del entorno asistido

Cómo se configuró la asistencia de desarrollo —inventario del entorno, auditoría de la
configuración, selección de plugins, trazabilidad de reglas y skills— está en `docs/claude/`.
Es gobernanza de herramientas, no arquitectura del runtime, y también es evidencia fechada.

La documentación viva de esa misma materia —qué reglas rigen hoy, qué prompts se usan, qué
skills existen— está en [reglas, prompts y skills](moc-reglas-y-prompts.md).

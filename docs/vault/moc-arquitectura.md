---
title: MOC — Arquitectura
tags:
  - moc
  - arquitectura
---

# Mapa de contenido — Arquitectura

Cómo está construido el servicio: sus límites, el recorrido de una petición, el trabajo que
ocurre fuera de ella y las integraciones que asume.

← [Inicio](inicio.md)

## 1. Vista general

| Nota | Nivel |
| --- | --- |
| [Panorama](../architecture/overview.md) | Punto de entrada. |
| [Contexto del sistema](../architecture/system-context.md) | Qué hay alrededor: portal, canales de originación, proveedor de identidad, colector OTLP. |
| [Contenedores](../architecture/containers.md) | API, worker, sidecar de scripts, PostgreSQL, Redis. |
| [Componentes](../architecture/components.md) | Dentro de cada contenedor. |
| [Dependencias entre módulos](../architecture/module-dependencies.md) | El grafo real, sin ciclos. |
| [Mapa de integraciones](../architecture/integration-map.md) | Qué se consume del exterior y bajo qué contrato. |

Diagramas: [componentes control plane / data plane](../plantuml/09_componentes_control_plane_data_plane.puml)
· [contexto e integraciones](../plantuml/11_contexto_sistema_e_integraciones.puml)
· [paquetes y límites modulares](../plantuml/22_paquetes_backend_y_limites_modulares.puml)
· [despliegue e infraestructura segura](../plantuml/10_despliegue_infraestructura_segura.puml).

## 2. El camino de una decisión

- [Ciclo de vida de una petición](../architecture/request-lifecycle.md) — de la cabecera de
  idempotencia a la evidencia persistida.
- [Runtime](../modules/runtime.md) — el motor de ejecución.
- [Idempotencia](../api/idempotency.md) — por qué reintentar no duplica una decisión.
- [Ejecución en vivo](../live-execution.md) — SSE para observar una simulación sin crear
  evidencia productiva falsa; prohibida en producción por diseño.
- [Trazabilidad](../modules/traceability.md) · [consulta de auditoría](../modules/audit-query.md).

Diagramas: [actividad de ciclo de vida end-to-end](../plantuml/04_actividad_ciclo_vida_end_to_end.puml)
· [secuencia de ejecución en línea y explicación](../plantuml/07_secuencia_ejecucion_online_y_explicacion.puml)
· [estados de versión de artefacto](../plantuml/05_estados_version_artefacto.puml).

## 3. Gobierno del artefacto

El diseño no se despliega: se compila a un artefacto inmutable, se aprueba con segregación de
funciones y se despliega por ambiente.

- [Flujos críticos](../business/critical-workflows.md) ·
  [gobierno](../modules/governance.md) · [despliegues](../modules/deployments.md)
- [Revisión manual](../modules/manual-review.md) — cuando la decisión vuelve a una persona.
- Diagramas: [aprobación, despliegue y rollback](../plantuml/08_secuencia_aprobacion_despliegue_rollback.puml)
  · [gobierno con swimlanes](../plantuml/14_gobierno_aprobacion_con_swimlanes.puml).

## 4. Fuera de la petición

| Nota | Qué resuelve |
| --- | --- |
| [Procesamiento en segundo plano](../architecture/background-processing.md) | Qué no puede vivir dentro de la petición. |
| [Orquestación de trabajos de fondo](../worker-orchestration.md) | Orquestador central, despertar por `LISTEN`/`NOTIFY`, reparto API/WORKER. |
| [Arquitectura dirigida por eventos](../event-driven-architecture.md) | Outbox, entrega *at-least-once*, idempotencia, dead-letter. |
| [Relay de outbox](../modules/outbox-relay.md) · [notificaciones](../modules/notifications.md) | Los consumidores concretos. |
| [Workers adicionales](../workers/additional-workers-architecture.md) | Análisis semántico y extractos bancarios. |
| [ADR-0021](../adr/ADR-0021-worker-role-separation.md) · [ADR-0026](../adr/ADR-0026-additional-workers-integration.md) | Por qué se separaron los roles y cómo se absorbieron. |

Contrato de eventos: [panorama](../events/overview.md) ·
[catálogo](../events/event-catalog.md) ·
[semántica de entrega](../events/delivery-semantics.md) ·
[reintentos y cola muerta](../events/retries-and-dlq.md) ·
[guía para consumidores](../events/consumer-guidelines.md).

## 5. Superficie HTTP

[Convenciones](../api/conventions.md) · [autenticación](../api/authentication.md) ·
[autorización](../api/authorization.md) · [versionado](../api/versioning.md) ·
[paginación](../api/pagination.md) · [modelo de error](../api/error-model.md) ·
[catálogo de endpoints](../api/endpoint-catalog.md).

El contrato OpenAPI se genera de los controladores reales y es la fuente de verdad:
[ADR-0022](../adr/ADR-0022-openapi-source-of-truth.md).

## 6. Qué exige un cambio arquitectónico

[Arquitectura backend](../design-rules/10-backend-architecture.md) —controladores finos, DTOs
validados, sin modelos Prisma crudos hacia afuera, sin ciclos entre módulos, errores
centralizados en `DomainException`— y [rendimiento](../design-rules/50-performance.md) —keyset
para feeds sin cota, nada de I/O de red dentro de una transacción, cotas de ejecución.

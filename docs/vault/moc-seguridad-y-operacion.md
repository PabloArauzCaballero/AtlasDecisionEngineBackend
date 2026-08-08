---
title: MOC — Seguridad y operación
tags:
  - moc
  - seguridad
  - operacion
---

# Mapa de contenido — Seguridad y operación

Las garantías que la plataforma promete a Riesgo, Fraude y Compliance, y los procedimientos que
las sostienen en marcha.

← [Inicio](inicio.md)

## 1. Seguridad

| Nota | Garantía |
| --- | --- |
| [Arquitectura de seguridad](../security/security-architecture.md) | Vista completa de los controles. |
| [Modelo de amenazas](../security/threat-model.md) | Contra qué se defiende y qué queda fuera de alcance. |
| [Control de acceso](../security/access-control.md) | RBAC decidido en el servidor, nunca en el frontend. |
| [Aislamiento por tenant](../security/tenant-isolation.md) | RLS en PostgreSQL con rol de aplicación no superusuario. |
| [Auditabilidad](../security/auditability.md) | Cadena *append-only* encadenada por hash. |
| [Gestión de secretos](../security/secrets-management.md) | Sin secretos versionados; el esquema de entorno rechaza ejemplos en producción. |
| [Seguridad de dependencias](../security/dependency-security.md) | Superficie de terceros. |
| [Respuesta a incidentes](../security/incident-response.md) | Qué hacer cuando algo ocurre. |

Complementos: [revisión de seguridad](../security-review.md) (agregación y exportación de
evidencia) · [módulo](../modules/security-review.md) ·
[importación de código](../modules/code-import.md) (análisis estático como defensa en
profundidad, nunca en sustitución del sandbox).

Diagramas: [RBAC y multitenencia](../plantuml/18_seguridad_rbac_multitenancy.puml) ·
[auditoría, explicabilidad y observabilidad](../plantuml/17_auditoria_explicabilidad_observabilidad.puml).

Regla aplicable: [seguridad](../design-rules/30-security.md). Procedimiento:
[auditoría de seguridad](../skills/security-audit.md).

## 2. Observabilidad

[Registros](../observability/logging.md) · [métricas](../observability/metrics.md) ·
[trazas](../observability/tracing.md) · [tableros](../observability/dashboards.md) ·
[alertas](../observability/alerts.md) ·
[objetivos de nivel de servicio](../observability/service-level-objectives.md).

Los SLO y sus RTO/RPO asociados se adoptaron en
[ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md). Regla aplicable:
[observabilidad](../design-rules/40-observability.md).

## 3. Operación

| Nota | Momento |
| --- | --- |
| [Ambientes](../operations/environments.md) | Qué existe y en qué se diferencian. |
| [Despliegue](../operations/deployment.md) · [configuración](../operations/configuration.md) | Poner una versión en marcha. |
| [Sondas de salud](../operations/health-checks.md) · [escalado](../operations/scaling.md) | Mantenerla en marcha. |
| [Reversión](../operations/rollback.md) · [recuperación ante desastres](../operations/disaster-recovery.md) | Cuando algo sale mal. |
| [Mantenimiento](../operations/maintenance.md) | Tareas periódicas. |

Runbooks ejecutables: [índice](../runbooks/README.md) ·
[operación general](../runbooks/OPERATIONS.md) ·
[contratos de variables](../runbooks/CONTRATOS_DE_VARIABLES.md) ·
[campos calculados](../runbooks/CAMPOS_CALCULADOS.md) · [QA Lab](../runbooks/QA_LAB.md).

Documentos originales, conservados: [despliegue](../DEPLOYMENT.md) ·
[preparación productiva](../PRODUCTION_READINESS.md) · [comandos](../COMANDOS.md).

## 4. Pruebas

[Estrategia](../testing/strategy.md) · [unitarias](../testing/unit-tests.md) ·
[integración](../testing/integration-tests.md) · [extremo a extremo](../testing/e2e-tests.md) ·
[contrato](../testing/contract-tests.md) · [rendimiento](../testing/performance-tests.md) ·
[datos de prueba](../testing/test-data.md).

Cómo correrlas: [ejecutar las pruebas](../getting-started/running-tests.md). Regla aplicable:
[pruebas](../design-rules/60-testing.md). Procedimiento antes de declarar algo listo:
[verificación de producción](../skills/production-verification.md).

## 5. El límite que no se cruza

La ejecución de código importado —nodos de script, Código→Flow— está siempre aislada, y en
producción exige el sidecar con gVisor y sin red. La cadena de auditoría no se modifica ni se
borra: el rol de aplicación tiene revocados `UPDATE` y `DELETE`. Ambas cosas son la razón por la
que una decisión de hace meses todavía se puede defender ante un tercero.

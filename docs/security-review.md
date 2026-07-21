# Vista de equipo de seguridad (Fase 10)

Panel agregado de revisión de seguridad para una versión de artefacto —
`GET /v1/security-review/versions/{versionId}` — construido enteramente sobre
datos que **ya existen** en otros módulos (autoría, variables, referencias
anidadas, importación de código, gobernanza, auditoría, ejecución). No se crea
ninguna tabla nueva; `SecurityReviewService` es un servicio de agregación puro.

## Qué agrega

- **Autor y metadatos**: artefacto, versión, `createdBy`, checksum canónico.
- **Código**: cada `DecisionNodeScript` (nodo RESULT en modo SCRIPT) con
  lenguaje, checksum y un extracto de la fuente.
- **Dependencias/variables**: cada variable usada por la versión, con su
  clasificación de datos y si está marcada `isSensitive`.
- **Subárboles**: referencias anidadas salientes (`dependsOn`, Fase 7) y
  entrantes (`dependedOnBy`) — ver `docs/nested-decision-trees.md`.
- **Análisis estático**: cualquier `DecisionCodeImport` asociado a esta versión,
  con sus `issuesJson` (sintaxis/seguridad/contrato, Fase 5).
- **Gobernanza**: historial completo de `DecisionApprovalRequest` → pasos →
  decisiones.
- **Incidentes**: eventos de `DecisionAuditEvent` para esta versión — cada uno
  lleva `artifactId`/`versionId` para **navegación directa incidente → versión
  exacta** (sin pasar por un feed genérico de auditoría).
- **Ejecuciones**: conteo total, conteo con errores, y las 20 más recientes.

## Clasificación de severidad

`SecurityReviewService.computeFindings` produce una lista de hallazgos
(`{ severity, code, message }`) y la severidad global es el máximo:

| Hallazgo | Severidad | Condición |
|---|---|---|
| `CONTAINS_SCRIPT_NODES` | HIGH | La versión ejecuta al menos un nodo de script |
| `SENSITIVE_VARIABLES` | HIGH | Al menos una dependencia de variable está marcada `isSensitive` |
| `RESTRICTED_CLASSIFICATION_VARIABLES` | MEDIUM | Al menos una dependencia usa una clasificación de datos distinta de INTERNAL/PUBLIC |
| `NESTED_REFERENCES` | MEDIUM | La versión invoca al menos un árbol de decisión anidado |
| `RECENT_EXECUTION_ERRORS` | MEDIUM | Al menos una de las ejecuciones recientes registró un error |

## Aprobar / rechazar / solicitar cambios (RBAC real)

Deliberadamente **no se reimplementa** aquí: el frontend llama al endpoint de
gobernanza ya existente y con RBAC real —
`POST /v1/approval-steps/{stepId}/decisions` (roles `requiredRole` del paso +
separación de funciones, ver `governance.service.ts`) — usando el paso
pendiente que esta misma agregación expone en `governance[].steps`. La
autorización de una aprobación de seguridad nunca depende de qué botón se
oculte en el frontend: el backend valida rol y separación de funciones
independientemente de la UI.

## Exportar reporte

`GET /v1/security-review/versions/{versionId}/export` devuelve exactamente los
mismos datos con `Content-Disposition: attachment` para descarga directa.

## Endpoints y roles

| Método | Ruta | Roles |
|---|---|---|
| GET | `/v1/security-review/versions/{versionId}` | COMPLIANCE, FRAUD_ANALYST, RISK_APPROVER, AUDITOR |
| GET | `/v1/security-review/versions/{versionId}/export` | COMPLIANCE, FRAUD_ANALYST, RISK_APPROVER, AUDITOR |

## Pruebas

`test/e2e/security-review.e2e-spec.ts` — contra Postgres real: crea un
artefacto con un nodo de script y una variable sensible/restringida, confirma
que un rol sin acceso recibe 403, que la agregación clasifica la severidad
como HIGH con los hallazgos correctos, que el export descarga el mismo reporte,
y que una versión inexistente/de otro tenant devuelve 404.

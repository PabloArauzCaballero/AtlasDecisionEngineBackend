# Restricciones e índices

Las restricciones e índices exactos de cada tabla se listan en el
[catálogo de entidades](entity-catalog.md), generado del esquema. Esta página explica **por
qué** existen los que no son evidentes.

## Restricciones únicas que protegen una invariante

| Restricción | Impide |
| --- | --- |
| `decision_execution (tenant_id, request_id)` | Que la misma solicitud produzca dos ejecuciones en un tenant |
| `decision_execution_variable (execution_id, variable_version_id)` | Dos snapshots de la misma variable en una ejecución |
| `integration_client (client_key)` | Dos clientes con la misma clave lógica |
| `integration_scope (client_id, scope)` | Conceder dos veces el mismo permiso |
| `integration_tenant_access (client_id, tenant_id)` | Duplicar el acceso a un tenant |
| `decision_processed_event` | Que un consumidor procese dos veces el mismo evento — es la base de la deduplicación |

## Índices y la consulta que los motiva

| Índice | Consulta que sirve |
| --- | --- |
| `decision_execution (tenant_id, executed_at)` | Buscador de ejecuciones por rango temporal |
| `decision_execution (artifact_version_id, executed_at)` | «Qué ha decidido esta versión» |
| `decision_audit_event (tenant_id, occurred_at)` | Auditoría por rango |
| `decision_audit_event (tenant_id, id)` | **Paginación por cursor** de la auditoría |

!!! example "Evidencia de por qué existe `(tenant_id, id)`"
    Antes de crearlo, `EXPLAIN` sobre la consulta por cursor mostraba un recorrido inverso de la
    clave primaria con `Filter: (tenant_id = 1)` descartando 42 filas para devolver 26. Tras
    crearlo, un tenant disperso usa el índice **sin descartar ninguna fila**. Un tenant que posee
    casi toda la tabla sigue usando la clave primaria, que para él es lo correcto.

## Restricciones que no son de base de datos

Hay invariantes que ninguna restricción SQL expresa y viven en el servicio, con pruebas:

| Invariante | Dónde |
| --- | --- |
| Solo el nodo productor escribe una intermedia | `intermediate-scope.ts` |
| Sin ciclos entre artefactos referenciados | `cycle-detector.ts` |
| El autor no aprueba su propia versión | `governance.service.ts` |
| El contrato de una variable no se puede estrechar sin comprobación | `variable.service.ts` |

## Append-only, aplicado en el motor

`decision_audit_event` no depende de que el código «no borre»:

- Disparadores que rechazan `UPDATE` y `DELETE`.
- `REVOKE UPDATE, DELETE` sobre el rol de aplicación.
- RLS por tenant.

Consecuencia operativa: **la limpieza de una prueba no puede purgar filas de auditoría**, y la
retención de auditoría no puede significar borrado.

## Al añadir una tabla nueva

1. ¿Tiene `tenant_id`? Entonces necesita su política RLS espejo, con el mismo GUC.
2. ¿Qué consulta la va a leer? Ese es el índice, no uno «por si acaso».
3. ¿Qué invariante protege una restricción única? Si no protege ninguna, sobra.
4. La migración se escribe a mano y se aplica con `migrate deploy`.

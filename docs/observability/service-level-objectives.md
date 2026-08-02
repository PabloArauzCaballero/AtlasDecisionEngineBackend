# Objetivos de nivel de servicio

!!! info "Adoptados por ADR-0024, sujeto a revisión trimestral"
    Los valores de esta página fueron adoptados formalmente en
    [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md) a falta de un responsable de producto
    dentro del alcance operativo del proyecto. Son coherentes con la configuración real del
    sistema, no una cifra arbitraria — y quedan sujetos a revisión trimestral contra tráfico de
    producción real. Ver el ADR para el razonamiento completo.

## Indicadores

| Indicador | Definición | Medida |
| --- | --- | --- |
| Disponibilidad de decisión | Proporción de peticiones a `/v1/decisions/*` que no responden `5xx` | `atlas_http_requests_total` |
| Latencia de decisión | p95 y p99 de `/v1/decisions/*` | `atlas_http_request_duration_ms` |
| Tasa de sin-decisión | Proporción de ejecuciones `NO_DECISION` | `atlas_decisions_total` |
| Frescura del outbox | Antigüedad del evento pendiente más viejo | `atlas_outbox_pending` |
| Integridad de la auditoría | Verificación de la cadena satisfactoria | `/v1/audit/chain/verify` |

## Objetivos adoptados

| Indicador | Objetivo | Ventana | Por qué ese valor |
| --- | --- | --- | --- |
| Disponibilidad de decisión | 99,9 % | 30 días | ≈ 43 min/mes; el canal reintenta con idempotencia |
| Latencia p95 | < 250 ms | 30 días | Coincide con la zona densa de buckets del histograma |
| Latencia p99 | < 1000 ms | 30 días | Deja margen a proveedores externos y nodos de script |
| Tasa de sin-decisión | < 1 % | 7 días | Por encima suele indicar un proveedor caído, no política |
| Eventos muertos | 0 | continua | Cualquier evento en cola muerta requiere una persona |
| Integridad de la auditoría | 100 % | continua | No admite degradación |

## Presupuesto de error

Con 99,9 % en 30 días el presupuesto es ~43 minutos. Consumirlo por encima del 50 % a mitad de
ventana debería congelar los cambios no urgentes hasta recuperarlo.

## Lo que estos objetivos NO cubren

- **Corridas de QA y suites de prueba**: son trabajo por lotes; su latencia no es un objetivo de servicio. Por eso corren en el proceso `WORKER`, separadas del camino de decisión.
- **El portal**: su latencia depende del frontend y del proveedor de identidad.
- **La integridad de la auditoría no es un porcentaje.** Es binaria: o la cadena verifica, o hay un incidente.

## Dependencia de terceros

La latencia de decisión incluye la resolución de variables externas
(`VARIABLE_BACKEND_TIMEOUT_MS`, 1,5 s por defecto). Un proveedor lento consume el presupuesto
sin que la plataforma tenga ningún defecto: al acordar el objetivo hay que decidir si el
proveedor entra o se excluye explícitamente.

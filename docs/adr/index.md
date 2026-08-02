# Decisiones de arquitectura (ADR)

Un ADR conserva **el razonamiento**, no solo el resultado. Sirve para que dentro de dos años
alguien entienda por qué algo es como es antes de «simplificarlo».

## Registro

| ADR | Título | Estado |
| --- | --- | --- |
| [ADR-0011](ADR-0011-contract-extensions.md) | Extensiones del contrato de variables | Aceptado |
| [ADR-0021](ADR-0021-worker-role-separation.md) | Separación de procesos por `WORKER_ROLE` | Aceptado |
| [ADR-0022](ADR-0022-openapi-source-of-truth.md) | OpenAPI generado como fuente de verdad | Aceptado |
| [ADR-0023](ADR-0023-generated-documentation.md) | Documentación generada del código | Aceptado |
| [ADR-0024](ADR-0024-slo-rto-rpo-adoption.md) | Adopción de SLO, RTO y RPO | Aceptado |
| [ADR-0025](ADR-0025-execution-archival-threshold.md) | Umbral de archivado de `decision_execution` | Aceptado |

## Decisiones estructurales documentadas fuera de un ADR

Están registradas con su razonamiento en las páginas correspondientes:

| Decisión | Dónde |
| --- | --- |
| Editor como fuente de diseño; runtime sobre artefacto compilado | [Panorama](../architecture/overview.md) |
| Outbox transaccional y bus en proceso, sin broker | [Eventos](../events/overview.md) |
| RLS con rol no superusuario | [Aislamiento por tenant](../security/tenant-isolation.md) |
| Sidecar aislado para código importado | [Arquitectura de seguridad](../security/security-architecture.md) |
| HMAC en valores sensibles | [Clasificación](../data/classification.md) |
| **No** particionar por tiempo las tablas de alto volumen | [Arquitectura de datos](../data/data-architecture.md) |
| Lease corto además del TTL de idempotencia | [Idempotencia](../api/idempotency.md) |
| Paginación por cursor como endpoint aditivo | [Paginación](../api/pagination.md) |

## Cuándo escribir uno

- Elegir entre alternativas con consecuencias duraderas.
- Aceptar un riesgo o una limitación de forma consciente.
- **Decidir no hacer algo** que a primera vista parece obvio.

Ese último caso es el más valioso: sin registro, la decisión se revisita cada seis meses.

## Plantilla

```markdown
# ADR-XXXX: Título

## Estado
Propuesto | Aceptado | Reemplazado por ADR-YYYY | Rechazado | Obsoleto

## Contexto
## Fuerzas y restricciones
## Opciones consideradas
## Decisión
## Consecuencias positivas
## Consecuencias negativas
## Riesgos
## Evidencia
## Plan de revisión
```

# Observabilidad

Esta carpeta convierte tráfico y procesos en evidencia operativa. A nivel de negocio soporta SLO,
investigaciones e incidentes; a nivel de sistema ofrece logs Pino redactados, métricas Prometheus,
trazas OpenTelemetry, correlación, timeout y access logs.

Nunca registre secretos ni variables de decisión crudas. Las métricas usan etiquetas de
cardinalidad acotada y los fallos del sink de archivo degradan a stdout.

## Trazado distribuido

| Fichero | Responsabilidad |
| --- | --- |
| `tracing.ts` | Arranque y cierre del `NodeSDK`. Se importa **el primero** en `main.ts`/`worker.ts` |
| `telemetry.config.ts` | Lectura y acotado de la configuración `OTEL_*` desde `process.env` |
| `telemetry.instrumentations.ts` | Las cinco instrumentaciones automáticas, elegidas una a una |
| `telemetry.constants.ts` | Nombres de span, atributos `app.*` y exclusiones — definición única |
| `tracing.service.ts` | **Fachada para el dominio.** Es lo único que un servicio de negocio inyecta |
| `trace-context.service.ts` | Lectura de `trace_id`/`span_id` del contexto activo |
| `messaging-trace.service.ts` | Propagación W3C entre procesos a través de la base de datos |
| `trace-error.ts` | Marcado de errores con código estable, sin filtrar mensajes |
| `trace-response.interceptor.ts` | Cabecera `x-trace-id` en la respuesta |

Los tres servicios se registran en `ObservabilityModule`, que es `@Global`: un módulo de dominio
los inyecta sin importar nada.

Reglas al instrumentar:

- El dominio depende de `TracingService`, **nunca** de `@opentelemetry/*` ni de Jaeger.
- Nombres `<dominio>.<acción>` estables y **sin identificadores**.
- Atributos de baja cardinalidad y sin datos personales.

Guía completa: [docs/observability/README.md](../../../docs/observability/README.md).
Catálogo de spans: [docs/observability/02-business-spans-catalog.md](../../../docs/observability/02-business-spans-catalog.md).

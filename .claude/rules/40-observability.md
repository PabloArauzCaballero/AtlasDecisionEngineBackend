---
paths:
  - "src/**/*.ts"
---

# Observabilidad

- Logs estructurados vía el logger de `src/common/observability/`
  (`structured-logger.service.ts`), nunca `console.log`. Incluye `requestId`/
  correlación cuando esté disponible.
- Métricas Prometheus con `prom-client` a través de `MetricsService`; nombra las
  métricas nuevas de forma consistente (`<dominio>_<evento>_total`, gauges para
  estado).
- Trazas OpenTelemetry ya instrumentadas (http/express/pg/ioredis); no reinventes
  el bootstrap de OTel.
- No registres secretos, PII sin hashear ni el stderr crudo de subprocesos
  (puede contener fuente o valores sensibles).

---
title: "Observabilidad"
tags:
  - reglas-de-diseno
  - observabilidad
---
<!-- GENERADO POR scripts/docs/generate-vault.mjs — NO EDITAR A MANO.
     Fuente: .claude/rules/40-observability.md. Ejecute `yarn docs:vault` tras cambiarla. -->

# Observabilidad

!!! abstract "Ficha de la regla"
    **Fuente canónica:** `.claude/rules/40-observability.md` — esta página es su espejo generado.

    **Alcance:** Se aplica al editar `src/**/*.ts`.

    **Cómo se aplica:** la herramienta de asistencia carga la regla automáticamente al tocar esas rutas; una persona la aplica en revisión de código. La regla
    no sustituye a las pruebas ni a los controles de CI.

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

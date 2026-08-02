# Observabilidad

Esta carpeta convierte tráfico y procesos en evidencia operativa. A nivel de negocio soporta SLO,
investigaciones e incidentes; a nivel de sistema ofrece logs Pino redactados, métricas Prometheus,
trazas OpenTelemetry, correlación, timeout y access logs.

Nunca registre secretos ni variables de decisión crudas. Las métricas usan etiquetas de
cardinalidad acotada y los fallos del sink de archivo degradan a stdout.

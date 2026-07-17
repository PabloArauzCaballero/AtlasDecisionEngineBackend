# Runbook operativo

## Despliegue seguro

1. Construir una imagen inmutable etiquetada con versión y commit.
2. Ejecutar `prisma migrate deploy` como Job separado.
3. Verificar `/health/live` y `/health/ready`.
4. Ejecutar smoke tests con credenciales técnicas de alcance mínimo.
5. Habilitar tráfico gradualmente y observar error rate, p95/p99 y `NO_DECISION`.
6. Registrar evidencia de despliegue, checksum y aprobaciones.

## Incidente: readiness falla

- Consultar logs por `requestId`, métricas de DB/Redis y pool.
- No reiniciar repetidamente sin identificar la dependencia fallida.
- Si una migración falló, bloquear la API y aplicar el runbook de base de datos.
- Si Redis falla en producción, el servicio debe permanecer no listo para evitar idempotencia/rate-limit inconsistentes.

## Incidente: aumento de 401, 403 o 429

- Consultar `decision_access_audit` por status, recurso, IP y ventana temporal.
- Correlacionar por `requestId` con logs estructurados.
- Verificar revocaciones, expiraciones, audience y tenants autorizados del cliente.
- No habilitar `x-roles` ni `x-principal-id` como mitigación: esos headers no son una fuente de identidad.
- Rotar o suspender la credencial afectada si hay indicios de abuso.

Si PostgreSQL no está disponible, la respuesta de seguridad continúa y la falla de persistencia queda en stdout; recuperar el evento requiere la plataforma externa de logs.

## Incidente: incremento de NO_DECISION

- Segmentar por artefacto, versión, ambiente y reason/error code.
- Revisar disponibilidad de variables externas y cambios recientes.
- Suspender o revertir el deployment si el umbral acordado se supera.
- Preservar trazas y no modificar eventos históricos.

## Incidente: ruptura de cadena de auditoría

- Declarar incidente de integridad.
- Congelar rotaciones o limpiezas que afecten evidencia.
- Exportar snapshot de solo lectura y hashes.
- Investigar escrituras directas, restauraciones o manipulación de datos.
- No “reparar” hashes sin proceso formal y evidencia del incidente.

## Rollback de aplicación

El rollback de imagen no revierte automáticamente el schema. Las migraciones deben ser backward-compatible. Para cambios destructivos usar patrón expand/contract y una ventana posterior de limpieza.

## Falla del sink de archivo

La aplicación siempre escribe a stdout. Si `LOG_OUTPUT=stdout_and_file` no puede abrir `LOG_FILE_PATH`, emite el error por stderr y continúa. Corrija permisos o el volumen; no reinicie repetidamente el proceso.

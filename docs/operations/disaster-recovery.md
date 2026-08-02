# Recuperación ante desastres

## Objetivos

!!! info "Adoptados por ADR-0024, sujeto a revisión trimestral"
    RTO y RPO fueron adoptados formalmente en
    [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md), coherentes con el diseño actual de
    recuperación. Revisar cuando cambie la topología descrita abajo o cuando se incorpore un
    responsable de negocio que deba ratificarlos.

| Objetivo | Valor adoptado | Justificación |
| --- | --- | --- |
| RTO (tiempo de recuperación) | 4 h | Restaurar PostgreSQL, reponer secretos y verificar la cadena |
| RPO (pérdida admisible) | 15 min | Con WAL continuo; sin él, la cadencia del respaldo completo |

## Escenarios

### Pérdida total de la base de datos

1. Restaurar al punto elegido.
2. Reponer `AUDIT_HASH_SECRET` **y** los secretos retirados.
3. `yarn prisma:migrate` si el código es más nuevo que el respaldo.
4. Verificar `/health/ready`.
5. **Verificar la cadena de auditoría por tenant.**
6. Reanudar el tráfico.

El paso 5 distingue una restauración correcta de una que dejó la evidencia rota.

### Pérdida de Redis

Menos grave, pero **no** inocua: se pierden las reservas de idempotencia en vuelo. Un canal que
reintente durante esa ventana puede producir una **segunda decisión** para la misma solicitud.

Recomendación: congelar el tráfico de decisión hasta restablecerlo. En producción el servicio
además no estará listo, porque Redis es obligatorio.

### Pérdida del secreto de auditoría

Si se pierde el secreto pero la base está intacta, los datos siguen ahí pero **la cadena no se
puede verificar**. No hay recuperación técnica: es un incidente de cumplimiento que hay que
declarar. Por eso los secretos forman parte del respaldo, no solo los datos.

### Pérdida del clúster

La aplicación no tiene estado propio: redesplegar la imagen etiquetada y apuntar a la base
restaurada. El worker y la API son la misma imagen con distinto arranque.

## Recuperación a un punto en el tiempo

!!! danger "Descarta decisiones ya comunicadas"
    Restaurar a un punto anterior elimina ejecuciones que el canal de originación **ya recibió**.
    Antes de hacerlo hay que decidir qué se hace con ellas: es una decisión de negocio, no de
    operación.

## Prueba periódica

Un respaldo no probado no es un respaldo. Cadencia mínima mensual, en un ambiente aislado:

1. Restaurar el último respaldo.
2. Reponer secretos de prueba.
3. Arrancar la aplicación contra esa copia.
4. Verificar readiness, la cadena de auditoría y una decisión de humo.
5. Registrar el tiempo real: es su RTO medido, no el estimado.

## Dependencias externas

Ni el proveedor de identidad ni el de variables están bajo el control de esta plataforma. Su
plan de continuidad debe considerarse aparte: sin el proveedor de identidad el portal no
autentica, aunque las integraciones por API key sigan operando.

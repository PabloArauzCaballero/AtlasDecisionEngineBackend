# Respaldo y restauración

## Qué respaldar

| Elemento | Criticidad | Nota |
| --- | --- | --- |
| PostgreSQL completo | **Máxima** | Contiene diseño, evidencia y auditoría |
| Secretos (`AUDIT_HASH_SECRET` y sus retirados) | **Máxima** | Sin ellos la cadena de auditoría **no se puede verificar**, aunque los datos estén intactos |
| Redis | Baja | Idempotencia y límite de tasa; reconstruible, con la salvedad de abajo |
| Imágenes de contenedor | Media | Reconstruibles desde el repositorio si se conserva el commit |

!!! danger "El secreto de auditoría forma parte del respaldo"
    Restaurar la base sin el secreto con el que se firmaron sus eventos deja una cadena
    **inverificable**. Los secretos retirados (`AUDIT_HASH_PREVIOUS_SECRETS`) también hacen
    falta: sin ellos no se pueden verificar los eventos anteriores a la última rotación.

!!! warning "Perder Redis no es gratis"
    Se pierden las reservas de idempotencia en vuelo. Un canal que reintente durante la ventana
    de pérdida puede producir una **segunda decisión** para la misma solicitud. Si Redis se
    pierde, considere congelar el tráfico de decisión hasta restablecerlo.

## Cadencia sugerida

| Tipo | Frecuencia | Retención |
| --- | --- | --- |
| Completo | Diario | Según el plazo regulatorio aplicable |
| Incremental / WAL | Continuo | Para recuperación a un punto en el tiempo |
| Prueba de restauración | **Mensual** | Un respaldo no probado no es un respaldo |

## Restaurar

1. Detener el tráfico de escritura (API y worker).
2. Restaurar PostgreSQL al punto elegido.
3. Reponer los secretos, incluidos los retirados.
4. Ejecutar `yarn prisma:migrate` si el código es más nuevo que el respaldo.
5. Comprobar `/health/ready`.
6. **Verificar la cadena de auditoría por tenant**: `GET /v1/audit/chain/verify`.
7. Reanudar el tráfico.

El paso 6 no es opcional: es lo que distingue una restauración correcta de una que dejó la
evidencia rota.

## Recuperación a un punto en el tiempo

Restaurar a un punto anterior **descarta decisiones ya comunicadas** al canal de originación.
Antes de hacerlo hay que decidir qué se hace con ellas; es una decisión de negocio, no de
operación. Ver [recuperación ante desastres](../operations/disaster-recovery.md).

## Lo que no se puede «reparar»

Si la verificación de la cadena falla, **no** se recalculan hashes para que cuadre. Eso
destruiría la propiedad que hace útil la cadena. Declare un incidente de integridad y siga el
[runbook de operación](../runbooks/OPERATIONS.md).

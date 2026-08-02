# Reintentos y cola muerta

## Retroceso exponencial

Un despacho fallido no se reintenta de inmediato: se reprograma con `available_at` en el
futuro, con espera creciente por intento. Reintentar en bucle cerrado convertiría un
consumidor caído en una tormenta de escrituras contra la misma tabla.

## Cola muerta (DEAD)

Agotados los `OUTBOX_MAX_ATTEMPTS` (8 por defecto), el evento pasa a `DEAD`.

!!! warning "`DEAD` requiere una persona, no más réplicas"
    Un evento muerto falló ocho veces con retroceso creciente. Escalar el worker no lo arregla:
    el fallo está en el consumidor o en el propio evento. Se marca `atlas_outbox_dead_total`
    justamente para que dispare una alerta con destinatario humano.

## Diagnóstico

```sql
-- ¿Cuánto backlog hay y de qué tipo?
select event_type, status, count(*)
from decision_event_outbox
group by 1, 2 order by 3 desc;

-- ¿Qué está muerto y por qué?
select id, event_type, attempt_count, last_error, occurred_at
from decision_event_outbox
where status = 'DEAD'
order by occurred_at desc limit 50;
```

## Reproceso de un evento muerto

1. Entender **por qué** falló: `last_error` y los registros del consumidor.
2. Corregir la causa. Reencolar sin corregir produce otra muerte en ocho intentos.
3. Devolverlo a `PENDING` con `available_at` en el pasado y `attempt_count` a cero.
4. Verificar que el consumidor lo procesa y que la deduplicación no lo descarta por haberlo procesado parcialmente antes.

El paso 4 importa: si el consumidor llegó a registrar el evento en
`decision_processed_event` antes de fallar, el reproceso lo descartará. En ese caso hay que
decidir explícitamente si el efecto de negocio quedó completo o no.

## Señales y umbrales

| Métrica | Significa | Acción |
| --- | --- | --- |
| `atlas_outbox_pending` estable y bajo | Sano | — |
| `atlas_outbox_pending` creciente sostenido | El despacho no da abasto o falla | Escalar el worker; revisar errores del relay |
| `atlas_outbox_dispatched_total` plano con `pending` creciente | Ningún proceso corre el relay | Comprobar `WORKER_ROLE` |
| `atlas_outbox_dead_total > 0` | Hay eventos abandonados | Atención de operador |

## Qué NO hacer

- **No borrar** filas del outbox para «limpiar» el backlog: cada una representa un cambio de negocio que alguien espera.
- **No subir `OUTBOX_MAX_ATTEMPTS`** para evitar la cola muerta: solo retrasa el diagnóstico.
- **No desactivar el relay** en producción como mitigación: el backlog sigue creciendo, solo que sin señales.

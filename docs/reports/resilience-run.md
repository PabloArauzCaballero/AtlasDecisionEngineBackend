<!-- GENERADO POR scripts/resilience-test.sh — no editar a mano. -->

# Matriz de resiliencia — ejecución

Generado por `./scripts/resilience-test.sh` contra `compose.resilience.yml`, un
proyecto de Compose aislado del entorno de desarrollo.

**Resultado: 10 correctos, 0 fallidos.**

| Id | Escenario | Esperado | Observado | Veredicto |
| --- | --- | --- | --- | --- |
| R01 | Reparto normal | DISPATCHED y 1 notificación | `estado=DISPATCHED notificaciones=+1` | **OK** |
| R02 | Error permanente a DLQ | DEAD tras exactamente 3 intentos, con last_error | `estado=DEAD intentos=3 last_error=si` | **OK** |
| R03 | Reproceso desde DLQ | DISPATCHED tras corregir y reencolar | `estado=DISPATCHED` | **OK** |
| R04 | Duplicado sin efecto duplicado | notificaciones iguales antes y después; 1 marca de proceso | `antes=1 despues=1 marcas=1` | **OK** |
| R05 | Consumidores detenidos y reanudados | 20 encolados sin consumidor; 20 repartidos al volver | `pendientes_con_worker_parado=20 repartidos=20` | **OK** |
| R06 | Redundancia sin duplicar trabajo | 150 notificaciones y 150 marcas con 3 réplicas activas | `notificaciones=150 marcas=150 replicas_activas=3` | **OK** |
| R07 | Apagado controlado | 60 eventos, 60 notificaciones, ninguno bloqueado | `notificaciones=60 bloqueados=0 repartidos_antes=60` | **OK** |
| R08 | Reinicio de la base de datos | el worker se recupera solo y no pierde eventos | `notificaciones=40 worker_vivo=1` | **OK** |
| R09 | Reinicio de la caché | el reparto de eventos NO depende de Redis | `estado=DISPATCHED` | **OK** |
| R10 | Pérdida temporal de red | sin pérdida de eventos; recuperación automática | `notificaciones=25` | **OK** |

# ADR-0021: Separación de procesos por `WORKER_ROLE`

## Estado

Aceptado — 2026-07-31

## Contexto

Tres trabajos de fondo —relay del outbox, worker de corridas de prueba y purga de idempotencia—
corrían dentro de **cada réplica de la API**. Los tres reclaman su trabajo de forma atómica
(`FOR UPDATE SKIP LOCKED` + lease), así que nunca fue incorrecto, pero impedía operar el
sistema:

1. Escalar el plano de decisión multiplicaba la carga de fondo, que competía por el mismo pool
   de conexiones justo en las réplicas sensibles a latencia.
2. Un lote de pruebas pesado degradaba el p95 de las decisiones en línea, sin forma de
   separarlos salvo apagando el worker en todas partes.
3. Apagarlos exigía coordinar tres variables distintas — y el worker de corridas **no tenía
   interruptor**: se arrancaba en todo proceso que cargara su módulo.

## Fuerzas y restricciones

- No romper despliegues existentes de un solo contenedor.
- No duplicar la definición de la configuración entre procesos.
- El orquestador necesita sondear un proceso que no sirve HTTP.
- Un error de configuración no debe producir un contenedor vivo que no procesa nada.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Dejarlo como estaba | No resuelve ninguno de los tres problemas |
| Un interruptor por trabajo | Ya existía en dos de tres y era justo lo difícil de coordinar |
| Un binario y una imagen distintos para el worker | Permitiría que una corriera código más viejo que la otra sobre el mismo esquema |
| Un planificador externo (cron, broker) | Añade una dependencia operativa para un problema que el lease ya resuelve |

## Decisión

Una variable, `WORKER_ROLE`, con tres valores:

| Rol | Sirve HTTP | Trabajos de fondo | Arranque |
| --- | --- | --- | --- |
| `ALL` (por defecto) | Sí | Sí | `dist/main.js` |
| `API` | Sí | No | `dist/main.js` |
| `WORKER` | No | Sí | `dist/worker.js` |

- `ALL` por defecto: un despliegue existente que no declare nada se comporta igual que antes.
- Los interruptores por trabajo se conservan y se combinan con Y lógico: el rol dice **dónde** puede correr, el interruptor si está **activo**.
- `dist/worker.js` carga el **mismo** `AppModule` como contexto de aplicación, sin adaptador HTTP.
- Sondas mínimas con `node:http` en `WORKER_HEALTH_PORT`, delegando en el mismo `HealthProbeService` que usa la API.
- Arrancar el worker con `WORKER_ROLE=API` **falla al arrancar**.

## Consecuencias positivas

- API y worker se escalan por separado.
- Un lote de pruebas ya no compite con las decisiones en línea.
- Una sola variable expresa la intención.
- Un proceso mal configurado se detiene en vez de fingir que trabaja.
- Una sola imagen: imposible que las dos cargas corran código distinto.

## Consecuencias negativas

- Una carga más que desplegar y vigilar.
- Un nuevo modo de fallo silencioso: **todo** desplegado como `API`. Mitigado con el `role` en la sonda de vida, el registro explícito de cada trabajo que no arranca y una alerta de relay detenido.
- Un puerto adicional que exponer para las sondas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Nadie corre los trabajos de fondo | Alerta sobre `atlas_outbox_dispatched_total == 0` con pendientes > 0 |
| Dos generaciones del worker compiten en un rollout | Estrategia `Recreate` y periodo de gracia de 60 s |
| La configuración de los dos procesos se separa | Comparten `AppModule` y esquema; es estructuralmente imposible |

## Evidencia

Salida real de un proceso `WORKER`:

```json
{"context":"WorkerBootstrap","metadata":{"message":"ATLAS Decision Engine worker started","role":"WORKER","healthPort":3011}}
GET /health/ready → {"status":"ready","checks":{"database":"ok","cache":"redis"}}
```

Salida real de un proceso `API`:

```json
{"context":"TestRunWorkerService","msg":"Test run worker not started: WORKER_ROLE=API"}
{"context":"RetentionSweeperService","msg":"Runtime retention sweep not started (WORKER_ROLE=API)"}
{"context":"OutboxRelayService","msg":"Outbox relay not started: WORKER_ROLE=API"}
```

Pruebas: `test/worker-role.spec.ts` (7).

## Plan de revisión

Revisar si aparece un cuarto trabajo de fondo con un perfil de recursos muy distinto (por
ejemplo, uno intensivo en CPU), que justificaría un tercer rol en vez de ampliar `WORKER`.

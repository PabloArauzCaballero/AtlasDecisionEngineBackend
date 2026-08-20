# Resiliencia: catálogo de escenarios

Qué se rompe, qué debe ocurrir cuando se rompe, y cómo comprobarlo sin esperar a que pase en
producción. El catálogo es **ejecutable**: `scripts/resilience-test.sh` provoca cada escenario
y contrasta el comportamiento observado con el esperado.

La última ejecución queda en [resilience-run.md](../reports/resilience-run.md), regenerada por
el propio script.

## Cómo se ejecuta

```bash
./scripts/resilience-test.sh              # el catálogo completo
./scripts/resilience-test.sh R02 R06      # solo los indicados
KEEP_UP=1 ./scripts/resilience-test.sh    # deja la pila en pie para inspeccionarla
```

!!! warning "Corre en un proyecto de Compose APARTE"
    `compose.resilience.yml` declara `name: atlas-resilience`, con su red, sus contenedores y
    sus volúmenes. No es una comodidad: el catálogo mata procesos, corta la red y satura la
    cola, y este repositorio lo trabajan **varios agentes sobre el mismo árbol** (ver
    `AGENT-COORDINATION.md`). Nada de lo que hace toca la pila de desarrollo, y `down -v` no se
    lleva por delante el trabajo de nadie.

    PostgreSQL usa un volumen propio y efímero (`res_pgdata`), que `down -v` se lleva.

### Por qué el banco NO usa `tmpfs` para la base

Merece explicarse, porque la primera versión sí lo hacía y parecía razonable: memoria en vez
de disco, suite más rápida, datos que no sobreviven. **Y arruinaba el escenario R08.**

Un montaje `tmpfs` se destruye al reiniciar el contenedor. Así que «reiniciar PostgreSQL bajo
carga» no reiniciaba la base: la **borraba**, esquema incluido. El worker no tenía a qué
volver, R08 se declaraba fallido, y R09 y R10 caían detrás en cascada por la misma causa. Tres
fallos seguidos que no eran del sistema, sino del banco que lo medía.

Una prueba de durabilidad exige almacenamiento durable. La velocidad se conserva por otra vía
—`fsync=off` y `synchronous_commit=off`—, que renuncia a sobrevivir a un corte de corriente
pero no a un reinicio del proceso, que es justo lo que R08 mide.

Es el modo de fallo más traicionero de una suite de resiliencia: **el arnés rompe algo que la
prueba atribuye al sistema**. De ahí que cada escenario declare qué invariante ataca; cuando un
fallo no encaja con su invariante, sospeche del banco antes que del código.

### El reloj va acelerado, la lógica no

El banco fija `OUTBOX_RELAY_INTERVAL_MS=200` y `OUTBOX_MAX_ATTEMPTS=3`, frente a 1 000 ms y 8
intentos en producción. Un evento irrecuperable llega así a la cola muerta en unos 3 s en vez
de varios minutos. **El código que se ejercita es exactamente el mismo**: lo que cambia es la
cadencia, no el mecanismo. Un catálogo que tarda media hora no se ejecuta, y uno que no se
ejecuta no informa de nada.

## El catálogo

| Id | Escenario | Comportamiento esperado | Qué invariante protege |
| --- | --- | --- | --- |
| **R01** | Reparto normal de un evento | `DISPATCHED` y exactamente una notificación | El camino feliz, como referencia de los demás |
| **R02** | Error **permanente** (payload que ningún reintento arregla) | Reintentos con retroceso, `DEAD` tras exactamente 3 intentos, con `last_error` | Ni reintentos infinitos ni pérdida silenciosa |
| **R03** | Reproceso desde la DLQ tras corregir la causa | `DISPATCHED` al reencolar | La DLQ es recuperable, no un cementerio |
| **R04** | Reentrega del **mismo** evento | Ni una notificación de más; una sola marca en `decision_processed_event` | Idempotencia del consumidor |
| **R05** | **Todos** los consumidores detenidos, y reanudados | Lo publicado se acumula sin perderse y drena al volver | El productor no depende del consumidor |
| **R06** | **Tres réplicas** sobre 150 eventos | 150 notificaciones y 150 marcas, repartidas entre varias réplicas | Redundancia sin trabajo duplicado (`FOR UPDATE SKIP LOCKED` + *lease*) |
| **R07** | `SIGTERM` con la cola llena | Ningún evento perdido ni bloqueado; drena al reiniciar | Apagado controlado, sin confirmar de más |
| **R08** | Reinicio de **PostgreSQL** bajo carga | El worker se recupera **solo**, sin intervención | El bus de este sistema vive en la base |
| **R09** | Reinicio de **Redis** | El reparto de eventos continúa | La mensajería no depende de la caché |
| **R10** | Pérdida temporal de **red** del worker | Sin pérdida de eventos; recuperación automática al reconectar | Tolerancia a partición transitoria |

Además, verificados fuera del script por ser de infraestructura:

| Escenario | Resultado |
| --- | --- |
| Caída **total** del demonio de Docker | Toda la pila vuelve sola (`restart: unless-stopped`), incluidos los proyectos vecinos |
| Restauración completa de la base | 86 tablas, migraciones al día, pila reanudada `healthy` — ver [recuperación ante desastres](disaster-recovery.md) |

## Por qué estos escenarios y no otros

El criterio no es «romper cosas», sino **atacar cada garantía que el diseño afirma dar**. El
outbox promete cuatro cosas, y hay un escenario por cada una:

1. *No se pierde ningún evento* → R05, R07, R08, R10.
2. *Ninguno se procesa dos veces* → R04, R06.
3. *Los irrecuperables acaban visibles, no en silencio* → R02, R03.
4. *Se puede escalar sin duplicar trabajo* → R06.

R06 merece una nota: la prueba de que tres réplicas no se pisan **no** es que el proceso no
falle, sino que el número de efectos coincide exactamente con el número de eventos. Contar
notificaciones es lo que distingue «no se rompió» de «no se duplicó».

## Capacidad: una pregunta distinta

El catálogo de arriba comprueba **corrección** —que nada se pierda ni se duplique—. Cuánto
aguanta es otra pregunta, y tiene su propio script:

```bash
./scripts/load-test.sh                 # curva con 1, 2 y 3 réplicas sobre 3000 eventos
EVENTS=10000 ./scripts/load-test.sh    # otro tamaño de lote
```

Mide throughput y latencia por percentiles sobre datos que el motor **ya persiste**:
`occurred_at` es cuándo se confirmó el evento y `dispatched_at` cuándo se repartió, así que no
hace falta instrumentar nada para medirlo. Resultados en
[load-run.md](../reports/load-run.md).

Dos decisiones que cambian lo que sale:

- Los consumidores se paran **antes** de encolar. Publicar con el worker vivo mezclaría dos
  relojes: lo que tarda PostgreSQL en insertar y lo que tarda el relay en repartir.
- El tiempo incluye el **arranque de las réplicas**, a propósito: es el número que un operador
  observa, no el ideal del bucle interno.

Y una comprobación que no es de rendimiento pero se hace igual: que bajo carga se repartan
exactamente los eventos encolados y se produzca exactamente una notificación por evento. Un
throughput alto que duplica efectos no es capacidad, es un fallo.

### El hallazgo: escalar workers NO acelera el reparto

Primera medición, 3000 eventos por lote:

| Réplicas | Drenaje | Throughput | Mejora |
| --- | --- | --- | --- |
| 1 | 52 143 ms | 57 ev/s | — |
| 2 | 50 653 ms | 59 ev/s | +3 % |
| 3 | 46 955 ms | 63 ev/s | **+10 %** |

Triplicar las réplicas mejora un 10 %. Si el worker fuera el cuello de botella, se esperaría
algo cercano a ×3. **No lo es.**

La explicación está en el camino de cada evento: el relay reclama un lote y luego lo procesa
**en serie** (`for (const row of rows) await dispatchOne(row)`), y cada entrega cuesta tres
viajes a PostgreSQL —marca de idempotencia, notificación y confirmación de la fila—. A 57 ev/s
salen unos 17 ms por evento, que es exactamente el orden de magnitud de esos viajes. El límite
lo pone la base de datos, no el número de procesos que la consultan.

Esto **cuantifica** la limitación que [ADR-0027](../adr/ADR-0027-messaging-technology-selection.md)
ya declaraba de forma cualitativa («el repartidor es un sondeo transaccional sobre una tabla»),
y corrige una intuición cara: ante una cola acumulada, `--scale worker=N` **no** es la palanca.
Por eso el [runbook de cola acumulada](../runbooks/OPERATIONS.md#cola-acumulada) manda primero
comprobar que alguien esté repartiendo, y deja escalar para el final.

Las palancas que sí moverían la aguja, por si algún día hace falta: subir `OUTBOX_BATCH_SIZE`,
agrupar las escrituras del consumidor en una sola transacción, o repartir en paralelo dentro
del lote. Ninguna se ha implementado porque el volumen real —decenas a cientos de eventos por
minuto— cabe holgado en los 57 ev/s del peor caso medido.

!!! warning "Los números absolutos no son de producción"
    La medición se tomó en un portátil con Docker Desktop y varios proyectos más en marcha, y
    con `fsync=off`. Lo que se sostiene es **la forma de la curva** —que aplanar réplicas no
    escala—, no los 57 ev/s como cifra de capacidad. Para un número de capacidad real hay que
    repetirlo en hardware de destino.

## Escenarios no cubiertos

Honestidad sobre el alcance:

- **OOM del worker.** Se puede provocar bajando `RES_WORKER_MEMORY`, pero el resultado depende
  tanto del anfitrión que la evidencia sería poco transferible.
- **Carga sostenida durante horas.** `load-test.sh` mide ráfagas, que es lo que estresa al
  repartidor; no cubre degradación lenta por crecimiento de índices (riesgos R2 y R3 en
  [contenedores, redes y riesgos](../docker/architecture.md)).
- **Dependencias externas** (proveedor de identidad, proveedores semánticos). Viven fuera de
  este despliegue; su plan de continuidad se trata en
  [recuperación ante desastres](disaster-recovery.md).

## Al añadir un escenario

1. ¿Qué garantía concreta ataca? Si no hay una, sobra.
2. ¿Cómo se distingue «no se rompió» de «se comportó bien»? Cuente efectos, no ausencias de
   error.
3. Espere por **condición**, nunca con un `sleep` fijo: un tiempo arbitrario convierte la
   prueba en una moneda al aire.
4. Declare esperado y observado por separado, para que el informe se lea sin abrir el código.

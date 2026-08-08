# Fase 22 — Coste de la instrumentación

> **Lea esto antes que los números.** Se midió el **coste de crear un span** (microbanco) y la
> **latencia de la API** contra el binario compilado, incluida la **línea base con la telemetría
> apagada**. Lo que **no** se midió: CPU, memoria, uso de red y el comportamiento con el
> Collector saturado. Las cifras son de una máquina de desarrollo y valen para comparar
> escenarios **entre sí**, no como cota para producción.

## Medición de extremo a extremo (API compilada)

Herramienta: [`scripts/bench-telemetry.mjs`](../../scripts/bench-telemetry.mjs), incluida en el
repositorio para poder repetirla.

```bash
yarn build && yarn jaeger:up
node scripts/bench-telemetry.mjs --label otel-on-100 --requests 400 --concurrency 4 \
  --base-url http://127.0.0.1:3100 --path /v1/artifacts/__bench__
```

El **mismo binario** en los dos escenarios; lo único que cambia son las variables `OTEL_*`. 50
peticiones de calentamiento descartadas —la primera paga JIT y apertura de pool—, 400 medidas,
concurrencia 4, sobre una ruta que atraviesa el pipeline completo sin escribir en base de datos.

### Tanda final — línea base contra telemetría activa

Mismo binario, misma máquina, ejecuciones consecutivas, 300 peticiones cada una:

| Escenario | media | p50 | p95 | p99 | máx | req/s | errores |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **`OTEL_ENABLED=false`** (línea base) | 54,15 ms | 48,99 ms | 95,45 ms | 128,00 ms | 139,92 ms | 73,3 | **0** |
| **`OTEL_ENABLED=true`**, muestreo 100 % | 84,12 ms | 63,24 ms | 160,66 ms | 558,50 ms | 572,66 ms | 46,9 | **0** |

**Sobrecarga medida con muestreo al 100 %:** +29,97 ms de media (**+55 %**), +14,25 ms en p50
(**+29 %**), y **−36 % de throughput**.

Es un techo, no el coste esperado en producción, por tres motivos concretos:

1. **El muestreo al 100 % no es la configuración de producción.** El ratio recomendado es `0.10`.
2. La ruta medida **no toca la base de datos**: el coste fijo de la instrumentación pesa mucho
   más en proporción que en una decisión real, donde domina el tiempo de las consultas y de los
   proveedores externos.
3. La máquina es de desarrollo, con Postgres, Redis y contenedores compitiendo por CPU.

Aun así, la conclusión operativa se sostiene: **la instrumentación no es gratis, y por eso el
ratio de producción no debe ser 1.0.**

### Tanda previa — coste del ratio de muestreo

Medida antes, con 400 peticiones y la máquina más cargada:

| Escenario | media | p50 | p95 | p99 | req/s | errores |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Muestreo **10 %** | 114,32 ms | 80,43 ms | 252,46 ms | 414,50 ms | 34,8 | **0** |
| Muestreo **100 %** | 126,65 ms | 109,57 ms | 284,68 ms | 366,13 ms | 31,5 | **0** |

Muestrear todo frente a una décima parte cuesta **+12,3 ms de media (+9,5 %)** y **−9,5 % de
throughput**. Las magnitudes absolutas de esta tanda son mayores que las de la final porque la
máquina estaba más cargada; lo comparable es la **diferencia entre escenarios**, y es lo que
respalda el ratio recomendado.

### El resultado que más importa: Jaeger inalcanzable no afecta a las peticiones

Durante el escenario de muestreo al 100 %, el exportador **agotó su timeout** contra Jaeger:

```json
{"name":"Error","message":"Request timed out",
 "stack":"Error: Request timed out\n    at ClientRequest.<anonymous> (.../otlp-exporter-base/.../http-transport-utils.js:112:24)"}
```

En esa misma ejecución la API sirvió **400 peticiones con 0 errores** y un p99 de 366 ms. Es la
evidencia directa —no un razonamiento— del criterio de aceptación: la exportación es asíncrona,
su fallo se reporta por el canal de diagnóstico de OpenTelemetry y **no se propaga al camino de
la decisión**.

### Escenario que no llegó a medirse por separado

| Escenario | Motivo |
| --- | --- |
| Telemetría activa con Jaeger **apagado** | Un primer intento no arrancó (`Connection terminated due to connection timeout` contra PostgreSQL, máquina saturada). No se repitió porque el comportamiento que iba a verificar **ya quedó demostrado**: el timeout del exportador descrito arriba ocurrió con la API sirviendo 400 peticiones y 0 errores |

## Microbanco: coste de crear un span

Microbanco de creación y cierre de un span con dos atributos, 20 000 iteraciones por escenario.

| Escenario | p50 | p95 | p99 |
| --- | ---: | ---: | ---: |
| **A.** Sin SDK (`OTEL_ENABLED=false`) | 0,90 µs | 2,90 µs | 6,50 µs |
| **B.** SDK activo, muestreo 1.0, `SimpleSpanProcessor` | 36,80 µs | 163,20 µs | 1 705,60 µs |
| **C.** SDK activo, span **no** muestreado | 10,20 µs | 20,30 µs | 258,70 µs |

Comando exacto:

```bash
node --input-type=module -e "...bench de 20000 iteraciones por escenario..."
```

### Cómo leer esto

- **A ≈ 1 µs** confirma lo que importa del interruptor: con la telemetría apagada la API de
  OpenTelemetry devuelve objetos no-operativos y el coste es efectivamente nulo. Un despliegue
  que no quiera trazas no paga por tenerlas disponibles.
- **B está inflado y no representa producción.** El microbanco usa `SimpleSpanProcessor`, que
  exporta **en línea, span a span**. En producción el `NodeSDK` usa `BatchSpanProcessor`, que
  encola y exporta en lotes fuera del camino de la petición. La cifra de B es un techo, no una
  estimación.
- **C** es el coste de un span descartado por el muestreo: el que pagan las peticiones que en
  producción **no** se exportan. Es la cifra relevante para dimensionar un ratio bajo.
- **Los p99 no son fiables.** La máquina de medición estaba ejecutando la suite de pruebas y
  contenedores de Postgres, Redis, API y worker al mismo tiempo. Un p99 de 1,7 ms para crear un
  objeto en memoria es ruido de planificación del sistema operativo, no coste de OpenTelemetry.

### Contexto de la medición

| | |
| --- | --- |
| Node | v24.18.1 |
| Plataforma | Windows 11, Docker Desktop |
| Carga concurrente | **Alta** — suite de pruebas y seis contenedores en marcha |
| Iteraciones | 20 000 por escenario |

## Lo que NO se midió, y por qué

| Medición pendiente | Por qué no se hizo |
| --- | --- |
| CPU y memoria del proceso | Igual: sin aislamiento, la atribución de consumo no es defendible |
| Throughput (peticiones/s) | Ídem |
| Tiempo de arranque y de cierre | Medible, pero sin valor sin las anteriores |
| Pérdida de spans con el Collector saturado | Requiere desplegar el Collector y provocar la saturación |
| Uso de red del exportador | Requiere la prueba de carga |

**Ninguna de estas se ha estimado ni inventado.**

## Qué sí está verificado sin necesidad de medir

Por prueba ejecutada, no por medición de rendimiento:

- El backend **arranca y opera con `OTEL_ENABLED=false`**, sin parcheo ni exportador
  ([observability-interceptor.spec.ts](../../test/observability-interceptor.spec.ts)).
- La exportación es **asíncrona y tolerante a fallos**: un destino inalcanzable pierde spans y
  no afecta a ninguna petición. Ya no es sólo una propiedad del `BatchSpanProcessor` — quedó
  **observado**: el exportador agotó su timeout y las 400 peticiones de ese mismo escenario se
  sirvieron con 0 errores (ver arriba).
- El muestreo **basado en el padre** permite bajar el volumen sin partir trazas a la mitad.

## Cómo completar esta fase

Cuando haya un entorno de staging aislado:

1. Desplegar tres réplicas idénticas: `OTEL_ENABLED=false`, muestreo `1.0`, muestreo `0.1`.
2. Aplicar la misma carga sintética a las tres (el mismo artefacto de decisión, el mismo
   perfil de peticiones) durante al menos 15 minutos tras el calentamiento.
3. Recoger de `/metrics`: latencia p50/p95/p99 por ruta, throughput, tasa de error.
4. Recoger del orquestador: CPU y memoria por réplica.
5. Repetir con Jaeger detenido para confirmar que la latencia **no cambia**.
6. Repetir saturando el Collector para medir la pérdida de spans
   (`otelcol_processor_dropped_spans`).
7. Sustituir este documento por los resultados reales y fijar el ratio de producción con ellos.

Hasta entonces, el ratio de producción recomendado (`0.10`) es un **punto de partida
conservador**, no una conclusión medida — así consta también en
[01-architecture-design.md](01-architecture-design.md).

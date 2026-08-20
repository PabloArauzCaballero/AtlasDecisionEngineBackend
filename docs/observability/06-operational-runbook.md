# Fase 24 — Runbook operativo de observabilidad

Diagnóstico de fallos **de la observabilidad**, no del motor. Si lo que falla es una decisión,
empiece por [runbooks/OPERATIONS.md](../runbooks/OPERATIONS.md).

Regla previa: **la observabilidad nunca puede ser la causa de un incidente de negocio.** Si
sospecha que lo es, `OTEL_ENABLED=false` y desplegar es siempre una salida segura: el motor
arranca y funciona sin telemetría.

---

## 1. Jaeger no recibe trazas

Síntoma: el servicio no aparece en la UI, o aparece y no llega nada nuevo.

Recorra en este orden; cada paso descarta el anterior.

### 1.1 ¿Está encendida?

```bash
# Dentro del contenedor afectado
env | grep OTEL_
```

`OTEL_ENABLED` debe ser `true`, `1` o `yes`. Se admiten mayúsculas y espacios sobrantes
(`readTelemetryConfig` aplica `trim().toLowerCase()`), pero **cualquier otro valor deja la
telemetría apagada en silencio**: un `enabled`, un `on` o un `si` no encienden nada y no
producen ningún aviso. Es el fallo más frecuente y el que más tiempo consume.

### 1.2 ¿Hay cabecera de traza en la respuesta?

```bash
curl -sS -D - -o /dev/null https://<host>/v1/artifacts/__probe__ | grep -i x-trace-id
# Sirve cualquier ruta trazada, incluida una que devuelva 401: la cabecera la publica también
# DomainExceptionFilter, porque los interceptores no se ejecutan cuando un guard rechaza.
```

- **Sale la cabecera** → la instrumentación funciona; el problema es de exportación (siga en 1.3).
- **No sale** → el problema es local: telemetría apagada, ruta excluida
  (`UNTRACED_HTTP_PATHS`), o el muestreo la descartó (siga en 1.5).

### 1.3 ¿El destino es alcanzable?

El error clásico es el endpoint equivocado según dónde corra el proceso:

| Dónde corre | Endpoint correcto |
| --- | --- |
| En Docker, misma red que Jaeger | `http://jaeger:4318/v1/traces` |
| En el host | `http://localhost:4318/v1/traces` |
| Producción | El del Collector, **nunca** Jaeger directamente |

```bash
# Desde el contenedor de la aplicación
wget -qO- --post-data='' http://jaeger:4318/v1/traces ; echo "rc=$?"
getent hosts jaeger        # ¿resuelve el nombre?
```

Un `rc` de red distinto de 0 es un problema de DNS o de red de Docker: compruebe que el
servicio está en la red correcta (ver la nota de `networks` en `docker-compose.jaeger.yml`).

### 1.4 ¿Qué dice el propio OpenTelemetry?

```bash
# Reinicie el proceso con el diagnóstico interno abierto
OTEL_DIAG_LOG_LEVEL=DEBUG node dist/main.js
```

Aquí aparecen los fallos del exportador que en nivel `ERROR` se ven resumidos o no se ven. Es
el paso que revela un endpoint mal formado o un TLS rechazado.

### 1.5 ¿Se lo está comiendo el muestreo?

```bash
env | grep OTEL_TRACES_SAMPLER
```

Con `OTEL_TRACES_SAMPLER_ARG=0.1` sólo una de cada diez trazas nuevas se exporta: es
**normal** no encontrar una petición concreta. Para diagnosticar, súbalo temporalmente a `1.0`
en una réplica y reproduzca.

Ojo al muestreo basado en padre: si un servicio aguas arriba decidió no muestrear, aquí se
respeta esa decisión y no se exporta nada por más que el ratio local sea 1.

### 1.6 ¿El Collector está descartando?

```bash
curl -s http://<collector>:8888/metrics | grep -E 'otelcol_(exporter_send_failed|processor_dropped)'
```

- `processor_dropped_spans` creciendo → `memory_limiter` está actuando: el Collector va corto
  de memoria o le llega más de lo que puede procesar.
- `exporter_send_failed_spans` creciendo → el Collector no alcanza a Jaeger. Mire Jaeger, no el
  Collector.

---

## 2. El backend se ha vuelto lento

Primero: **descarte que sea la telemetría** poniendo `OTEL_ENABLED=false` en una réplica y
comparando. Si la latencia no cambia, el problema está en otro sitio y este runbook no aplica.

Si sí cambia:

| Sospecha | Comprobación | Corrección |
| --- | --- | --- |
| Muestreo al 100 % en producción | `OTEL_TRACES_SAMPLER_ARG` | Bajar a 0.1–0.2 |
| Exportador bloqueando | Cola del Collector saturada, timeouts | Bajar `OTEL_EXPORT_TIMEOUT_MS`; escalar el Collector |
| Lotes demasiado grandes | `batch.send_batch_size` | Reducirlo |
| Instrumentación ruidosa | Cientos de spans en una petición sencilla | Revisar `telemetry.instrumentations.ts`; **no** se usa `auto-instrumentations-node` justo por esto |
| Cardinalidad excesiva | Atributos con identificadores en el nombre del span | Ver [02-business-spans-catalog.md](02-business-spans-catalog.md) |

Un span por registro en un trabajo por lotes es la causa más habitual de una degradación
súbita. La regla es **un span por lote**.

---

## 3. Los logs no traen `trace_id`

Los campos `trace_id`/`span_id` salen del **contexto activo** de OpenTelemetry
([structured-logger.service.ts](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/src/common/observability/structured-logger.service.ts)).
Que falten significa que **no había span activo** al escribir la línea. Causas, por frecuencia:

1. **Telemetría apagada.** Sin SDK no hay contexto. Es lo normal por defecto.
2. **Ruta excluida.** `/health` y `/metrics` no generan traza a propósito; sus logs no la traen.
3. **Ejecución fuera de contexto.** Un `setTimeout`, un `setInterval` o un `.then()` desprendido
   pierden el contexto asíncrono. Es el caso de los latidos de lease en los workers, y es
   correcto: ese trabajo no pertenece a ninguna traza.
4. **Muestreo.** Un span no muestreado tiene contexto válido y sí aparece en los logs; si no
   aparece nada, no es esto.

Un `trace_id` **nunca** se inventa ni se toma de una cabecera del cliente: sería falsificable y
no correspondería a ninguna traza real.

---

## 4. La traza se corta entre la API y el worker

Síntoma: la petición aparece en Jaeger, el trabajo de fondo aparece como traza suelta, y no hay
forma de unirlos.

### 4.1 ¿Se inyectó?

```sql
SELECT id, event_type, trace_carrier
FROM decision_outbox_event
ORDER BY id DESC LIMIT 5;
```

- `trace_carrier` **NULL** → no había traza activa al publicar. Telemetría apagada en la API, o
  el evento nació en un trabajo de fondo sin traza. Es un estado legítimo.
- Con `traceparent` → se inyectó bien; siga en 4.2.

Lo mismo aplica a `decision_test_run`, `decision_semantic_analysis_run` y
`decision_bank_statement_run`.

### 4.2 ¿Se extrajo?

Si la fila trae portador y el consumidor sigue abriendo traza raíz:

- Compruebe que el reclamo **selecciona** la columna. Un `RETURNING` sin `trace_carrier`
  entrega `undefined` al consumidor y éste abre traza raíz sin quejarse — por diseño, porque
  perder la correlación nunca puede costar el trabajo.
- Compruebe que el worker tiene la telemetría encendida. Es un **proceso distinto** con su
  propia configuración: encenderla sólo en la API es un error frecuente.
- Compruebe `OTEL_PROPAGATORS`: emisor y receptor deben compartir `tracecontext`.

### 4.3 Filas antiguas

Las anteriores a la migración `20260804160000_trace_carrier_propagation` tienen `trace_carrier`
NULL y **no se pueden correlacionar**. Es esperado y no se corrige: no existe el dato.

---

## 5. Hay datos sensibles en las trazas

**Incidente de privacidad.** Siga el procedimiento completo de
[04-data-privacy-policy.md](04-data-privacy-policy.md#procedimiento-ante-una-filtración).
Resumen de las primeras acciones:

1. Identificar el atributo y desde qué versión aparece.
2. Contener: deshabilitar la instrumentación culpable; si no se acota, `OTEL_ENABLED=false`.
3. Redactar en el Collector como parche inmediato (procesador `attributes/redact`).
4. Purgar el índice o almacenamiento del periodo afectado.
5. Reducir la retención mientras dure la investigación.
6. Revocar accesos a la UI que no sean imprescindibles.
7. Corregir en el código y **añadir una prueba** que impida la regresión.
8. Documentar el incidente.

---

## 6. Comprobación rápida de extremo a extremo

```bash
yarn jaeger:up          # levanta Jaeger local
yarn jaeger:verify      # comprueba la cadena completa y falla con un diagnóstico concreto
```

`verify-jaeger.mjs` recorre exactamente los pasos de la sección 1 y dice cuál falla, incluida la
comprobación de que ninguna traza almacenada contiene atributos prohibidos.

---

## 7. Apagado de emergencia

```bash
OTEL_ENABLED=false   # y redesplegar
```

El motor arranca y opera con normalidad sin telemetría: no se parchea nada, no hay exportador y
no hay conexiones de fondo. Es una salida segura y verificada por prueba
([observability-interceptor.spec.ts](https://github.com/PabloArauzCaballero/AtlasDecisionEngineBackend/blob/main/test/observability-interceptor.spec.ts)).

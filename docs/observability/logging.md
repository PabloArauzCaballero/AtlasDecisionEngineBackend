# Registros

## Formato

JSON estructurado por línea, sobre `pino`, escrito **siempre a stdout**. Nunca `console.log`.

```json
{"level":30,"time":"2026-07-31T05:04:44Z","service":"atlas-decision-engine-backend",
 "version":"2.0.0","context":"OutboxRelayService","msg":"..."}
```

| Campo | Para qué |
| --- | --- |
| `level` | 30 = info, 40 = warn, 50 = error |
| `time` | ISO 8601 UTC |
| `service`, `version` | Identifican el artefacto que emitió la línea |
| `context` | Clase o subsistema |
| `requestId` | Correlación con la petición y con la respuesta |
| `msg` | Mensaje |

## Correlación

Toda petición obtiene un `x-request-id` —el recibido si tiene forma válida, o uno generado— que
viaja en la respuesta y en cada línea de registro. Es el identificador que un integrador debe
citar al reportar una incidencia, y el que aparece en el cuerpo de todo error.

## Niveles y su criterio

| Nivel | Cuándo |
| --- | --- |
| `error` | `5xx` y fallos no controlados |
| `warn` | `4xx`: denegaciones, validaciones, reglas de negocio |
| `log` | Ciclo de vida y hechos operativos relevantes |
| `debug`/`verbose` | Diagnóstico; **prohibidos en producción** por el esquema |

!!! important "Por qué los 4xx no son `error`"
    Un `403` es tráfico esperado: alguien pidió algo que no le corresponde y el sistema
    funcionó. Registrarlo como error entrena al operador para ignorar el logger, y entonces el
    `5xx` real pasa desapercibido.

## Redacción

`StructuredLoggerService` redacta credenciales (`apiKey`, `password`, `secret`, `token`) y
campos de PII, **y también los contenedores donde suelen viajar**: `variables`, `input`,
`context`, `payload`.

Tampoco se registra el `stderr` crudo de un subproceso: el del runner de scripts puede contener
el código fuente importado o los valores que estaba procesando.

## Salida a fichero

`LOG_OUTPUT=stdout_and_file` con `LOG_FILE_PATH`. Es **opt-in** porque los contenedores corren
con la raíz de solo lectura: sin un volumen montado y escribible, el sink falla.

Si el fichero no se puede abrir, se emite el error por stderr y **la aplicación continúa** por
stdout. No reinicie el proceso: corrija el permiso o el volumen.

## Qué no registrar

- Valores de decisión en claro (van hasheados en la evidencia).
- Secretos, tokens o cabeceras de autorización.
- Cuerpos completos de petición.
- `stderr` de subprocesos.

## Uso en un incidente

```bash
# Todo lo relacionado con una petición
grep '"requestId":"01J8ZQ..."' registros.jsonl

# Denegaciones en una ventana
grep '"level":40' registros.jsonl | grep 'rejected with 403'
```

Para denegaciones, la fuente autorizada es la tabla `decision_access_audit`, no el registro:
sobrevive a la rotación de ficheros.

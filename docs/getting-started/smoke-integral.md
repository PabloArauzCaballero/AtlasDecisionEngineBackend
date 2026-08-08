# Smoke integral por tipo de usuario

Recorre **toda** la superficie HTTP con tres identidades distintas, comprobando por cada ruta
que el payload correcto funciona, que cada payload erróneo se rechaza con un código
catalogado, y que quien no tiene el rol recibe un 403. La evidencia queda en `smoke/out/`,
un JSON por usuario más un resumen de la tanda.

```bash
yarn smoke:full        # los tres, en orden, contra una instancia ya en marcha
yarn smoke:author      # sólo el autor
yarn smoke:approver    # sólo el aprobador
yarn smoke:operator    # sólo el operador
```

## Los tres tipos de usuario

| Usuario | Roles | Qué recorre |
| --- | --- | --- |
| `author` | `RISK_ANALYST`, `FRAUD_ANALYST` | Variables, artefactos, grafo, validación, compilación, importación de código, campos calculados, árboles anidados |
| `approver` | `QA_ANALYST`, `RISK_APPROVER`, `COMPLIANCE` | Suites de regresión, laboratorio de QA, cola de aprobación y decisiones ordenadas |
| `operator` | `PLATFORM_ADMIN`, `OPERATIONS`, `AUDITOR` | Despliegues, registro de librerías, auditoría, revisión manual, revisión de seguridad, trazabilidad |

**Los tres recorren los seis dominios completos**, no sólo el suyo. Es deliberado: la mitad
del valor está en las denegaciones. Que el aprobador reciba un 403 al intentar desplegar es
una comprobación tan real como que el operador consiga desplegar, y sólo se obtiene si cada
usuario lo intenta todo.

## Por qué el orden importa

El ciclo de vida de un algoritmo **no cabe en una sola identidad**: la segregación de
funciones exige que quien escribe no apruebe y que quien aprueba no despliegue. Por eso
`yarn smoke:full` los encadena y comparte el estado (`smoke/out/state.json`), en **dos
pasadas**.

La primera *construye*:

1. **author** crea la variable de entrada, el artefacto y su grafo; valida, compila y deja la
   versión en revisión con su suite bloqueante en verde.
2. **approver** decide los dos pasos de aprobación en su orden obligatorio.
3. **operator** despliega en el ambiente no productivo, revierte y suspende.

Entre las dos, la credencial de audiencia `runtime` ejecuta las decisiones: aprueba, rechaza
y deriva a revisión manual.

La segunda pasada *consume* lo construido: simulación, traza en vivo, bandeja de
notificaciones, evidencia de la ejecución auditada y el ciclo del caso de revisión manual.
Nada de eso existe hasta que la primera pasada termina, y por eso no puede comprobarse
antes.

Correrlos sueltos también funciona, pero cada smoke necesita el estado que dejó el anterior:
`yarn smoke:author` primero, y luego los demás.

## Ni una sola omitida

Una comprobación saltada no es una comprobación aprobada, así que el smoke no salta ninguna:

- Cuando un rol **no alcanza** una ruta, la llamada se hace igual con el payload roto y se
  exige `403`. Los guardianes corren antes que la validación, de modo que un payload
  inválido de quien no tiene permiso debe morir en el permiso y nunca en el validador —si
  muriera en el validador, sus mensajes de error filtrarían qué existe y qué no.
- Cuando un usuario **no puede crear** algo, continúa sobre lo que dejó el dueño en el
  estado compartido, en vez de abandonar el dominio.
- Cuando algo **depende de infraestructura ausente** —el análisis semántico necesita un
  proveedor de modelo (`SEMANTIC_ANALYSIS_PROVIDER`)— se exige el contrato de *esa*
  configuración: el catálogo debe declarar el worker indisponible y la petición debe
  quedar encolada intacta, sin perderse ni fingir que se procesó. El día que se configure el
  proveedor, la misma comprobación pasa a exigir el ciclo completo sin tocar una línea.

## Qué se comprueba en cada ruta

Para cada ruta y cada usuario:

- **si sus roles alcanzan la ruta** → el payload correcto debe responder 2xx, y cada payload
  deliberadamente roto debe ser rechazado con un código concreto (no "un 4xx cualquiera");
- **si no la alcanzan** → la misma llamada debe responder `403 FORBIDDEN`.

Cuando el usuario tiene permiso se exige el **código concreto** del rechazo, no «un 4xx
cualquiera»: un payload roto por dos motivos a la vez no fija ningún contrato, porque
cualquiera de los dos códigos valdría.

Además, en cada tanda se recorre la **frontera de autenticación** con identidades que no son
ninguno de los tres: sin credencial, con una clave inventada, con la audiencia equivocada y
pidiendo un tenant ajeno.

## Cómo se lee la evidencia

Cada comprobación tiene un identificador estable `<dominio>.<ruta>.<caso>`:

```json
{
  "id": "authoring.artifact-versions-graph-put.invalid.stale-if-match",
  "outcome": "PASS",
  "expected": "status 409 + código LOCK_CONFLICT",
  "request": { "method": "PUT", "path": "/v1/artifact-versions/584/graph" },
  "status": 409,
  "errorCode": "LOCK_CONFLICT"
}
```

Eso es lo que separa «el smoke está en rojo» de «falló
`quality.submit-for-review.valid`, esperaba 2xx y llegó 409 `BLOCKING_TESTS_NOT_PASSED`».

`summary.json` agrega además el **catálogo de códigos de error observados**. Si ahí aparece
`INTERNAL_ERROR`, el motor devolvió algo que no forma parte de su contrato: un 500 nunca es
un rechazo catalogado, es un defecto, y el smoke lo marca en rojo por muy «esperado» que
fuese el fallo.

## Identidad: JWT y clave de API

Los roles **nunca** los declara el llamante: `AuthenticationGuard` los resuelve del registro
de clientes o del proveedor de identidad, y `RolesGuard` decide con los `@Roles(...)` de cada
ruta. El smoke admite los dos mecanismos:

- **Proveedor de identidad (JWT)**, preferido cuando está configurado. Se activa definiendo
  `SMOKE_AUTHOR_EMAIL`/`SMOKE_AUTHOR_PASSWORD` (y sus equivalentes `SMOKE_APPROVER_*` y
  `SMOKE_OPERATOR_*`). Inicia sesión por `POST /v1/session/login` y usa el token portador.
  Si los roles que otorga el proveedor no cubren los del tipo de usuario, el smoke lo marca
  en rojo en vez de medir otra identidad sin avisar.
- **Clave de API**, respaldo autónomo. Registra en la base tres clientes acotados por rol
  —igual que hace la suite e2e— y no depende de ningún servicio externo, así que la tanda
  corre en cualquier entorno con base de datos.

En ambos casos la autorización la sigue decidiendo el backend. El mecanismo cambia cómo se
prueba la identidad, no quién puede hacer qué.

## Configuración

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `SMOKE_BASE_URL` | `BASE_URL` o `http://127.0.0.1:$PORT` | Instancia destino |
| `SMOKE_TENANT_ID` | `BOOTSTRAP_TENANT_ID` | Tenant sobre el que se trabaja |
| `SMOKE_ENVIRONMENT_CODE` | `SANDBOX` | Ambiente de despliegue y simulación. **Nunca PROD** |
| `SMOKE_POLL_TIMEOUT_MS` | `90000` | Tope de espera de lo asíncrono (corridas, workers) |
| `SMOKE_RUN_TAG` | marca de tiempo | Sufijo de los datos que crea la tanda |
| `SMOKE_<TIPO>_EMAIL` / `_PASSWORD` | — | Activan el camino JWT para ese tipo de usuario |

`DATABASE_URL` es obligatoria: el smoke registra sus propios clientes acotados por rol.

## Lo que encontró la primera vez que se corrió

Sirve como muestra de qué clase de defecto caza, porque ninguno lo veía la batería de
pruebas: los seis vivían en la costura entre dos piezas que por separado estaban bien.

| Defecto | Síntoma |
| --- | --- |
| Violación de unicidad sin traducir | Crear algo con un código repetido devolvía `INTERNAL_ERROR` 500 con la consulta de Prisma en el mensaje |
| `@ValidateNested()` sin `@IsDefined()` | Un contrato anidado obligatorio ausente reventaba en el servicio en vez de rechazarse con 400 |
| «Sin defecto» leído como «defecto nulo» | Ninguna variable del catálogo sembrado podía declararse como entrada de un grafo |
| `version.published` sin emisor | La rama que avisa a operaciones existía y era inalcanzable: el aviso no llegaba a nadie |
| `security.risk_detected` sin emisor | Detección y notificación escritas, y desconectadas entre sí |
| El worker sin los interruptores de script | Ejecutaba las suites pero no podía ejecutar nodos de script: un algoritmo importado nunca pasaba su suite bloqueante |

## Lo que el smoke deja atrás

Crea artefactos, variables, motivos, suites y despliegues con el sufijo de la corrida. No
borra nada a propósito —la evidencia de una tanda debe poder inspeccionarse después— y por
eso está pensado para bases de desarrollo o de prueba, no para producción. `smoke/out/` está
fuera del control de versiones porque describe una ejecución local concreta.

Complementa, no sustituye: las [pruebas](running-tests.md) unitarias, de integración y e2e
siguen siendo las que fijan el comportamiento. Esto comprueba que un sistema **ya desplegado**
responde como su contrato dice.

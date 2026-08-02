# Diagnóstico de problemas

Síntomas reales observados en este repositorio, con su causa comprobada.

## El arranque falla validando la configuración

El esquema (`src/common/config/env.schema.ts`) rechaza el arranque en vez de degradar el
comportamiento. El mensaje indica la variable exacta.

| Mensaje | Causa |
| --- | --- |
| `Required for API_KEY or HYBRID authentication` | Falta `MANAGEMENT_API_KEY` o `RUNTIME_API_KEY` |
| `Management and runtime API keys must be different` | Son iguales: una sola clave daría a runtime los permisos de gestión |
| `Production must use JWT, HYBRID or identity provider authentication` | `AUTH_MODE=API_KEY` en producción |
| `cannot use an example value in production` | Quedó un valor de `.env.example` |
| `The in-process script runner is not an OS security boundary` | `SCRIPT_NODES_ENABLED=true` sin `SCRIPT_RUNNER_MODE=SIDECAR` en producción |

## `docker compose up` se detiene pidiendo una variable

Es intencionado: **ningún secreto tiene valor por defecto** en `docker-compose.yml`. Añada la
variable que indica el mensaje a `.env`.

## `ports are not available: bind: 127.0.0.1:5432`

El puerto lo tiene un PostgreSQL instalado de forma nativa en la máquina, no otro contenedor
(`Get-NetTCPConnection -LocalPort 5432 -State Listen` da el proceso dueño). Publique el
contenedor en otro puerto con `POSTGRES_PORT` y use **el mismo** en `DATABASE_URL` y
`ADMIN_DATABASE_URL`: esas dos URLs son las que emplean Prisma, `yarn test:e2e` y los scripts
para llegar al contenedor desde el anfitrión, así que una discrepancia deja el stack en pie y
las herramientas del host apuntando a la base equivocada.

## `api` no arranca: el host no tiene gVisor

`docker-compose.yml` exige `runtime: runsc` para el sidecar `script-runner`, y la API depende
de él. En Docker Desktop (Windows/macOS) ese runtime no existe — `docker info --format
'{{json .Runtimes}}'` lo confirma — y el arranque se detiene ahí.

Para **desarrollo local únicamente** existe una anulación explícita:

```bash
docker compose -f docker-compose.yml -f docker-compose.no-gvisor.yml up -d
```

No es `docker-compose.override.yml` a propósito: el override se aplicaría solo, y desactivaría
gVisor en silencio también donde sí está. Con `runc` se conservan la ausencia de red, las
capacidades eliminadas, la raíz de solo lectura y las cotas, pero **se pierde el kernel
aislado**, que es la frontera que la [arquitectura de seguridad](../security/security-architecture.md)
describe. Nunca en producción.

## Las decisiones funcionan pero las colas crecen

Síntoma silencioso y el más peligroso del reparto de procesos: todo desplegado con
`WORKER_ROLE=API`. La API sirve, y nadie drena el outbox ni las corridas de prueba.

```bash
curl localhost:3000/health/live   # el campo "role" dice qué es este proceso
```

Busque en los registros `Outbox relay not started`, `Test run worker not started` o
`Runtime retention sweep not started`. Debe existir al menos un proceso con rol `WORKER` o `ALL`.

## Un tenant ve datos de otro

Compruebe con qué rol conecta el runtime:

```sql
select current_user;   -- debe ser atlas_app, NO el rol elevado
```

RLS es **inerte** para un superusuario. Ver [aislamiento por tenant](../security/tenant-isolation.md).

## `prisma migrate dev` pide un reset

Comportamiento conocido: hay migraciones registradas como revertidas con checksums antiguos
aunque el historial esté sano. Escriba la migración a mano y aplique con `yarn prisma:migrate`
(`migrate deploy`). Nunca acepte el reset en un ambiente con datos.

## La prueba de humo devuelve 401

Ya no puede pasar por credenciales de ejemplo: `scripts/smoke.mjs` lee `.env` y **aborta** si
falta una clave, en vez de intentar con un valor inventado. Si devuelve 401, la clave del
`.env` no coincide con la que el proceso en marcha cargó al arrancar.

## Jest no termina / deja conexiones abiertas

Causa comprobada: cualquier suite que arranca `AppModule` ejecuta `ConfigModule.forRoot()`, que
carga `.env` en `process.env` para **el resto del proceso** de Jest. Una suite posterior que
construya `new ConfigService({...})` hereda ese `REDIS_URL` y abre un socket real. Fíjelo
explícitamente en la configuración de esa suite (la configuración interna gana sobre
`process.env`).

## El sidecar de scripts responde 503

`SCRIPT_RUNNER_BUSY` es admisión, no avería: el sidecar rechaza en vez de encolar sin cota.
Ver el [runbook de campos calculados](../runbooks/CAMPOS_CALCULADOS.md).

# Base de datos

## Dos conexiones, dos roles

Esto no es un detalle de configuración: es el control que hace efectivo el aislamiento por
tenant.

| Conexión | Rol | Para qué | Por qué separada |
| --- | --- | --- | --- |
| `DATABASE_URL` | `atlas_app` (no superusuario) | Todo el tráfico de la aplicación | **RLS es inerte para un superusuario.** Con el rol elevado, las políticas por tenant no se aplican y el aislamiento sería ficticio |
| `ADMIN_DATABASE_URL` | rol elevado | `prisma migrate deploy`, `set-app-db-role.mjs` | Las migraciones crean roles, políticas y revocan permisos; el rol de aplicación no puede hacerlo |

```bash
# Una vez por ambiente, con el rol elevado:
ADMIN_DATABASE_URL=postgresql://atlas:...@host/db \
APP_DB_PASSWORD=<secreto-16+-caracteres> \
node scripts/set-app-db-role.mjs
```

La contraseña del rol de aplicación **no vive en ninguna migración**: se aplica desde la
variable de entorno, para que no entre en el historial de git.

## Separar además lectura de escritura (opcional)

`atlas_app` puede escribir en todo, así que una consulta de un panel llega a la base con el
mismo privilegio que una escritura de decisión. Para separarlas hacen falta dos roles más,
que se aprovisionan de forma idempotente:

```bash
# Requiere POSTGRES_WRITER_PASSWORD y POSTGRES_READER_PASSWORD en .env
yarn db:provision:dev
```

Es reejecutable: no duplica roles, reafirma los atributos (deshace un `SUPERUSER` concedido
a mano) y **verifica el resultado preguntando al motor**, no dando por hecho que el `GRANT`
surtió efecto. Se niega a correr con `NODE_ENV=production`.

Después basta con declarar la conexión de lectura y encender el interruptor:

```env
DATABASE_READ_URL=postgresql://atlas_reader:<secreto>@localhost:5432/atlas_decision?schema=public
DATA_READ_ROUTING_ENABLED=true
```

Con ambas vacías el comportamiento es el de siempre: una sola conexión y un solo pool. El
manual completo, con los seis escenarios soportados, está en
[enrutamiento de lectura y escritura](../data/persistence/read-write-routing.md); los
privilegios exactos de cada rol, en
[roles y privilegios PostgreSQL](../data/persistence/postgres-roles.md).

## Migraciones

```bash
yarn prisma:validate     # el esquema es coherente
yarn prisma:migrate      # migrate deploy: aplica lo pendiente, no genera nada
yarn migration:validate  # validador propio del repositorio (Python)
```

!!! warning "`prisma migrate dev` no se usa aquí"
    Pide un `reset` porque el historial tiene migraciones registradas como revertidas con
    checksums antiguos, aunque el historial esté sano. Las migraciones se **escriben a mano**
    y se aplican con `migrate deploy`. Ver [migraciones](../data/migrations.md).

## Semillas

La siembra de arranque es idempotente y está protegida por un bloqueo consultivo de Postgres,
así que N réplicas pueden arrancar a la vez sin duplicar nada.

| Conjunto | Cuándo | Qué siembra |
| --- | --- | --- |
| BOOTSTRAP | todos los ambientes | Ambientes, catálogo de variables, códigos de razón, clientes de integración |
| MOCKUP | solo `NODE_ENV=development` | Artefacto de demostración BNPL completo |

Se controla con `STARTUP_SEED_ENABLED`. Ver [semillas](../data/seeds.md).

## Verificación

```bash
psql "$DATABASE_URL" -c "select current_user;"        # atlas_app
psql "$DATABASE_URL" -c "select count(*) from decision_variable;"
```

Si `current_user` devuelve el rol elevado, **el aislamiento por tenant no está activo**.

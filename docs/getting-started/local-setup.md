# Entorno local

## 1. Configuración

```bash
cp .env.example .env
```

`.env` es la **única** fuente de configuración local: ni el código ni `docker-compose.yml`
llevan credenciales por defecto. Compose declara sus secretos con `${VAR:?...}`, así que un
valor ausente detiene el arranque con un mensaje claro en vez de levantar el stack con una
contraseña de ejemplo.

Como mínimo hay que dar valor a:

| Variable | Nota |
| --- | --- |
| `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` | Los usa Compose; `APP_DB_PASSWORD` solo admite `[A-Za-z0-9_.~-]` y 16+ caracteres |
| `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY` | 24+ caracteres y **distintas entre sí** |
| `AUDIT_HASH_SECRET` | 32+ caracteres |
| `METRICS_TOKEN` | 24+ caracteres |

El catálogo completo está en [variables de entorno](environment-variables.md), generado del
esquema de validación.

## 2. Levantar la infraestructura

```bash
docker compose up -d postgres redis
```

## 3. Instalar y preparar

```bash
yarn install --frozen-lockfile
yarn prisma:generate
yarn prisma:migrate          # requiere ADMIN_DATABASE_URL (rol elevado)
node scripts/set-app-db-role.mjs   # da contraseña al rol no superusuario atlas_app
```

!!! danger "El runtime NO se conecta como superusuario"
    Las políticas RLS por tenant son **inertes** para una conexión de superusuario. `DATABASE_URL`
    debe apuntar a `atlas_app`; `ADMIN_DATABASE_URL` (rol elevado) se usa solo para migraciones
    y para el script anterior. Ver [aislamiento por tenant](../security/tenant-isolation.md).

## 4. Ejecutar

=== "Todo en un proceso"

    ```bash
    WORKER_ROLE=ALL yarn start:dev
    ```

=== "Separando API y trabajos de fondo"

    ```bash
    WORKER_ROLE=API    node dist/main.js     # solo decisiones
    WORKER_ROLE=WORKER node dist/worker.js   # relay, pruebas, purga
    ```

=== "Todo el stack en contenedores"

    ```bash
    docker compose up -d          # postgres, redis, migrate, worker, script-runner, api
    docker compose up --scale worker=3 -d
    ```

Ver [procesamiento en segundo plano](../architecture/background-processing.md) para elegir el
reparto.

## 5. Comprobar

```bash
curl localhost:3000/health/live     # {"status":"ok","role":"...","version":"..."}
curl localhost:3000/health/ready    # {"status":"ready","checks":{...}}
yarn smoke                          # prueba de humo con las credenciales del .env
```

La referencia interactiva de la API queda en `http://localhost:3000/docs/v1/reference`
(requiere `SWAGGER_ENABLED=true`, que el esquema prohíbe en producción).

## 6. Portal de documentación

```bash
yarn docs:serve    # http://localhost:8000
```

Si algo falla, siga [diagnóstico de problemas](troubleshooting.md).

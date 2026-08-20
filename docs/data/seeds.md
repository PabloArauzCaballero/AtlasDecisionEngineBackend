# Semillas

## Dos conjuntos con propósitos distintos

| Conjunto | Cuándo corre | Qué siembra |
| --- | --- | --- |
| **BOOTSTRAP** | Todos los ambientes, siempre | Ambientes, catálogo completo de variables, códigos de razón, clientes de integración, librerías aprobadas, campos calculados y el catálogo semántico |
| **MOCKUP** | Solo donde se pide | Artefactos de demostración completos —grafo, snapshot compilado, suite de regresión, escenarios de gobierno— y sus **despliegues ACTIVOS**, uno de ellos en PROD |

Separarlos no es cosmético: sin BOOTSTRAP una instalación nueva no tiene ni ambientes ni
llamantes registrados y **no puede operar**. MOCKUP, en cambio, son datos de ejemplo que en
producción serían basura —y basura con aspecto de política aprobada y desplegada.

## Quién decide si va el MOCKUP

Una sola función: `src/modules/seeding/mockup-policy.ts`. La usan las dos entradas —el Job
(`prisma db seed`) y la siembra de arranque (`SeedingService`)— porque decidían distinto y
la misma base podía recibir una cosa u otra según quién sembrara.

1. `SEED_INCLUDE_MOCKUP` si está declarada (`true/false`, `1/0`, `yes/no`). Un valor que no
   sea ninguno de ésos **falla**: degradarlo a `false` en silencio deja la base con
   catálogos y sin un solo artefacto ejecutable, y el motor responde «no active deployment»
   sin decir por qué.
2. Si no está declarada, `NODE_ENV === 'development'`.

**`NODE_ENV` no sirve como guarda de producción.** La imagen del migrador lo fija en
`production` —es la misma que se despliega—, así que también vale `production` en un
portátil. Por eso la guarda es explícita y visible en el compose: `docker-compose.prod.yml`
fija `SEED_INCLUDE_MOCKUP: "false"` en el Job `seed` y en el `worker` (el único proceso que
siembra al arrancar). Sin esa línea, la superposición **hereda** el `:-true` del fichero
base, que describe el portátil: la pila de producción sembraba el demo sobre la base real.

`test/seed-mockup-policy.spec.ts` fija la regla.

## Cómo corre

`SeedingService` se ejecuta en `OnApplicationBootstrap`, antes de servir tráfico, protegido por
un **bloqueo consultivo de PostgreSQL**: N réplicas pueden arrancar a la vez y solo una siembra.
Todo es idempotente; un segundo arranque registra «Seed already present».

`STARTUP_SEED_ENABLED` fuerza el comportamiento; sin declarar está activo en todas partes
excepto en `NODE_ENV=test`, donde cada suite provisiona sus propios datos.

## A qué tenant va

A uno solo, el que resuelve `resolveBootstrapTenantId()` (`seeding/data/helpers.ts`):
`BOOTSTRAP_TENANT_ID`, o `SEED_TENANT_ID` como sinónimo, o `1` si no hay ninguna. Un valor
que no sea un entero >= 1 **falla**, en vez de caer al 1 en silencio.

Había tres respuestas conviviendo: `BOOTSTRAP_TENANT_ID` lo leían sólo los clientes de
integración, los guiones de `prisma/` leían `SEED_TENANT_ID`, y el catálogo entero iba a un
`1n` fijo —con una segunda copia de la constante en el catálogo semántico—. Con
`BOOTSTRAP_TENANT_ID=7`, una instalación nueva quedaba con la API key habilitada para el
tenant 7 y las variables, motivos, librerías y campos calculados en el 1: el único llamante
registrado no veía nada y el motor rechazaba toda decisión por variable inexistente.

`test/seed-tenant-resolution.spec.ts` fija la regla.

## Dónde corre en un despliegue

| Despliegue | Quién siembra |
| --- | --- |
| Docker Compose | El servicio `seed` (un disparo), tras `migrate` |
| Kubernetes | El Job `migration-job.yaml`: `migrate` como initContainer y `seed` como container, en ese orden |
| Arranque de la aplicación | `SeedingService`, sólo donde corren los trabajos de fondo (`WORKER_ROLE` ∈ ALL, WORKER). Es la **red de seguridad**, no la fuente de verdad |

El Job de Kubernetes corría sólo `migrate deploy` aunque esta página y `.env.example` ya lo
nombraban como fuente de verdad: en la práctica el catálogo mínimo dependía de la red de
seguridad, y un worker con `STARTUP_SEED_ENABLED=false` dejaba la instalación sin operar.
Son initContainer y container, y no dos containers, porque los containers de un Pod arrancan
a la vez: sembrar en paralelo a la migración corre contra un esquema a medio migrar.

## Clientes de integración

La identidad de un llamante por API key vive en la base de datos, así que sin esta siembra una
instalación con API keys no tiene ningún llamante registrado.

- El secreto se toma de `MANAGEMENT_API_KEY` / `RUNTIME_API_KEY` y se guarda **hasheado**.
- Los roles salen de `BOOTSTRAP_MANAGEMENT_ROLES` / `BOOTSTRAP_RUNTIME_ROLES`, nunca de la petición.
- **Rotar el secreto invalida el anterior**: la siembra borra las credenciales previas del cliente.
- Al cliente de gestión se le conceden explícitamente todos los roles de plataforma, porque `PLATFORM_ADMIN` como comodín **no** se honra en una API key.

## Escenarios de gobierno

MOCKUP siembra cuatro escenarios; tres de ellos son **rechazos**, así que lo que se siembra es
el escenario que los provoca:

| Escenario | Rechazo demostrado |
| --- | --- |
| Ciclo detectado | `CIRCULAR_ARTIFACT_REFERENCE` |
| Versión no disponible | `CHILD_VERSION_NOT_COMPILED` |
| Contrato incompatible | `VARIABLE_CONTRACT_INCOMPATIBLE` |
| Caso de QA | Corrida archivada con contraejemplo mínimo y semilla |

El hijo del ciclo tiene una **segunda versión en borrador**: solo un borrador es editable y, sin
ella, el escenario fallaba por `VERSION_IMMUTABLE` sin llegar a ejercitar el ciclo.

## Ejecutar a mano

```bash
yarn prisma:seed                                   # mismo runSeeds que el arranque
SEED_INCLUDE_MOCKUP=false yarn prisma:seed         # sólo el catálogo base
NODE_ENV=test STARTUP_SEED_ENABLED=true node dist/main.js   # bootstrap sí, mockup no
```

## Verificar

```sql
select count(*) from decision_variable;         -- catálogo sembrado
select count(*) from integration_client;        -- llamantes registrados
select code from decision_environment;          -- DEV, STAGING, TEST, PROD
```

Un arranque sano registra algo como: `Startup seeding complete: 279 variables, 95 reason
codes, 2 integration client(s); mockup applied`.

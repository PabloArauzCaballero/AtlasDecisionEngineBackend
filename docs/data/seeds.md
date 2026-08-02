# Semillas

## Dos conjuntos con propósitos distintos

| Conjunto | Cuándo corre | Qué siembra |
| --- | --- | --- |
| **BOOTSTRAP** | Todos los ambientes | Ambientes, catálogo completo de variables, códigos de razón, clientes de integración |
| **MOCKUP** | Solo `NODE_ENV=development` | Artefacto de demostración BNPL completo, con grafo, snapshot compilado, suite de regresión y escenarios de gobierno |

Separarlos no es cosmético: sin BOOTSTRAP una instalación nueva no tiene ni ambientes ni
llamantes registrados y **no puede operar**. MOCKUP, en cambio, son datos de ejemplo que en
producción serían basura.

## Cómo corre

`SeedingService` se ejecuta en `OnApplicationBootstrap`, antes de servir tráfico, protegido por
un **bloqueo consultivo de PostgreSQL**: N réplicas pueden arrancar a la vez y solo una siembra.
Todo es idempotente; un segundo arranque registra «Seed already present».

`STARTUP_SEED_ENABLED` fuerza el comportamiento; sin declarar está activo en todas partes
excepto en `NODE_ENV=test`, donde cada suite provisiona sus propios datos.

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
yarn prisma:seed                  # mismo runSeeds que el arranque
NODE_ENV=test STARTUP_SEED_ENABLED=true node dist/main.js   # bootstrap sí, mockup no
```

## Verificar

```sql
select count(*) from decision_variable;         -- catálogo sembrado
select count(*) from integration_client;        -- llamantes registrados
select code from decision_environment;          -- SANDBOX, TEST, PROD...
```

Un arranque sano registra algo como: `Startup seeding complete: 279 variables, 95 reason
codes, 2 integration client(s); mockup applied`.

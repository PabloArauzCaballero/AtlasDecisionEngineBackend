# ADR-0029 — Superficie de persistencia desacoplada con rutas de lectura y escritura separadas

- **Estado:** Aceptada
- **Fecha:** 2026-08-06
- **Contexto de la decisión:** auditoría de acoplamiento a la persistencia y preparación
  para réplicas de lectura, credenciales separadas y persistencia políglota.
- **Reemplaza a:** nada. Formaliza y extiende lo que ya hacía `PrismaService`, que era el
  único punto de acceso a datos del sistema.

## Contexto

Antes de este cambio, la totalidad del acceso a datos pasaba por una sola clase:

| Pieza | Dónde vivía |
| --- | --- |
| Cliente único de Prisma | `src/common/prisma/prisma.service.ts` |
| Pool `pg` | creado dentro de ese mismo constructor |
| Consumidores directos | 52 archivos de `src/` inyectando `PrismaService` |
| Aislamiento por tenant | proxy de RLS dentro de la misma clase |
| Rol de base de datos | uno solo (`atlas_app`) para toda operación |

El diseño funcionaba y era coherente, pero fijaba tres cosas que el producto ya no puede
dar por fijas:

1. **Una sola conexión.** No había forma de servir consultas desde una réplica, ni de usar
   credenciales distintas para leer y escribir, sin tocar cada consumidor.
2. **Un solo rol.** `atlas_app` puede escribir en todo. Una consulta de un panel y una
   escritura de una decisión llegan a la base con el mismo privilegio, así que un error de
   enrutamiento o una inyección en el camino de lectura tiene poder de escritura.
3. **Un solo motor.** El dominio nombraba tipos de Prisma directamente, así que sustituir o
   complementar PostgreSQL —un índice de búsqueda para los listados de auditoría, por
   ejemplo— obligaba a cambiar servicios de negocio.

La pregunta no era «¿funciona PostgreSQL?» sino «¿puede este backend crecer sin reescribir
sus casos de uso cuando cambie la topología de datos?».

## Fuerzas y restricciones

- **Compatibilidad.** Hay 52 archivos usando `PrismaService` y una batería de pruebas que
  los cubre. Una migración de golpe habría sido una reescritura con la evidencia apagada.
- **RLS por tenant.** El aislamiento depende de fijar `app.tenant_id` en cada consulta y de
  conectar con un rol NO superusuario. Toda ruta nueva debe conservar esa propiedad.
- **Cadena de auditoría append-only.** Ningún rol de aplicación puede modificarla.
- **Stack fijo** (regla `70-library-selection`): NestJS 11, Prisma 6, PostgreSQL, Redis.
  Nada de esto justifica una dependencia nueva.
- **Sin transacciones distribuidas.** Ningún motor de la tabla de capacidades las ofrece, y
  simularlas sería peor que no tenerlas.

## Opciones consideradas

| Opción | Por qué no |
| --- | --- |
| Dejarlo como está | No resuelve ninguna de las tres restricciones y las hace más caras cada trimestre |
| Repositorio genérico único para todo el dominio | Un `Repository<T>` universal reproduce el acoplamiento con otro nombre: acaba exponiendo el `where` del ORM |
| Reescribir a hexagonal completo de una vez | 52 puntos de acceso migrados a la vez, sin poder comparar comportamiento, con la suite en rojo durante días |
| Segundo `PrismaService` copiado para lectura | Duplica el proxy de RLS: dos definiciones de «consulta acotada al tenant» que se separan con el tiempo |
| **Superficie de persistencia + migración progresiva** | La elegida |

## Decisión

**PostgreSQL sigue siendo el motor predeterminado** —no hay instrucción en contra, ni
decisión documentada distinta, ni restricción técnica que lo impida— y se implementan un
adaptador de lectura y otro de escritura sobre él.

Se introduce una superficie de persistencia en `src/common/persistence/`:

- **Puertos** sin infraestructura (`ports/`): vocabulario de motores, roles, consistencia,
  contratos de repositorio y capacidades por motor.
- **Registro de conexiones** (`connections/`): dueño de los pools, de las huellas saneadas
  y del ciclo de vida. Decide si dos rutas comparten pool comparando huellas.
- **Router declarativo** (`routing/`): traduce «módulo + operación + consistencia» a una
  conexión, y **falla al arrancar** ante una regla imposible.
- **Fábrica de adaptadores** (`factory/`): valida motor y capacidades al construir el
  adaptador, no en la primera petición.
- **Errores normalizados** (`errors/`): SQLSTATE y códigos de Prisma traducidos a una
  jerarquía tipada; el mensaje del driver nunca sube.

`PrismaService` **conserva su nombre y su superficie** y pasa a ser el cliente de la ruta de
escritura; se añade `PrismaReadService` para la de lectura, que rechaza toda operación de
escritura antes de llegar a la base. Los dos comparten `applyTenantRls`, así que solo existe
una definición de «consulta acotada al tenant».

En desarrollo y pruebas se aprovisionan **dos roles PostgreSQL independientes** —
`atlas_writer` y `atlas_reader`— de forma idempotente y con mínimo privilegio.

La migración es **progresiva**: `audit-query` es el módulo piloto y ya no conoce Prisma; el
resto sigue con `PrismaService` sin ningún cambio.

## Consecuencias positivas

- Lectura y escritura pueden compartir conexión, usar dos roles contra el mismo servidor,
  usar primario y réplica, dos proveedores o dos motores — sin tocar un caso de uso.
- El rol lector **no puede escribir**, y hay pruebas que lo ejecutan de verdad contra la
  base en vez de inspeccionar `GRANT`.
- Una configuración de datos imposible impide arrancar, con un mensaje que nombra el módulo
  y la capacidad y no imprime ningún secreto.
- El fallback a primario existe, es configurable y **nunca es silencioso**.
- `/health/data-sources` publica el estado de cada conexión y las reglas vigentes.

## Consecuencias negativas

- Hay dos clientes de Prisma en memoria cuando lectura y escritura comparten pool. Cuesta
  memoria de proceso, no conexiones; se aceptó a cambio de que la guardia de solo lectura
  sea real y comprobable en los dos escenarios.
- El sistema tiene más piezas: registro, router, fábrica. La deuda que compensan es peor.
- 30 módulos siguen usando `PrismaService` directamente. Es deliberado —expand and
  contract— pero es deuda declarada, con plan en
  [plan de migración](../data/persistence/migration-plan.md).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Una lectura «eventual» sirve datos viejos donde no debe | `runtime` y `governance` están anclados al primario por regla base; `read-after-write` siempre sube |
| Una réplica retrasada sirve una lectura declarada fuerte | El router distingue réplica (otro servidor) de segundo rol (mismo servidor) y sube la primera al primario |
| El interruptor queda encendido con la réplica caída | `ENABLE_PRIMARY_READ_FALLBACK` sirve desde el primario y lo declara en log y métrica |
| Un rol nuevo hereda privilegios de más | El aprovisionamiento reafirma atributos en cada corrida y verifica el resultado preguntando al motor |

## Evidencia

Ejecutada el 2026-08-06 contra PostgreSQL 16 real (ver
[pruebas y evidencia](../data/persistence/testing-and-evidence.md)):

- `yarn db:provision:dev` — 76 tablas, `atlas_writer` SELECT 76 / INSERT 76,
  `atlas_reader` SELECT 76 / escritura 0, verificación de mínimo privilegio superada.
  Reejecutado tres veces sin duplicar ni acumular.
- `test/postgres-role-privileges.integration.spec.ts` — 10/10. El lector recibe `42501` en
  INSERT, UPDATE, DELETE, TRUNCATE y CREATE; ninguno de los dos roles es superusuario ni
  puede saltarse la RLS.
- `test/decision-audit-read-port.contract.spec.ts` — la misma suite de contrato superada
  por la implementación PostgreSQL y por una en memoria.

## Plan de revisión

Se revisa cuando ocurra cualquiera de estas tres cosas: que se despliegue una réplica de
lectura real y `atlas_database_fallback_total` deje de ser cero; que un módulo necesite un
motor distinto de PostgreSQL; o que el número de módulos que aún inyectan `PrismaService`
directamente deje de bajar durante dos trimestres seguidos.

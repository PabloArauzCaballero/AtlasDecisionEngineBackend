# Semillas del motor

## Dónde viven los datos de semilla

**Fuera del repositorio.** El catálogo —variables, códigos de motivo, librerías aprobadas, campos
calculados, categorías semánticas, entidades financieras— y el artefacto de demostración con su
despliegue activo se publican en una **rama** de PostgreSQL gestionado, y se traen con un comando:

```bash
yarn prisma:migrate   # el esquema lo siguen definiendo las migraciones versionadas
yarn prisma:seed      # los datos los trae la rama
```

Antes eran ~800 KB de TypeScript bajo `src/modules/seeding/data/`: 44 archivos que `runSeeds`
recorría haciendo upserts en cada arranque. Escribir catálogos como código tiene un coste que no se
ve hasta que se mira: cada cambio de un umbral era un commit de código, cada revisión de PR era
leer literales, y el conjunto se recorría entero en cada arranque de cada réplica de worker.

## La rama es el perfil

Ya no existe `SEED_INCLUDE_MOCKUP`. Lo que antes decidía una variable —¿entra el artefacto de
demostración?— ahora lo decide **a qué rama se apunta**:

| Rama       | Qué publica                                                                     |
| ---------- | ------------------------------------------------------------------------------- |
| desarrollo | Catálogo base **más** el artefacto de demostración con despliegues activos.      |
| producción | Sólo el catálogo base.                                                           |

La diferencia no es cosmética. `SEED_INCLUDE_MOCKUP` nunca fue una guarda fiable: se deducía de
`NODE_ENV`, y la imagen del migrador fija `NODE_ENV=production` también en un portátil, así que
había que declararla explícitamente en `docker-compose.prod.yml`, en `compose.resilience.yml` y en
el Job de Kubernetes —tres sitios donde acordarse—. A la rama de producción, en cambio, **no se le
puede pedir** un artefacto de demostración: no lo tiene.

## Configuración

Dos formas, en este orden de precedencia (ver `src/common/seeding/seed-source.ts`):

1. `SEED_SOURCE_DATABASE_URL` — cadena completa. Gana sobre todo lo demás.
2. `SEED_SOURCE_HOST` + `SEED_SOURCE_DB` + `SEED_SOURCE_USER` + `SEED_SOURCE_PASSWORD` — la vía
   cómoda cuando **sólo cambia la rama**.

## Lo que NO viene de la rama

**Las credenciales de integración.** `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `APPROVER_QA_API_KEY`,
`APPROVER_RISK_API_KEY`, `APPROVER_COMPLIANCE_API_KEY` y `RELEASE_MANAGER_API_KEY` son secretos
**del entorno**: copiarlas de una rama significaría instalar en producción la credencial de
desarrollo de quien capturó la instantánea. Se registran aparte
(`src/common/seeding/seed-local-clients.ts`), leyendo el entorno de esta instalación, y se aplican
**siempre** —no sólo con la base vacía— porque rotar una clave tiene que poder hacerse sin volver a
sembrar. Sigue valiendo la regla de antes: cada cliente existe sólo si su variable está definida.

**El secreto de auditoría.** La cadena que trae la rama viene firmada con el HMAC de la instalación
que capturó la instantánea, así que `AUDIT_HASH_SECRET` y `AUDIT_HASH_KEY_ID` tienen que ser los
mismos que reciben `api` y `worker`. Una cadena firmada con otro secreto verifica como manipulada, y
un sujeto seudonimizado con otro secreto no lo encuentra nunca la pantalla de solicitudes de titular
— las siete pantallas de auditoría quedan vacías o en rojo, que es el estado que no se distingue de
un motor apagado.

## Cómo carga

Dentro de **una transacción**: retira las claves foráneas, apaga los disparadores de usuario, vacía
las tablas del manifiesto, copia y lo restituye todo. Tres detalles que no son opcionales:

- **Recrear las restricciones es lo que valida el resultado.** Una fila huérfana aborta el `ALTER` y
  revierte la carga completa, así que la base nunca queda a medias ni sin restricciones.
- **Los disparadores se apagan** porque `decision_audit_event` es append-only y rechaza `TRUNCATE`,
  y porque un `BEFORE INSERT` que recalcule hashes reescribiría filas que ya vienen calculadas.
- **Los valores viajan como texto** (`col::text` al leer, `$n::tipo` al escribir): la representación
  textual de PostgreSQL es la inversa de su entrada, así que el copiado no depende de cómo el driver
  traduzca cada tipo a JavaScript.

## Al arrancar

`STARTUP_SEED_ENABLED=true` trae las semillas **sólo si la base está vacía**. `runSeeds` era
idempotente por construcción —todo eran upserts—, así que correrlo en cada arranque no destruía
nada; la copia, en cambio, es un reemplazo. Reiniciar un proceso no puede ser la forma de perder el
trabajo de la sesión anterior, así que ahora la salvaguarda es explícita. Para rehacerla a propósito
está `yarn prisma:seed`.

Sigue siendo trabajo de fondo: sólo corre donde `WORKER_ROLE` ∈ `ALL`, `WORKER`. Una réplica de API
nunca siembra, aunque la variable esté en `true`.

## Publicar una instantánea nueva

Cuando cambie el catálogo, se actualiza **la rama**, no el repositorio: base limpia, migraciones,
cargar los datos por el medio que corresponda, y empujar esa base a la rama con la misma lógica de
copia en sentido inverso. La rama lleva un esquema `atlas_seed` con `manifest` (tablas y filas) y
`snapshot` (fecha, backend y `git sha` con el que se capturó).

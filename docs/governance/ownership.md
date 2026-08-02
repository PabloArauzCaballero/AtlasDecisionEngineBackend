# Propiedad

## Por área

!!! note "Propiedad funcional, no nominal"
    Este documento fija **qué** hay que poseer y **qué función** responde por ello, usando la
    misma taxonomía de roles que ya gobierna el acceso al sistema (`PlatformRole`, ver
    `src/common/security/platform-roles.ts`). No asigna una persona concreta: un nombre propio
    sin que esa persona lo haya aceptado sería un propietario ficticio, y eso es peor que no
    tener ninguno. Cuando el equipo cree cuentas de GitHub para estas funciones, `CODEOWNERS`
    solo necesita sustituir el `@PabloArauzCaballero` de reserva por el equipo correspondiente
    — la tabla de abajo ya dice cuál va en cada fila; ver la cabecera de `.github/CODEOWNERS`.

| Área | Alcance | Función propietaria | Equipo GitHub (a crear) |
| --- | --- | --- | --- |
| Motor de decisión | `graph/`, `runtime/`, `nested-trees/` | Ingeniería — motor de decisión | `ingenieria-motor` |
| Contratos y variables | `variables/`, `common/contracts/` | Riesgo/Cumplimiento + Ingeniería | `riesgo-cumplimiento` |
| Gobierno y despliegues | `governance/`, `deployments/` | Riesgo/Cumplimiento | `riesgo-cumplimiento` |
| Campos calculados y librerías | `calculated-fields/`, `libraries/` | Ingeniería — motor de decisión | `ingenieria-motor` |
| Pruebas y QA Lab | `testing/`, `qa-lab/` | QA | `qa` |
| Seguridad y auditoría | `common/security/`, `common/audit/`, `audit-query/` | Seguridad | `seguridad` |
| Plataforma y operación | Docker, Kubernetes, CI/CD, observabilidad | Plataforma | `plataforma` |
| Datos y migraciones | `prisma/`, `common/prisma/` | Plataforma + Ingeniería | `plataforma` |
| Documentación | `docs/`, generadores | Plataforma | `plataforma` |

Hasta que existan esos equipos en la organización de GitHub, `.github/CODEOWNERS` asigna cada
regla al propietario real del repositorio (`@PabloArauzCaballero`) como reserva, para que la
revisión obligatoria de las áreas críticas ya sea efectiva hoy y no dependa de una
administración de GitHub pendiente.

## Áreas críticas

Cambios aquí exigen revisión del propietario del área **y** de seguridad:

- `common/security/` — autenticación, roles, límites
- `common/audit/` y las migraciones de auditoría — evidencia regulatoria
- `graph/script-node-runner.service.ts` y `runner/server.mjs` — ejecución de código no confiable
- Migraciones de RLS
- `common/config/env.schema.ts` — un valor por defecto equivocado se despliega en todas partes

Conviene declararlas en `CODEOWNERS` para que la revisión sea automática y no dependa de que
alguien se acuerde.

## Propiedad de los datos

| Dato | Quién responde de su calidad |
| --- | --- |
| Variable del catálogo | El equipo declarado en `ownerTeam` |
| Artefacto de decisión | El equipo declarado en su propiedad |
| Códigos de razón | Riesgo y cumplimiento conjuntamente — el mensaje público tiene efecto regulatorio |
| Clientes de integración | Plataforma, con aprobación de seguridad |

## Guardia

| Responsabilidad | Rol |
| --- | --- |
| Alertas críticas | Guardia de plataforma |
| Incidentes de integridad de auditoría | Plataforma + cumplimiento |
| Divergencia DEV/PROD en un artefacto | Propietario del artefacto |
| Eventos en cola muerta | Guardia de plataforma |

## Al transferir la propiedad de un área

1. Actualizar esta tabla y `CODEOWNERS`.
2. Recorrer con el nuevo propietario los ADR y las decisiones documentadas del área.
3. Ejecutar juntos los runbooks que le corresponden — leerlos no basta.
4. Transferir los accesos y revocar los del anterior.

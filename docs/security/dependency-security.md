# Seguridad de dependencias

## Controles activos

| Control | Qué cubre | Dónde |
| --- | --- | --- |
| `yarn audit --level high` | Vulnerabilidades conocidas en dependencias de producción | `yarn security:audit`, en CI |
| CodeQL (`security-and-quality`) | Análisis estático del código propio | `.github/workflows/security.yml`, semanal |
| Dependency review | Dependencias añadidas en un pull request | Solo en PR, falla en `high` |
| Trivy | Vulnerabilidades de la imagen (`HIGH`/`CRITICAL`) | CI |
| Lockfile fijado | Reproducibilidad de la instalación | `yarn.lock` + `--frozen-lockfile` |

## Política de dependencias

Antes de añadir una, hay que responder tres preguntas:

1. **¿El stack ya lo cubre?** Validación → `class-validator` + `zod`; HTTP/DI → NestJS; ORM → Prisma; caché/colas → `ioredis`; observabilidad → OpenTelemetry + `prom-client` + `pino`.
2. **¿Tiene una responsabilidad clara y sin solape?**
3. **¿Está mantenida y es revisable?**

Cada dependencia nueva se justifica en el pull request. No se mezclan gestores: **Yarn**, un
solo lockfile.

## Versiones mayores del núcleo

NestJS 11, Prisma 6 y TypeScript 5.8 están fijados y **no se suben sin autorización
explícita**. Una mayor cambia supuestos que este repositorio da por ciertos.

## Dependencias añadidas para la documentación

| Paquete | Ámbito | Justificación |
| --- | --- | --- |
| `@scalar/nestjs-api-reference` | producción | Sirve la referencia interactiva desde el propio backend. Solo se monta con `SWAGGER_ENABLED=true`, que el esquema **prohíbe en producción** |
| `@redocly/cli` | desarrollo | Gobierno del contrato en CI. No entra en la imagen |

## Superficie del sidecar de scripts

El contenedor que ejecuta código importado tiene **cero dependencias npm**: solo módulos del
núcleo de Node y el paquete mínimo `python3`. Es deliberado — es el contenedor que procesa la
entrada menos confiable del sistema, y cada dependencia allí sería superficie de ataque.

## Ante una vulnerabilidad publicada

1. Determinar si el camino vulnerable se **usa** realmente (una dependencia transitiva puede no ejercitarse).
2. Si hay parche, actualizar y ejecutar la suite completa.
3. Si no lo hay, evaluar mitigación por configuración o aislamiento.
4. Registrar la decisión: aceptar un riesgo sin dejar constancia es lo mismo que no haberlo evaluado.

## Verificación

```bash
yarn security:audit
docker build -t atlas-decision:local . && trivy image atlas-decision:local
```

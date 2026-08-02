# Requisitos previos

## Lo que hace falta

| Herramienta | Versión | Por qué esa |
| --- | --- | --- |
| Node.js | 22 (`.nvmrc`) | La imagen de producción es `node:22-bookworm-slim`; desarrollar en otra mayor esconde diferencias de runtime hasta el despliegue |
| Yarn | 1.x (`yarn.lock`) | Gestor único del proyecto. Mezclar `npm install` reescribe el lockfile y rompe `--frozen-lockfile` en CI |
| Docker + Compose | reciente | Postgres, Redis, el sidecar de scripts y el portal de documentación corren en contenedor |
| Python | 3.x | Solo para `yarn migration:validate` y el analizador de sintaxis de importación de código |

!!! warning "No cambie versiones mayores del núcleo"
    NestJS 11, Prisma 6 y TypeScript 5.8 están fijados. Subir una mayor sin autorización
    explícita rompe supuestos de este repositorio (ver `.claude/rules/70-library-selection.md`).

## Verificación rápida

```bash
node --version    # v22.x
yarn --version    # 1.22.x
docker --version
python --version
```

## Servicios externos

| Servicio | Obligatorio | Sin él |
| --- | --- | --- |
| PostgreSQL | **sí** | El arranque falla: la conexión se abre al inicializar el módulo |
| Redis | en producción sí | Fuera de producción cae a una caché en memoria; en producción el arranque se rechaza (`REQUIRE_REDIS_IN_PRODUCTION`) |
| Proveedor de identidad | solo con `AUTH_MODE=IDENTITY_*` | El portal no puede iniciar sesión; las integraciones por API key siguen funcionando |
| Colector OpenTelemetry | no | Sin él no se exportan trazas; nada más cambia (`OTEL_ENABLED=false` por defecto) |

Siguiente paso: [entorno local](local-setup.md).

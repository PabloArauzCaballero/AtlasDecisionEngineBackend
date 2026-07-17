# Despliegue

## Desarrollo local

Copie `.env.example` a `.env`. Para ejecutar sin un proveedor de identidad local, use:

```env
AUTH_MODE=API_KEY
```

Inicie las dependencias:

```bash
docker compose up -d postgres redis
```

Prepare la base y la aplicación:

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

El seed registra las claves bootstrap en el catálogo de clientes de integración. Si cambia `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY`, `BOOTSTRAP_TENANT_ID` o los scopes, vuelva a ejecutar el seed.

## Contenedores

La imagen ofrece targets separados:

```bash
docker build --target runtime -t atlas-decision-engine:2.0.0 .
docker build --target migrator -t atlas-decision-migrator:2.0.0 .
docker build --target script-runner -t atlas-decision-script-runner:2.0.0 .
```

La API runtime no contiene Prisma CLI y no ejecuta migraciones ni seeds durante el arranque.

El servicio `script-runner` de Compose usa `runtime: runsc`. Un host sin gVisor puede trabajar con la API local y `SCRIPT_NODES_ENABLED=false`; la ejecución de scripts no debe habilitarse en producción sin el aislamiento descrito en `CONFIGURABLE_OUTPUTS.md`.

## Producción

Orden recomendado:

1. Construir imágenes inmutables etiquetadas con versión y commit.
2. Ejecutar `prisma migrate deploy` con el target `migrator`.
3. Provisionar clientes técnicos mediante un proceso controlado si el modo híbrido los necesita.
4. Desplegar la API con `AUTH_MODE=JWT`, `HYBRID`, `IDENTITY_PROVIDER` o `IDENTITY_HYBRID`.
5. Verificar `/health/live`, `/health/ready`, métricas y smoke tests.
6. Habilitar tráfico gradualmente.

Requisitos:

- secretos desde un secret manager, nunca desde Git o ConfigMap;
- JWKS, IdP y proveedores externos por HTTPS;
- PostgreSQL y Redis privados con TLS, backups y monitoreo;
- al menos dos réplicas, PDB, anti-affinity, HPA y NetworkPolicy;
- `LOG_OUTPUT=stdout`, salvo que exista un volumen escribible administrado;
- Swagger deshabilitado y `LOG_LEVEL` distinto de debug/verbose.

Los manifiestos de `deploy/kubernetes` son referencias. Deben adaptarse a registry, ingress, TLS, secret manager, namespaces, límites de red y estándares de observabilidad de la plataforma.

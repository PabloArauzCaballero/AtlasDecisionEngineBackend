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
yarn install --frozen-lockfile
yarn prisma:generate
yarn prisma:migrate
yarn prisma:seed
yarn start:dev
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
2. Ejecutar `prisma migrate deploy` con el target `migrator`, conectado con un rol
   administrador/superusuario (`ADMIN_DATABASE_URL` o el `DATABASE_URL` de ese Job).
3. Ejecutar `node scripts/set-app-db-role.mjs` (target `migrator`, mismo rol admin) para fijar
   la contraseña del rol `atlas_app` desde el secret manager. **Obligatorio**: la política RLS
   por tenant (migración `20260719080000_tenant_rls_and_app_role`) queda inerte si la API se
   conecta como superusuario — un superusuario ignora RLS sin importar las políticas definidas.
4. Provisionar clientes técnicos mediante un proceso controlado si el modo híbrido los necesita.
5. Desplegar la API con `DATABASE_URL` apuntando a `atlas_app` (nunca al rol admin/`atlas`) y
   `AUTH_MODE=JWT`, `HYBRID`, `IDENTITY_PROVIDER` o `IDENTITY_HYBRID`.
6. Verificar `/health/live`, `/health/ready`, métricas y smoke tests.
7. Habilitar tráfico gradualmente.

Requisitos:

- secretos desde un secret manager, nunca desde Git o ConfigMap;
- **el `DATABASE_URL` de la API debe usar el rol `atlas_app`, no el rol admin usado por
  `migrate`/`seed`** — de lo contrario RLS no aplica y el aislamiento por tenant depende
  solo del código de aplicación;
- JWKS, IdP y proveedores externos por HTTPS;
- PostgreSQL y Redis privados con TLS, backups y monitoreo;
- al menos dos réplicas, PDB, anti-affinity, HPA y NetworkPolicy;
- `LOG_OUTPUT=stdout`, salvo que exista un volumen escribible administrado;
- Swagger deshabilitado y `LOG_LEVEL` distinto de debug/verbose.

Los manifiestos de `deploy/kubernetes` son referencias. Deben adaptarse a registry, ingress, TLS, secret manager, namespaces, límites de red y estándares de observabilidad de la plataforma.

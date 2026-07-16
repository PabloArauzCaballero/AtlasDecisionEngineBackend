# Despliegue

## Local

```bash
cp .env.example .env
docker compose up --build
# Seed opcional, nunca automático en producción:
docker compose --profile seed run --rm seed
```

## Producción

- Construir el target `runtime`.
- Ejecutar el target `migrator` como Job único antes del rollout.
- Proveer secretos desde un secret manager; no desde Git ni ConfigMap.
- Configurar `AUTH_MODE=JWT` o `HYBRID`, JWKS HTTPS, issuer y audiences.
- Ejecutar al menos dos réplicas, PDB, anti-affinity, HPA y NetworkPolicy.
- La base de datos y Redis deben ser servicios administrados con TLS, backups y monitoreo.

Los manifiestos en `deploy/kubernetes` son una base de referencia y requieren nombres de imágenes, hosts, secretos, límites y políticas de la infraestructura real.

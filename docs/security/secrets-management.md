# Gestión de secretos

## Regla

**Ningún secreto tiene valor por defecto en un fichero versionado.** Ni en el código, ni en
`docker-compose.yml`, ni en los scripts.

Esto no es una aspiración: se aplica y se comprueba.

| Antes | Ahora |
| --- | --- |
| `docker-compose.yml` con `${MANAGEMENT_API_KEY:-local-management-key-...}` | `${MANAGEMENT_API_KEY:?set MANAGEMENT_API_KEY in .env}` — sin valor, el stack no arranca |
| `scripts/smoke.mjs` con claves de ejemplo | Lee `.env` y **aborta** si falta una clave |
| Contraseña del rol de aplicación en una migración | Se aplica desde `APP_DB_PASSWORD` con `set-app-db-role.mjs` |

!!! example "Por qué importó"
    Las claves de ejemplo del script de humo **no coincidían** con las del `.env`. El script se
    autenticaba con un valor inventado, y un `401` habría parecido un defecto del producto. Una
    credencial por defecto no solo es insegura: engaña al diagnóstico.

## Inventario

| Secreto | Formato | Rotación |
| --- | --- | --- |
| `MANAGEMENT_API_KEY`, `RUNTIME_API_KEY` | ≥24 caracteres, **distintas entre sí** | Cambiar el valor y resembrar; la anterior queda invalidada |
| `AUDIT_HASH_SECRET` | ≥32 caracteres | Ver abajo — es la rotación delicada |
| `AUDIT_HASH_PREVIOUS_SECRETS` | JSON `{keyId: secreto}` | Solo para **verificar** eventos históricos |
| `METRICS_TOKEN` | ≥24 caracteres | Libre |
| `APP_DB_PASSWORD` | ≥16, solo `[A-Za-z0-9_.~-]` | Con `set-app-db-role.mjs` |
| `POSTGRES_PASSWORD` | libre | Según la política del motor |

El juego de caracteres de `APP_DB_PASSWORD` está restringido porque se interpola en un
`ALTER ROLE`, que no admite parámetro enlazado.

## Rotar la clave de auditoría

!!! danger "Una rotación mal hecha deja la cadena inverificable"
    Los eventos ya escritos están firmados con el secreto anterior. Si desaparece, **no se
    pueden verificar**, aunque los datos estén intactos.

1. Mover el secreto actual a `AUDIT_HASH_PREVIOUS_SECRETS` bajo su `keyId`.
2. Poner el nuevo en `AUDIT_HASH_SECRET` y subir `AUDIT_HASH_KEY_ID`.
3. Desplegar.
4. Verificar: `GET /v1/audit/chain/verify` por tenant.

Cada evento guarda el `keyId` con el que se firmó, así que la verificación elige el secreto
correcto por evento. Los secretos retirados **nunca** firman: solo verifican.

## En producción

- Inyecte desde el gestor de secretos de la organización (`atlas-decision-secrets` en Kubernetes), nunca desde el ConfigMap.
- El ConfigMap solo lleva configuración **no sensible**.
- El esquema de entorno **rechaza el arranque** si detecta un valor de ejemplo en producción.

## Verificación

```bash
yarn production:config:check   # valida el entorno con el esquema real
yarn docs:openapi:check        # falla si el contrato publicado contiene algo con forma de secreto
```

Los registros redactan `apiKey`, `password`, `secret`, `token` y los contenedores donde suelen
viajar.

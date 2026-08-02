# Migraciones

## Cómo se aplican

```bash
yarn prisma:validate      # coherencia del esquema
yarn prisma:migrate       # migrate deploy: aplica lo pendiente
yarn migration:validate   # validador propio del repositorio
```

En despliegue, la migración corre como **Job separado** (`migrate` en Compose,
`migration-job.yaml` en Kubernetes) y debe completar **antes** de que arranque la aplicación.
Migrar desde el arranque de la API haría que N réplicas compitieran por el mismo bloqueo.

## `prisma migrate dev` no se usa

Pide un `reset` porque el historial tiene migraciones registradas como revertidas con
checksums antiguos, aunque el historial esté sano. Las migraciones se **escriben a mano** y se
aplican con `migrate deploy`.

!!! danger "Nunca acepte el reset en un ambiente con datos"
    `prisma migrate reset` borra el esquema. Sobre datos reales destruye evidencia que, por
    diseño, no se puede reconstruir.

## Rol necesario

`migrate deploy` **no** funciona con el rol de aplicación: crea roles, políticas y revoca
permisos. Use `ADMIN_DATABASE_URL` con el rol elevado. Ver
[base de datos](../getting-started/database-setup.md).

## Compatibilidad hacia atrás

El rollback de una imagen **no** revierte el esquema. Toda migración debe ser compatible con la
versión anterior de la aplicación, o el rollback dejará la aplicación antigua contra un esquema
que no entiende.

Para un cambio destructivo, patrón *expand/contract*:

1. **Expand** — añadir lo nuevo sin quitar lo viejo; ambas versiones funcionan.
2. Desplegar la aplicación que usa lo nuevo.
3. **Contract** — en una ventana posterior, retirar lo viejo.

## Migraciones con seguridad

Varias migraciones no cambian el modelo sino sus controles. Al tocarlas, entienda qué
protegen:

| Migración | Qué establece |
| --- | --- |
| `20260717070000_audit_append_only` | Disparadores y revocación de `UPDATE`/`DELETE` sobre la auditoría |
| `20260717061000_audit_hash_key_rotation` | Identificador de clave junto a cada evento, para rotar el secreto sin invalidar el historial |
| `20260719080000_tenant_rls_and_app_role` | Rol no superusuario y políticas RLS |
| `20260720030000_audit_event_tenant_keyset_index` | Índice `(tenant_id, id)` para el recorrido por cursor |

## Al escribir una migración

1. Añada la política RLS espejo si la tabla tiene `tenant_id`.
2. Cree índices para las consultas que realmente existen.
3. Compruébela con `yarn migration:validate`.
4. **Una migración por autor**: si dos líneas de trabajo tocan el esquema, la segunda relee el fichero antes de escribir; nunca se edita la migración de otro.

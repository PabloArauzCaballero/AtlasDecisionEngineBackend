# Aislamiento por tenant

## Tres capas independientes

| Capa | Qué impide | Si falla |
| --- | --- | --- |
| Tenants permitidos del cliente | Operar sobre un tenant no concedido | Lo detiene la capa 3 |
| `where tenantId` en las consultas | Leer filas ajenas | Lo detiene la capa 3 |
| **RLS en PostgreSQL** | Que cualquier consulta devuelva filas de otro tenant | Nada más lo detiene |

La tercera existe precisamente porque las dos primeras dependen de que ningún desarrollador
olvide una cláusula. RLS no se olvida.

## Cómo se activa

1. El runtime conecta como el rol **no superusuario** `atlas_app`.
2. El proxy de `PrismaService` fija el GUC `app.tenant_id` en la conexión antes de cada consulta.
3. Las políticas de cada tabla comparan su `tenant_id` con ese GUC.

!!! danger "RLS es inerte para un superusuario"
    Si `DATABASE_URL` apunta al rol elevado, **las políticas no se aplican** y el aislamiento es
    ficticio aunque todo el código las suponga activas. Compruébelo:

    ```sql
    select current_user;   -- debe ser atlas_app
    ```

    El rol elevado (`ADMIN_DATABASE_URL`) se usa **solo** para migraciones y para
    `set-app-db-role.mjs`.

## Contexto vacío

Una migración específica (`fix_rls_empty_context`) cubre el caso en que el GUC no está fijado.
Sin ella, una consulta sin contexto podía comportarse de forma inesperada. Con ella, la
ausencia de contexto **no** abre el acceso.

## Al crear una tabla nueva

Si tiene `tenant_id`, la migración debe incluir su política RLS **espejo** de la de referencia
(`20260719080000_tenant_rls_and_app_role`), con el mismo GUC. Una tabla con tenant y sin
política es un agujero que ninguna prueba de negocio detecta.

## Caché

Toda clave de caché lleva el tenant. Una clave sin tenant serviría el valor de un tenant a otro
sin tocar la base de datos, esquivando RLS por completo.

## Respuesta ante un recurso ajeno

`404`, no `403`. Un `403` confirmaría que el recurso existe, y esa confirmación ya es una fuga
entre tenants.

## Verificación

`test/tenant-rls-isolation.integration.spec.ts` y `tenant-rls-views.spec.ts` ejercitan las
políticas contra una base real, conectando como `atlas_app`.

!!! warning "Estas pruebas se auto-saltaban en silencio"
    Leían un `DATABASE_URL` indefinido porque Jest no cargaba `.env`, y `yarn test` salía verde
    **sin haber ejecutado nunca** los guardianes de aislamiento. Se corrigió con `setupFiles` en
    `jest.config.js`. Un «skipped» inesperado es una señal de fallo, no ruido.

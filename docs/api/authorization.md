# Autorización

## Dónde se decide

**En el servidor, siempre.** Cada ruta declara sus roles con `@Roles(...)` y `RolesGuard` los
aplica. Ocultar un botón en el portal no es un control de acceso; es una ayuda visual.

```ts
@Post('artifact-versions/:versionId/submit-for-review')
@Roles('RISK_ANALYST', 'FRAUD_ANALYST')
```

Los nombres de rol están tipados (`Roles(...roles: PlatformRole[])`): un error de escritura es
un fallo de compilación, no un paso de aprobación que nunca se puede satisfacer.

## Roles

Catálogo en [actores y roles](../business/actors-and-roles.md). Los roles exigidos por cada
módulo se generan del código en el [índice de módulos](../modules/index.md).

## El comodín y su límite

`PLATFORM_ADMIN` sustituye a cualquier rol exigido, **pero solo en identidades firmadas por el
proveedor de identidad**. Nunca en una API key.

!!! danger "Por qué esa distinción"
    Una API key es un secreto compartido que vive en la configuración de un sistema externo.
    Si el comodín se honrara en ella, filtrar esa clave equivaldría a filtrar la administración
    completa de la plataforma. Con identidad firmada hay un sujeto, una expiración y una
    autoridad emisora que puede revocarlo.

    Está cubierto por `test/api-key-privilege-escalation.spec.ts`.

## Tres capas independientes

| Capa | Qué impide | Dónde |
| --- | --- | --- |
| Rol de ruta | Que un analista despliegue, o que runtime administre | `RolesGuard` |
| Tenant permitido | Que un cliente opere sobre un tenant que no tiene concedido | Registro de integración |
| RLS en el motor | Que una consulta sin `where` de tenant devuelva filas ajenas | PostgreSQL |

Son independientes a propósito: la tercera protege incluso ante un error de programación en
las dos primeras.

## Segregación de funciones

Más allá del rol, el gobierno impone reglas sobre **quién** puede actuar:

- El autor de una versión no puede aprobarla.
- Los pasos de aprobación se resuelven en orden.
- Un mismo principal no vota dos veces el mismo paso.
- `minApprovals` por paso.

Cubierto por `governance-sod.integration.spec.ts` (20 pruebas, 100 % de sentencias del
servicio de gobierno).

## Recurso de otro tenant

Responde `404`, no `403`. Un `403` confirmaría que el recurso existe, y eso ya es una fuga de
información entre tenants.

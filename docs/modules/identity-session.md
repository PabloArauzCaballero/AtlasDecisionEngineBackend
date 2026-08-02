<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/identity-session/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `identity-session`


## Responsabilidad

Código: [`src/modules/identity-session/`](https://github.com/) · 8 ficheros TypeScript.

Etiquetas de API: **Portal Session**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `POST` | `/v1/session/login` | `identitySessionLogin` | Authenticate through the configured identity provider |
| `POST` | `/v1/session/logout` | `identitySessionLogout` | Revoke the provider session and clear the refresh cookie |
| `POST` | `/v1/session/refresh` | `identitySessionRefresh` | Rotate the provider session using the HttpOnly refresh cookie |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

- `RATE_LIMIT_EXCEEDED`
- `UNAUTHORIZED`
- `UNTRUSTED_ORIGIN`

## Clases exportadas

- `IdentityLoginDto`
- `IdentityLogoutDto`
- `IdentitySessionController`
- `IdentitySessionModule`
- `IdentitySessionService`
- `LogoutResultDto`
- `SessionCookieService`
- `SessionOriginService`
- `SessionRateLimitGuard`

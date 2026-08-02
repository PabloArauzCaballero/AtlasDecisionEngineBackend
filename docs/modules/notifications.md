<!-- GENERADO POR scripts/docs/generate-catalogs.mjs — NO EDITAR A MANO.
     Fuente: src/modules/notifications/. Ejecute `yarn docs:catalog` tras cambiar el código. -->

# Módulo `notifications`


## Responsabilidad

Código: [`src/modules/notifications/`](https://github.com/) · 6 ficheros TypeScript.

Etiquetas de API: **Notifications**.

## Endpoints

| Método | Ruta | Operación | Resumen |
| --- | --- | --- | --- |
| `GET` | `/v1/notifications` | `notificationList` | List notifications addressed to the caller or its roles |
| `POST` | `/v1/notifications/{id}/read` | `notificationMarkRead` | Mark one visible notification as read |
| `POST` | `/v1/notifications/read-all` | `notificationMarkAllRead` | Mark every visible notification as read |
| `GET` | `/v1/notifications/unread-count` | `notificationUnreadCount` | Count unread notifications visible to the caller |

## Autorización

Este módulo no declara roles: o no expone rutas, o son públicas por diseño.

## Códigos de error propios

- `NOTIFICATION_NOT_FOUND`

## Clases exportadas

- `MarkAllReadResponseDto`
- `NotificationController`
- `NotificationDto`
- `NotificationListQueryDto`
- `NotificationProjectorService`
- `NotificationService`
- `NotificationsModule`
- `UnreadCountResponseDto`

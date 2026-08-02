# Ciclo de vida de una petición

## Orden exacto

```mermaid
sequenceDiagram
    autonumber
    participant Cliente
    participant Express as Middleware
    participant Auth as AuthenticationGuard
    participant Roles as RolesGuard
    participant Rate as RateLimitGuard
    participant Pipe as ValidationPipe
    participant Ctrl as Controlador
    participant Svc as Servicio
    participant DB as PostgreSQL
    participant Filter as DomainExceptionFilter

    Cliente->>Express: petición
    Express->>Express: x-request-id (validado o generado) + contexto de correlación
    Express->>Express: helmet · CORS · compresión · límite de cuerpo
    Express->>Auth: 
    Auth->>Auth: resuelve principal según AUTH_MODE
    Auth->>Roles: principal con roles del registro/token
    Roles->>Rate: rol exigido satisfecho
    Rate->>Pipe: dentro de la ventana
    Pipe->>Ctrl: DTO validado (whitelist + forbidNonWhitelisted)
    Ctrl->>Svc: delega (sin lógica de negocio en el controlador)
    Svc->>DB: consulta con app.tenant_id fijado
    DB-->>Svc: filas del tenant (RLS)
    Svc-->>Cliente: respuesta mapeada
    Note over Filter: cualquier excepción en cualquier punto<br/>sale por el mismo sobre de error
```

## Qué garantiza cada paso

| Paso | Garantía | Si falla |
| --- | --- | --- |
| Correlación | Todo registro y toda respuesta llevan el mismo `x-request-id` | Se genera uno; un valor recibido con forma sospechosa se descarta |
| CORS | Solo los orígenes declarados; `x-principal-id`/`x-roles` **no** están permitidas | Petición sin cabeceras de CORS |
| Autenticación | El principal sale del registro de clientes o del token firmado | `401` |
| Autorización | Rol exigido por la ruta, decidido en el servidor | `403` |
| Límite de tasa | Ventana separada para gestión y runtime; cabeceras `x-ratelimit-*` | `429` con `retry-after` |
| Validación | `whitelist` + `forbidNonWhitelisted`: un campo no declarado es un error, no se ignora | `400` |
| Ejecución | Tenant fijado como GUC en la conexión | RLS filtra aunque el `where` se olvide |
| Error | Sobre único, con `requestId` y código estable | Todo error, incluido el no controlado |

!!! note "Por qué `forbidNonWhitelisted` y no solo `whitelist`"
    Ignorar en silencio un campo desconocido hace que un integrador crea que envió algo que
    nunca llegó. Rechazarlo convierte un malentendido silencioso en un error inmediato.

## Ruta de decisión, con sus particularidades

1. **Reserva de idempotencia** antes de trabajar: si la clave ya tiene resultado, se devuelve ese mismo.
2. **Resolución del despliegue** activo para el artefacto y el ambiente (con caché por tenant).
3. **Resolución de variables**, incluidas las externas — **fuera** de cualquier transacción, porque no se abre una transacción alrededor de E/S de red.
4. **Ejecución** del artefacto compilado, acotada por `MAX_EXECUTION_STEPS`.
5. **Persistencia** de ejecución, snapshot, traza, razones, revisión manual y evento de auditoría en **una sola** transacción.
6. **Liberación** de la clave de idempotencia con el resultado.

## Apagado ordenado

`SIGINT`/`SIGTERM` cierran Nest —lo que drena los trabajos en vuelo— y además **vacían las
trazas** de OpenTelemetry, cuyo SDK arranca antes que Nest y queda fuera de su ciclo de vida.
Sin ese vaciado se perderían justo los spans de la ventana de apagado, que es cuando una
petición fallida es más interesante.

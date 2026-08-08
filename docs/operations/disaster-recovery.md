# Recuperación ante desastres

## Objetivos

!!! info "Adoptados por ADR-0024, sujeto a revisión trimestral"
    RTO y RPO fueron adoptados formalmente en
    [ADR-0024](../adr/ADR-0024-slo-rto-rpo-adoption.md), coherentes con el diseño actual de
    recuperación. Revisar cuando cambie la topología descrita abajo o cuando se incorpore un
    responsable de negocio que deba ratificarlos.

| Objetivo | Valor adoptado | Justificación |
| --- | --- | --- |
| RTO (tiempo de recuperación) | 4 h | Restaurar PostgreSQL, reponer secretos y verificar la cadena |
| RPO (pérdida admisible) | 15 min | Con WAL continuo; sin él, la cadencia del respaldo completo |

## Escenarios

### Pérdida total de la base de datos

1. Restaurar al punto elegido.
2. Reponer `AUDIT_HASH_SECRET` **y** los secretos retirados.
3. `yarn prisma:migrate` si el código es más nuevo que el respaldo.
4. Verificar `/health/ready`.
5. **Verificar la cadena de auditoría por tenant.**
6. Reanudar el tráfico.

El paso 5 distingue una restauración correcta de una que dejó la evidencia rota.

### Pérdida de Redis

Menos grave, pero **no** inocua: se pierden las reservas de idempotencia en vuelo. Un canal que
reintente durante esa ventana puede producir una **segunda decisión** para la misma solicitud.

Recomendación: congelar el tráfico de decisión hasta restablecerlo. En producción el servicio
además no estará listo, porque Redis es obligatorio.

### Pérdida del secreto de auditoría

Si se pierde el secreto pero la base está intacta, los datos siguen ahí pero **la cadena no se
puede verificar**. No hay recuperación técnica: es un incidente de cumplimiento que hay que
declarar. Por eso los secretos forman parte del respaldo, no solo los datos.

### Pérdida del clúster

La aplicación no tiene estado propio: redesplegar la imagen etiquetada y apuntar a la base
restaurada. El worker y la API son la misma imagen con distinto arranque.

## Recuperación a un punto en el tiempo

!!! danger "Descarta decisiones ya comunicadas"
    Restaurar a un punto anterior elimina ejecuciones que el canal de originación **ya recibió**.
    Antes de hacerlo hay que decidir qué se hace con ellas: es una decisión de negocio, no de
    operación.

## Cómo se toma y se repone la copia

```bash
./scripts/backup.sh                       # a ./backups
BACKUP_DIR=/mnt/nas RETENTION_DAYS=30 ./scripts/backup.sh
./scripts/restore.sh backups/atlas-20260804T221500Z.dump
```

Ambos se ejecutan **dentro** del contenedor de PostgreSQL (`docker compose exec`) y no con un
cliente del anfitrión, por dos razones que no son de comodidad:

1. `pg_dump` debe ser de versión igual o mayor que la del servidor. Un cliente 14 contra un
   servidor 16 aborta, y el momento de descubrirlo no puede ser el primer intento de copia
   antes de una migración.
2. Con la superposición de producción, PostgreSQL **no publica ningún puerto**. Un cliente del
   anfitrión no tendría por dónde conectarse; `exec` no lo necesita.

Detalles que cambian el resultado:

- Formato `custom` (`-Fc`), comprimido y no legible con un editor — es un volcado que contiene
  decisiones de crédito. Permite además restaurar tablas sueltas y paralelizar.
- `docker compose exec -T`: **sin** TTY. Con TTY, Docker traduce saltos de línea y corrompe el
  binario en silencio; solo se descubre al intentar restaurar.
- `backup.sh` escribe un `.sha256` junto al volcado y verifica el archivo con
  `pg_restore --list` antes de darlo por bueno. La purga por retención ocurre **después** de esa
  verificación: al revés, quedaría una ventana en la que se han borrado las copias antiguas y
  la nueva no sirve.
- `restore.sh` comprueba la suma antes de tocar nada, detiene `api` y `worker` mientras dura la
  operación (y los repone pase lo que pase), usa `--single-transaction --exit-on-error` para
  que sea todo o nada, y exige escribir el nombre de la base para confirmar. Un «sí» reflejo
  sobre la consola equivocada es exactamente cómo se pierde el entorno bueno.
- Tras restaurar reejecuta `bootstrap-app-role` y `migrate`. La contraseña de `atlas_app`
  **no** viaja en el volcado (`--no-privileges`); sin reponerla, la API arranca en bucle con un
  error de autenticación que no parece tener relación con la restauración.

## Prueba periódica

Un respaldo no probado no es un respaldo. Cadencia mínima mensual, en un ambiente aislado:

1. Restaurar el último respaldo.
2. Reponer secretos de prueba.
3. Arrancar la aplicación contra esa copia.
4. Verificar readiness, la cadena de auditoría y una decisión de humo.
5. Registrar el tiempo real: es su RTO medido, no el estimado.

## Dependencias externas

Ni el proveedor de identidad ni el de variables están bajo el control de esta plataforma. Su
plan de continuidad debe considerarse aparte: sin el proveedor de identidad el portal no
autentica, aunque las integraciones por API key sigan operando.

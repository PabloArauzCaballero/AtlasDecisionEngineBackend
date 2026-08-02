# Gestión del cambio

## Clases de cambio

| Clase | Ejemplo | Requiere |
| --- | --- | --- |
| **Software compatible** | Endpoint nuevo, corrección | Pull request con puertas verdes |
| **Software incompatible** | Retirar un campo de una respuesta | Deprecación previa + subir `API_VERSION` |
| **Esquema compatible** | Columna nueva anulable, índice | Migración escrita a mano + `migration:validate` |
| **Esquema destructivo** | Eliminar una columna | *Expand/contract* + ventana de mantenimiento |
| **Política de decisión** | Cambiar un umbral | Flujo de aprobación de la plataforma; **sin** despliegue de software |
| **Configuración** | Ajustar un límite | Cambio de variable + reinicio; validado por el esquema |
| **Secreto** | Rotar una clave | Coordinado con los consumidores; ver gestión de secretos |

!!! important "La clase que justifica todo el sistema"
    Cambiar una política de decisión **no** requiere un despliegue de software. Ese es el
    propósito de la plataforma: un analista ajusta un umbral, lo somete a aprobación y lo
    despliega por ambiente, con evidencia de quién lo autorizó.

## Cambios que exigen coordinación externa

| Cambio | Con quién |
| --- | --- |
| Rotar una API key | El integrador — **la anterior queda invalidada** |
| Retirar un endpoint | Todos sus consumidores conocidos |
| Cambiar un mensaje público de código de razón | Cumplimiento: tiene efecto regulatorio |
| Rotar `METRICS_TOKEN` | El scrapeador de métricas |

## Ventanas de mantenimiento

Solo para migraciones destructivas y restauraciones. Todo lo demás va sin ventana; ver
[mantenimiento](../operations/maintenance.md).

## Trazabilidad de un cambio

| Tipo | Dónde queda el rastro |
| --- | --- |
| Software | Historial de git, pull request, etiqueta de imagen, `COMMIT_SHA` |
| Esquema | Fichero de migración + tabla de migraciones aplicadas |
| Política de decisión | Cadena de auditoría: quién envió, quién votó, quién desplegó |
| Configuración | Sistema de despliegue; **no** queda en la base de datos |

!!! warning "El punto ciego de la trazabilidad"
    Un cambio de configuración —subir un límite de tasa, apagar el relay— **no deja rastro en la
    plataforma**. Su registro depende del sistema de despliegue de la organización. Al investigar
    un incidente, compruebe explícitamente si alguien cambió una variable de entorno.

## Congelaciones

Congele los cambios no urgentes cuando:

- El presupuesto de error del mes está consumido a más de la mitad a mitad de ventana.
- Hay un incidente de integridad abierto.
- Hay una restauración en curso.

## Después de un cambio significativo

- [ ] Puertas verdes con **salida real** registrada
- [ ] Documentación regenerada y validada
- [ ] Runbook actualizado si cambió un procedimiento
- [ ] ADR si fue una decisión estructural
- [ ] Consumidores avisados si el contrato cambió

# Respuesta a incidentes de seguridad

## Clasificación

| Nivel | Ejemplo | Respuesta |
| --- | --- | --- |
| **Crítico** | Cadena de auditoría rota; fuga entre tenants; escape del sandbox | Inmediata, con congelación de cambios |
| **Alto** | Credencial comprometida; pico de denegaciones desde una fuente | Horas |
| **Medio** | Vulnerabilidad `high` sin explotación conocida | Días |
| **Bajo** | Hallazgo informativo | Siguiente ciclo |

## Principios

1. **Preservar la evidencia antes que restaurar el servicio.** Un reinicio puede borrar el estado que explica lo ocurrido.
2. **No «reparar» la evidencia.** Recalcular hashes destruye la propiedad que hace útil la cadena.
3. **Contener antes que erradicar.** Revocar la credencial y aislar es más rápido que entender.
4. **Registrar cada acción con su hora.** El propio incidente se audita.

---

## Cadena de auditoría rota

1. Declarar incidente de integridad.
2. **Congelar** rotaciones de clave y cualquier tarea que toque evidencia.
3. Exportar una instantánea de solo lectura con sus hashes.
4. Determinar el alcance: ¿desde qué evento falla la verificación, y en qué tenants?
5. Investigar: escritura directa a la base, restauración parcial, secreto ausente.
6. **No** recalcular hashes.

Descarte primero lo benigno: un `keyId` cuyo secreto ya no está configurado produce un fallo de
verificación que **no** es una manipulación.

## Credencial comprometida

1. Rotar el secreto y resembrar: la siembra **invalida la credencial anterior**.
2. Revisar `decision_access_audit` filtrando por ese cliente: qué recursos y desde qué IP.
3. Revisar `decision_execution` de sus tenants en la ventana afectada.
4. Reducir el alcance del cliente (scopes y tenants) si era mayor del necesario.

## Sospecha de fuga entre tenants

1. Comprobar el rol de conexión: `select current_user` — si no es `atlas_app`, **RLS estaba inerte** y ese es el incidente.
2. Comprobar que la tabla implicada tiene política RLS.
3. Revisar la clave de caché: una sin tenant sirve datos de un tenant a otro sin tocar la base.
4. Alcance: `decision_access_audit` y las ejecuciones del periodo.

## Sospecha de escape del sandbox

1. Aislar el contenedor `script-runner` (ya corre sin red: no puede exfiltrar).
2. `SCRIPT_NODES_ENABLED=false` para detener nuevas ejecuciones; el resto de decisiones sigue.
3. Conservar el código importado implicado — está persistido, no hay que reconstruirlo.
4. Verificar que el anfitrión tiene gVisor activo: sin él, `runc` **no** es una frontera del sistema operativo.

## Comunicación

| Destinatario | Cuándo | Qué |
| --- | --- | --- |
| Responsable del producto | Crítico y alto, de inmediato | Impacto en decisiones y clientes |
| Cumplimiento | Cualquier incidente que toque evidencia o datos personales | Alcance y trazabilidad |
| Equipos consumidores | Si hay degradación o rotación de credenciales | Qué cambia y cuándo |

## Después

Un incidente cerrado sin cambio en el sistema volverá a ocurrir. Cada incidente termina con:
la causa raíz, el control que faltaba, la prueba que lo habría detectado y quién asume el
riesgo residual si se acepta.

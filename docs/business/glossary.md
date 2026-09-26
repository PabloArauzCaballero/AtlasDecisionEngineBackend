# Glosario

Términos con el significado **exacto** que tienen en este sistema. Donde el uso común difiere,
se señala.

| Término | Significado aquí |
| --- | --- |
| **Artefacto** | Algoritmo de decisión gobernado. Unidad de versionado, aprobación y despliegue. No es «una regla» |
| **Versión** | Instancia inmutable de un artefacto. Solo `DRAFT` es editable |
| **Artefacto compilado** | Forma ejecutable e inmutable de una versión, con checksum. Lo que el runtime ejecuta; nunca el grafo de edición |
| **Nodo** | Posición en el grafo. Tiene aristas, orden y aparece como paso en la traza |
| **Regla / condición** | Expresión booleana que condiciona una arista. Devuelve un veredicto, no un dato |
| **Campo calculado** | Función pequeña, gobernada y reutilizable con contrato de **retorno** (un solo valor). No es un artefacto ni una variable |
| **Variable INPUT** | Dato que entra por la petición o por un proveedor, con contrato versionado |
| **Variable INTERMEDIATE** | Valor que existe **solo durante una ejecución**. No cuelga del catálogo global. Se referencia como `intermediate.<code>` |
| **Contrato de salida** | Declaración explícita de qué campos publica el artefacto y de dónde sale cada uno. La salida no se infiere del último nodo |
| **Código de razón** | Explicación estructurada de una decisión, con mensaje público (cliente) e interno (analista) |
| **Adverse action** | Código de razón que, por normativa, debe comunicarse al cliente |
| **Ambiente** | `DEV`, `STAGING`, `TEST`, `PROD`. Determina qué versión está activa y qué restricciones acotadas aplican |
| **Despliegue** | Vínculo vigente entre una versión aprobada y un ambiente |
| **Ejecución** | Una decisión tomada, con su evidencia persistida |
| **Traza** | Secuencia de pasos de una ejecución: nodo, rama tomada, duración y estado de los valores |
| **Momento de creación** | Índice del paso de la traza en que una intermedia recibió valor por primera vez |
| **Clave de idempotencia** | Identificador que garantiza que un reintento devuelve la misma ejecución, no una decisión nueva |
| **Lease** | Reserva con caducidad. Un titular que muere libera el recurso al vencer, sin intervención |
| **Outbox** | Tabla donde un evento se escribe en la **misma transacción** que el cambio que lo produce, y se despacha después |
| **Cola muerta (DEAD)** | Estado de un evento que agotó sus reintentos. Requiere atención humana; más réplicas no lo arreglan |
| **Cadena de auditoría** | Secuencia append-only encadenada por hash por tenant. No se modifica ni se borra |
| **Rotación de clave de auditoría** | Cambio del secreto de firma conservando los anteriores solo para **verificar** eventos históricos |
| **Contraejemplo** | Caso generado que viola una propiedad. Se archiva reducido al mínimo que sigue fallando |
| **Semilla (QA Lab)** | Valor que hace reproducible una corrida generativa bit a bit |
| **RLS** | *Row-Level Security* de PostgreSQL. Aísla por tenant en el motor, no en el código. **Inerte para un superusuario** |
| **Sidecar de scripts** | Contenedor aislado, sin red y bajo gVisor, donde se ejecuta el código importado |
| **`WORKER_ROLE`** | Reparto de responsabilidades del proceso: `ALL`, `API` o `WORKER` |
| **Prelude** | Código revisado del repositorio que habilita una librería. Una fila del registro **habilita**, nunca aporta código |

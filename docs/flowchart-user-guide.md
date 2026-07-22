# Guía del editor de FlowChart (Fase 3)

El editor visual de grafos de decisión vive en el frontend
(`/graph-editor`, y `/artifact-versions/{versionId}/graph` para una versión
concreta). Esta guía cubre el flujo de autoría y aclara el comportamiento de las
áreas que históricamente causaban confusión (carga, selección de salida,
sincronización), incluyendo el bug de carga corregido en esta entrega.

## Cargar un grafo

- **Por URL directa**: al abrir `/artifact-versions/{id}/graph` (por ejemplo,
  desde el botón "View Graph" en el detalle del artefacto), el editor **carga el
  grafo automáticamente** — ya no queda el lienzo vacío esperando que pulses
  "Load" manualmente. Este era un bug real (Fase 3) y está corregido y cubierto
  por pruebas (`useGraphEditor.test.tsx`).
- **Manualmente**: en `/graph-editor`, escribe el ID de versión en la barra de
  herramientas y pulsa "Load". El campo de texto es independiente de la URL: solo
  la navegación por ruta dispara la carga automática.

## Variables de entrada y salida

- Las **entradas** se derivan de las dependencias de variables del artefacto
  (`usageType` distinto de `OUTPUT*`); no se gestionan en un panel aparte.
- Las **salidas** se gestionan en el "Contrato global de resultados"
  (`OutputVariableManager`): añade variables del catálogo o crea nuevas. Reglas:
  - Exactamente **una** salida debe ser el **resultado principal**
    (`OUTPUT_PRIMARY`), marcada con la estrella. Al añadir la primera salida
    escalar se marca principal automáticamente.
  - Solo una salida **escalar** (no OBJECT/JSON/ARRAY/LIST) puede ser principal —
    el botón de estrella se deshabilita para tipos no escalares.
  - Al quitar la salida principal, la primera salida escalar restante se promueve
    automáticamente, de modo que nunca queda un contrato de salidas sin principal.

## Nodos y aristas

- **Añadir nodos**: arrástralos desde la biblioteca (`NodeLibrary`) al lienzo, o
  haz clic. Solo puede existir un nodo `START`.
- **Conectar**: activa el modo de conexión (icono de cadena), haz clic en el nodo
  origen y luego en el destino.
- **Ramas por defecto**: cada nodo no terminal con aristas salientes requiere
  exactamente una arista `default` (fail-closed). El editor impide dejar un nodo
  sin arista por defecto o con dos.
- **Deshacer/rehacer**: cada cambio estructural entra al historial
  (`useGraphHistory`); el arrastre de nodos se agrupa como una sola operación
  (begin/endDrag) para no llenar el historial con micro-movimientos.

## Sincronización y guardado

- El editor usa **bloqueo optimista**: al cargar captura el `lockVersion` de la
  versión, y al guardar lo envía en el header `if-match`. Si otro actor guardó
  primero, el backend responde `409 LOCK_CONFLICT` y debes recargar. Tras un
  guardado exitoso, el `lockVersion` local se actualiza con el valor devuelto y el
  historial de deshacer se limpia.
- Solo las versiones en estado `DRAFT` o `VALIDATION_FAILED` son editables; el
  backend rechaza escribir el grafo de cualquier otra versión
  (`VERSION_IMMUTABLE`).

## Validar

- "Validate" ejecuta `POST /v1/artifact-versions/{id}/validate` y muestra el
  informe (errores/advertencias con `entityKey` y `path`) en el panel JSON. La
  validación es determinista: dos validaciones seguidas del mismo grafo producen
  el mismo checksum canónico.

## Importar desde código (Fase 5)

Como alternativa al dibujo manual, `/code-import` genera un grafo a partir de
código JS/Python — ver `docs/code-to-flow-specification.md`. El grafo generado se
puede guardar como borrador y luego editar visualmente aquí.

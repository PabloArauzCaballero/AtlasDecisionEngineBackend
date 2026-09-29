# Revisión manual

Este módulo gestiona casos que una política deriva a intervención humana. A nivel de negocio
separa detección automática de resolución responsable; a nivel de sistema lista, asigna y resuelve
casos tenant-scoped con auditoría y segregación entre asignación y cierre.

Sólo el analista asignado puede resolver, y un caso que ya es de otra persona sólo lo reasigna
quien supervisa (`PLATFORM_ADMIN`, `OPERATIONS`). Las dos reglas van juntas: sin la segunda, quitarle
el caso a un compañero y cerrarlo son dos llamadas, y la primera deja de proteger nada.

La excepción de supervisión existe porque el caso de un analista que se va quedaría bloqueado para
siempre. No es silenciosa: la resolución guarda `assignedTo` y `supervisorOverride`, así que un
cierre por supervisión se cuenta sin reconstruirlo. Asignar sin nombrar a nadie deja el caso a
nombre de quien lo toma.

Las razones y el resultado quedan ligados a la ejecución que originó el caso.

## Expediente del alta (`PUT /v1/manual-reviews/by-execution/:executionId/onboarding-dossier`)

La usa AtlasBackend con su credencial de ejecución (audiencia `runtime`, rol `DECISION_RUNTIME`),
no los analistas. Guarda el expediente del alta en `evidenceJson.alta` del caso de la ejecución sin
tocar estado ni asignación; si la ejecución no tiene caso y llega `openIfMissing`, lo abre (cola
`IDENTIDAD`, prioridad 50, plazo 240 min por defecto). Existe porque, con la revisión humana
obligatoria, un alta que el artefacto dio por VERIFICADA no tenía caso y el revisor no veía nada.
Un caso abierto así se resuelve como cualquier otro y, en `IDENTIDAD`, vuelve a AtlasBackend por el
mismo callback. Un caso ya cerrado no admite expediente nuevo (409): lo que el revisor vio al
decidir forma parte de la evidencia.

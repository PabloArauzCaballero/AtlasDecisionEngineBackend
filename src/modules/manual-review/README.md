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

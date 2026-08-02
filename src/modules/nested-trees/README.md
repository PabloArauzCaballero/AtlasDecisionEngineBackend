# Árboles de decisión anidados

Este módulo permite componer políticas versionadas. A nivel de negocio reutiliza controles
aprobados y reduce divergencia; a nivel de sistema persiste referencias, valida tenant/estado,
mapeos, ciclos y profundidad, y ejecuta hijos con timeout y políticas FAIL/FALLBACK/SKIP.

`cycle-detector` razona por artefacto; `nested-tree.service` gobierna autoría; el servicio de
ejecución mapea sólo entradas/salidas permitidas y genera traza jerárquica.

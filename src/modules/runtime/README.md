# Runtime de decisiones

Este módulo ejecuta el data plane. A nivel de negocio responde decisiones idempotentes y conserva
evidencia explicable; a nivel de sistema resuelve deployment/variables, reclama claves con lease,
ejecuta el grafo y persiste snapshot, pasos, razones, errores y revisión manual de forma atómica.

`simulation` reutiliza el motor sin persistencia y prohíbe PROD. `retention-sweeper` elimina sólo
idempotencias expiradas en lotes; nunca elimina auditoría o ejecuciones reguladas.

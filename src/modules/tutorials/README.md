# Progreso de tutoriales

Este módulo guarda el avance de onboarding por usuario y tenant. A nivel de negocio permite
continuar aprendizaje entre sesiones; a nivel de sistema expone lectura/upsert idempotente y delega
contenido/versionado pedagógico al frontend.

La tabla está protegida por RLS. `tutorialId` identifica una guía del cliente, no concede permisos
ni altera estados del motor.

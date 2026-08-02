# Migración: RLS del progreso de tutorial

Corrige la única tabla tenant-scoped creada inicialmente sin política. A nivel de negocio cierra una
brecha de aislamiento aunque el dato sea de baja sensibilidad; a nivel de sistema habilita/fuerza
RLS y aplica el mismo `tenant_isolation` del resto del modelo.

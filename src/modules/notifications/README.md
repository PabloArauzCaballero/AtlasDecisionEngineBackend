# Notificaciones

Este módulo convierte eventos durables en una bandeja accionable. A nivel de negocio dirige tareas
a usuarios o roles sin acoplar procesos; a nivel de sistema proyecta eventos idempotentemente,
aplica visibilidad tenant/principal/rol y soporta lectura individual o masiva.

El proyector tolera reentrega del outbox mediante `ProcessedEvent`. Las notificaciones no son la
fuente de verdad del estado de aprobación.

# Migración: vistas con security invoker

Configura read models para respetar los permisos y RLS del llamante. A nivel de negocio evita que
una vista atraviese tenants; a nivel de sistema reemplaza el contexto del dueño por
`security_invoker=on` en las vistas expuestas a la API.

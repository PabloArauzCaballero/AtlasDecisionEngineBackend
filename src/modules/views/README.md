# Read models para el portal

Este módulo ofrece consultas optimizadas para pickers, formularios, búsqueda y scripts. A nivel de
negocio reduce fricción del portal sin duplicar reglas; a nivel de sistema consulta vistas
`security_invoker`, enlaza parámetros y aplica límites fijos/tenant.

Las vistas son proyecciones de lectura. Toda mutación sigue pasando por el módulo dueño y su
auditoría; estos endpoints no deben convertirse en bypass de autorización.

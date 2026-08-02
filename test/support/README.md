# Soporte de pruebas

Esta carpeta contiene helpers compartidos por pruebas no E2E. A nivel de negocio reduce falsos
positivos causados por colisiones; a nivel de sistema genera tenants únicos y otras piezas de
fixture sin introducir lógica productiva.

Un helper no debe ocultar la aserción central ni acceder a producción. Si modela una invariante del
dominio, esa invariante pertenece al código productivo y el helper sólo debe invocarla.

# Soporte E2E

Esta carpeta centraliza bootstrap de la aplicación, headers, clientes técnicos y búsqueda de
variables sembradas. A nivel de negocio mantiene escenarios comparables; a nivel de sistema evita
que cada suite fabrique autenticación o conexiones de forma distinta.

Los secretos son fixtures locales explícitos, nunca credenciales reales. Todo helper conserva
aislamiento por tenant y debe cerrar handles para que Jest termine limpiamente.

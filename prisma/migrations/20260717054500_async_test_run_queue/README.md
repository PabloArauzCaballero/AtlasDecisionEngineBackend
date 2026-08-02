# Migración: cola asíncrona de pruebas

Permite encolar suites sin mantener abierto el request. A nivel de negocio hace predecible la
validación de políticas grandes; a nivel de sistema agrega estados y campos necesarios para que
workers independientes reclamen y ejecuten runs durables.

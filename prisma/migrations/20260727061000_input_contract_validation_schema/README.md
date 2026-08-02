# Migración: esquema de validación en contratos de entrada

Amplía `vw_artifact_input_contract` con `validation_schema_json`. A nivel de negocio permite que el
simulador muestre opciones y restricciones reales; a nivel de sistema evita duplicar reglas de
variables en frontend y mantiene la vista bajo `security_invoker`.

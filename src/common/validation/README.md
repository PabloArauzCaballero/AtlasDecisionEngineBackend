# Validación defensiva

Esta carpeta contiene validadores que no pertenecen a un dominio concreto. A nivel de negocio
evita que reglas configurables degraden disponibilidad; a nivel de sistema `safe-regex.ts` detecta
patrones propensos a ReDoS, acota entradas y falla cerrado.

Una expresión dinámica no debe llegar directamente a `RegExp` sin esta protección o una garantía
equivalente demostrable.

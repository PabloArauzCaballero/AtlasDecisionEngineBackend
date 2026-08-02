# Catálogo y resolución de variables

Este módulo define el contrato de datos del motor. A nivel de negocio asigna significado, dueño,
clasificación y vigencia a cada señal; a nivel de sistema versiona definiciones/reglas, valida tipos
y resuelve inputs desde request, defaults o proveedor externo con evidencia.

Las salidas son contratos producidos por el grafo y no se solicitan al proveedor. Fallos externos
se acotan por timeout, métricas y política fail-closed.

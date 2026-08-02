# Evidencia local de smoke tests

Esta carpeta recibe `last-run.json`, un artefacto efímero ignorado por Git. A nivel de negocio deja
una evidencia rápida de que las rutas críticas respondieron; a nivel de sistema conserva estados,
latencias y aserciones del último `yarn smoke` sin contaminar el código fuente.

`demo-applicant.json` es el solicitante de bajo riesgo completo que exige el contrato vigente de
`BNPL_CREDIT_DECISION`. Existe a nivel de negocio para que ejemplos y diagnósticos representen una
solicitud resoluble; a nivel de sistema evita que smoke y documentación dupliquen un payload parcial
que el runtime debe rechazar. No contiene datos personales reales.

`last-run.json` se puede borrar y regenerar. No sustituye pruebas E2E, no debe contener credenciales
y no se versiona porque describe una ejecución local específica. El fixture sí se versiona porque
forma parte del contrato de demostración.

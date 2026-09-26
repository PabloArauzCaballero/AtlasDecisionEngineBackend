# Evidencia local de smoke tests

Esta carpeta recibe artefactos efímeros ignorados por Git. A nivel de negocio deja una evidencia
rápida de que las rutas críticas respondieron; a nivel de sistema conserva estados, latencias y
aserciones sin contaminar el código fuente.

`last-run.json` lo escribe `yarn smoke`, el humo corto de rutas críticas.

`out/` lo escribe `yarn smoke:full`, el **smoke integral por tipo de usuario**: un JSON por
usuario (`author.json`, `approver.json`, `operator.json`), la frontera de autenticación
(`access.json`), el estado compartido entre los tres (`state.json`) y el resumen de la tanda
(`summary.json`, con el catálogo agregado de códigos de error observados). Cada comprobación
lleva un identificador estable `<dominio>.<ruta>.<caso>`, que es lo que permite decir dónde
falló exactamente y no sólo que algo falló. El manual está en
[`docs/getting-started/smoke-integral.md`](../docs/getting-started/smoke-integral.md).

`demo-applicant.json` es el solicitante de bajo riesgo completo que exige el contrato vigente de
`BNPL_CREDIT_DECISION`. Existe a nivel de negocio para que ejemplos y diagnósticos representen una
solicitud resoluble; a nivel de sistema evita que smoke y documentación dupliquen un payload parcial
que el runtime debe rechazar. No contiene datos personales reales.

`last-run.json` y `out/` se pueden borrar y regenerar. No sustituyen pruebas E2E, no deben contener
credenciales y no se versionan porque describen ejecuciones locales concretas. El fixture sí se
versiona porque forma parte del contrato de demostración.

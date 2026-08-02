# Runbooks

Esta carpeta existe para convertir fallos operativos previsibles en respuestas repetibles. A nivel
de negocio protege continuidad, trazabilidad y tiempos de atención; a nivel de sistema contiene
procedimientos seguros que un operador puede ejecutar sin improvisar cambios de arquitectura.

`OPERATIONS.md` cubre despliegue, readiness, picos de 401/403/429, decisiones sin resultado,
integridad de auditoría, rollback y degradación del sink de logs. Los runbooks describen acciones
reversibles y criterios de escalamiento; no autorizan borrar datos ni operar producción sin el
control de cambios correspondiente.

Los tres runbooks del pliego de contratos (§15) cubren cada uno un dominio y enlazan a su manual:

| Runbook | Cubre | Manual |
| --- | --- | --- |
| `CONTRATOS_DE_VARIABLES.md` | §1–§4: contratos, compatibilidad, intermedias, contrato de salida | `../variable-contracts.md` |
| `CAMPOS_CALCULADOS.md` | §5–§8: campos calculados, librerías, runner aislado, cotas de memoria | `../calculated-fields.md` |
| `QA_LAB.md` | §10: corridas generativas, distribuciones, contraejemplos reproducibles | `../calculated-fields.md` §6 |

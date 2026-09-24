# Runtime de decisiones

Este módulo ejecuta el data plane. A nivel de negocio responde decisiones idempotentes y conserva
evidencia explicable; a nivel de sistema resuelve deployment/variables, reclama claves con lease,
ejecuta el grafo y persiste snapshot, pasos, razones, errores y revisión manual de forma atómica.

`simulation` reutiliza el motor sin persistencia y prohíbe PROD. `retention-sweeper` elimina sólo
idempotencias expiradas en lotes; nunca elimina auditoría o ejecuciones reguladas.

## Contrato de la respuesta para quien concede (P-09/P-10/P-11)

Campos aditivos en `POST /v1/decisions/:artifactCode`:

- `decisionValidUntil`: ISO 8601, sólo en `SUCCEEDED` (`DECISION_VALIDITY_SECONDS`, 259200 (72 h) por
  omisión); `null` en cualquier otro estado. Una réplica idempotente devuelve el mismo valor.
- `exposure`: límite `SUBJECT_TOTAL` más estrecho que vio la decisión (`currentExposure`,
  `requestedAmount`, `remainingBeforeDecision`, `remainingAfterDecision`…) o `null`. El motor NO
  reserva: quien concede reserva de forma atómica contra su libro.
- `degradedInputs` y `freshnessUnknown`: no se concede con `freshnessUnknown` no vacío.
- `enablingBasis`: origen de la política de base habilitante y finalidades exigidas.

`NO_DECISION` (HTTP 422) ya no significa sólo «faltan variables»: el primer `reasonCodes[].code`
distingue `VARIABLE_MISSING_OR_INVALID`, `ENABLING_BASIS_MISSING` (sin base habilitante; el grafo
no se ejecuta) y `ECONOMIC_OUTPUT_INVALID` (salida fuera de rango; defecto del artefacto, no
rechazo del solicitante). Ninguno es una aprobación ni un rechazo crediticio. Decisiones en
`docs/compliance/decisions.md`.

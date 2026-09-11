-- Dos motivos nuevos para estar en la cola de identidad.
--
-- La cola la alimentaban sólo los ERRORES de la puerta de documentos
-- (`IDENTITY_ARBITRATION_PENDING`). Una verificación que TERMINABA bien y cuyo veredicto era
-- «que lo decida una persona» acababa en `SUCCEEDED_WITH_WARNINGS` y no entraba en ninguna
-- bandeja: el veredicto se quedaba en su fila esperando a que alguien lo buscara por su cuenta.
-- Medido el 2026-09-11 contra una cédula auténtica: `REVIEW_REQUIRED` con
-- `THRESHOLD_PROFILE_MISSING`, y la cola devolviendo cero elementos.
--
-- Los motivos que ya existían no sirven para nombrar estos dos casos, y ponerles uno aproximado
-- sería peor que no tenerlos: quien abre la bandeja decide qué mirar primero por el motivo.
--
--   UNCALIBRATED_DECISION — el worker no puede firmar porque sus cortes no están calibrados.
--                           No es una duda sobre la persona: es una carencia del sistema.
--   INCONCLUSIVE_LIVENESS — la prueba de vida no concluyó. Tampoco es una acusación.
--
-- Postgres 12+ admite añadir valores dentro de una transacción mientras no se USEN en ella.
-- Rollback operacional: no hay DROP VALUE en Postgres; se revierte dejando de emitirlos.

ALTER TYPE "IdentityReviewReason" ADD VALUE IF NOT EXISTS 'UNCALIBRATED_DECISION';
ALTER TYPE "IdentityReviewReason" ADD VALUE IF NOT EXISTS 'INCONCLUSIVE_LIVENESS';

-- Desde qué pantalla y qué cliente se hizo cada acceso, tal como lo declara el cliente.
--
-- Flujos verifica las pantallas del catálogo contra uso real. Para el portal del Motor, la única
-- evidencia es esta tabla, y no guardaba desde dónde se llamaba: las 55 pantallas del portal no
-- tenían forma de pasar de «existe en el código» a «alguien la usó».
--
-- Aditiva y nula: las filas anteriores quedan sin origen, que es la verdad. Tabla pequeña en el
-- servidor (4 864 filas, 1,3 MB el 2026-09-10), así que el índice se crea en línea.
-- Rollback operacional: DROP INDEX "decision_access_audit_origin_client_occurred_at_idx";
-- ALTER TABLE "decision_access_audit" DROP COLUMN "origin_screen", DROP COLUMN "origin_client";

ALTER TABLE "decision_access_audit"
  ADD COLUMN "origin_screen" VARCHAR(200),
  ADD COLUMN "origin_client" VARCHAR(60);

CREATE INDEX "decision_access_audit_origin_client_occurred_at_idx" ON "decision_access_audit"("origin_client", "occurred_at");

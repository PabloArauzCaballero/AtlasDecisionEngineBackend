-- «Toda la cartera» deja de ser NULL y pasa a ser la cadena vacía.
--
-- Corrige una decisión de la migración anterior que no sobrevive al primer uso. `segment` nulo
-- significaba «sin segmentar», y la unicidad se resolvió con `NULLS NOT DISTINCT`, que en la BASE
-- funciona. El problema aparece una capa más arriba: cualquier lectura por clave genera
-- `segment = $1`, y en SQL `segment = NULL` no es cierto NUNCA, ni siquiera contra otro NULL. El
-- efecto es que un `upsert` sobre el límite global no encuentra la fila que sí existe, intenta
-- insertarla y choca contra su propia clave única.
--
-- Es la trampa clásica del NULL en una clave, y la salida barata es la correcta: un centinela
-- explícito. La cadena vacía es comparable, es indexable y no admite dos lecturas.
--
-- Aditiva en la práctica: las dos tablas se crearon en la migración inmediatamente anterior y
-- están vacías en cualquier despliegue, así que el `UPDATE` previo no toca nada; se escribe
-- igualmente para que la migración sea correcta si alguien la aplica sobre datos.

UPDATE "portfolio_state" SET "segment" = '' WHERE "segment" IS NULL;
UPDATE "exposure_limit"  SET "segment" = '' WHERE "segment" IS NULL;

ALTER TABLE "portfolio_state"
  ALTER COLUMN "segment" SET DEFAULT '',
  ALTER COLUMN "segment" SET NOT NULL;

ALTER TABLE "exposure_limit"
  ALTER COLUMN "segment" SET DEFAULT '',
  ALTER COLUMN "segment" SET NOT NULL;

-- Sin nulos, `NULLS NOT DISTINCT` sobra: los índices vuelven a su forma corriente, que es la que
-- cualquiera espera al leerlos.
DROP INDEX "portfolio_state_tenant_asof_metric_segment_key";
CREATE UNIQUE INDEX "portfolio_state_tenant_asof_metric_segment_key"
  ON "portfolio_state"("tenant_id", "as_of", "metric_code", "segment");

DROP INDEX "exposure_limit_tenant_code_segment_key";
CREATE UNIQUE INDEX "exposure_limit_tenant_code_segment_key"
  ON "exposure_limit"("tenant_id", "limit_code", "segment");

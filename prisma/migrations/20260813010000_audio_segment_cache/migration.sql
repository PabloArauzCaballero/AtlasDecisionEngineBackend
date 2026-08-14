-- Caché de segmentos de locución (ahorro por tramos) --------------------------
--
-- El proveedor de voz cobra por carácter y la caché de frases sólo ahorra
-- cuando la frase se repite ENTERA: cambiar una variable volvía a pagar toda
-- la plantilla. Estas piezas permiten generar por tramos: los fijos se pagan
-- una vez, y una frase nueva sólo paga sus variables.

ALTER TABLE "decision_audio_asset" ADD COLUMN "variables_encrypted" TEXT;
ALTER TABLE "decision_audio_asset" ADD COLUMN "segments_summary" JSONB;

CREATE TABLE "decision_audio_segment" (
  "id"              UUID         NOT NULL,
  "tenant_id"       BIGINT       NOT NULL,
  "segment_key"     CHAR(64)     NOT NULL,
  "text_encrypted"  TEXT         NOT NULL,
  "audio_bytes"     BYTEA        NOT NULL,
  "mime_type"       VARCHAR(120) NOT NULL,
  "checksum_sha256" CHAR(64)     NOT NULL,
  "bytes"           BIGINT       NOT NULL,
  "usage_units"     INTEGER      NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_audio_segment_pkey" PRIMARY KEY ("id")
);

-- El índice único es también la idempotencia: un segmento repetido no crea
-- fila nueva, que es lo que acota la caché.
CREATE UNIQUE INDEX "decision_audio_segment_tenant_id_segment_key_key"
  ON "decision_audio_segment"("tenant_id", "segment_key");

-- El mismo aislamiento por tenant que el resto de tablas de audio: segunda
-- línea de defensa detrás del repositorio construido por tenant.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE decision_audio_segment ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE decision_audio_segment FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON decision_audio_segment';
  EXECUTE
    'CREATE POLICY tenant_isolation ON decision_audio_segment '
    'USING (current_setting(''app.tenant_id'', true) IS NULL '
    '       OR tenant_id = current_setting(''app.tenant_id'', true)::bigint) '
    'WITH CHECK (current_setting(''app.tenant_id'', true) IS NULL '
    '       OR tenant_id = current_setting(''app.tenant_id'', true)::bigint)';
END $$;

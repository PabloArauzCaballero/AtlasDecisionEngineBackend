-- Motivos estructurados por campo del contrato de salida (§4).
--
-- `absence_reasons` (texto libre) explica por qué un campo OPCIONAL puede faltar.
-- Esto es distinto: son los códigos del catálogo gobernado que la decisión puede
-- devolver junto al campo, con FK real, para que el consumidor ramifique por
-- código en vez de por prosa.
--
-- Sin `tenant_id` y sin RLS propia, igual que `decision_action_reason_mapping`:
-- el aislamiento lo da la cascada desde `decision_output_contract_field`, que sí
-- está bajo RLS por tenant.
CREATE TABLE "decision_output_field_reason_map" (
  "id"              BIGSERIAL NOT NULL,
  "output_field_id" BIGINT    NOT NULL,
  "reason_code_id"  BIGINT    NOT NULL,
  "priority"        INTEGER   NOT NULL DEFAULT 100,

  CONSTRAINT "decision_output_field_reason_map_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "decision_output_field_reason_map"
  ADD CONSTRAINT "decision_output_field_reason_map_output_field_id_reason_key"
  UNIQUE ("output_field_id", "reason_code_id");

ALTER TABLE "decision_output_field_reason_map"
  ADD CONSTRAINT "decision_output_field_reason_map_output_field_id_fkey"
  FOREIGN KEY ("output_field_id") REFERENCES "decision_output_contract_field" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, no CASCADE: retirar un reason code del catálogo no debe vaciar en
-- silencio el contrato de una versión ya publicada.
ALTER TABLE "decision_output_field_reason_map"
  ADD CONSTRAINT "decision_output_field_reason_map_reason_code_id_fkey"
  FOREIGN KEY ("reason_code_id") REFERENCES "decision_reason_code" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "decision_output_field_reason_map_reason_code_id_idx"
  ON "decision_output_field_reason_map" ("reason_code_id");

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_output_field_reason_map" TO atlas_app;
    GRANT USAGE, SELECT ON SEQUENCE "decision_output_field_reason_map_id_seq" TO atlas_app;
  END IF;
END
$$;

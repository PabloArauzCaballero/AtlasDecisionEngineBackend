-- Progreso de tutoriales por usuario. Tabla nueva y aditiva: no toca datos
-- existentes.
CREATE TABLE "user_tutorial_progress" (
  "id" BIGSERIAL PRIMARY KEY,
  "tenant_id" BIGINT NOT NULL,
  "user_id" VARCHAR(200) NOT NULL,
  "tutorial_id" VARCHAR(200) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'STARTED',
  "last_step" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "auto_show" BOOLEAN NOT NULL DEFAULT true,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "user_tutorial_progress_tenant_user_tutorial_key"
  ON "user_tutorial_progress" ("tenant_id", "user_id", "tutorial_id");

CREATE INDEX "user_tutorial_progress_tenant_user_idx"
  ON "user_tutorial_progress" ("tenant_id", "user_id");

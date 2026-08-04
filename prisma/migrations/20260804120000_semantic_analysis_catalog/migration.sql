-- Catálogo del worker semántico (ADR-0026).
--
-- Traduce las migraciones 001–003 del paquete original, que creaban un esquema
-- `semantic_analysis` propio con Sequelize. Aquí las tablas viven en el mismo
-- esquema y bajo el mismo ORM que el resto del motor: dos ORM contra la misma
-- base parten las transacciones en dos y obligan a mantener dos juegos de
-- migraciones que nadie puede aplicar en un solo paso.
--
-- El catálogo son DATOS: añadir una categoría o un alias no exige desplegar.
-- Esa propiedad del worker original se conserva tal cual.

CREATE TABLE "decision_semantic_category" (
  "id"                     BIGSERIAL     NOT NULL,
  "tenant_id"              BIGINT        NOT NULL,
  "code"                   VARCHAR(120)  NOT NULL,
  "name"                   VARCHAR(200)  NOT NULL,
  "description"            TEXT          NOT NULL,
  "positive_examples"      JSONB         NOT NULL,
  "counter_examples"       JSONB         NOT NULL,
  "restrictions"           JSONB         NOT NULL,
  "related_category_codes" JSONB         NOT NULL,
  "acceptance_threshold"   DECIMAL(4,3)  NOT NULL,
  "version"                INTEGER       NOT NULL DEFAULT 1,
  "is_active"              BOOLEAN       NOT NULL DEFAULT true,

  CONSTRAINT "decision_semantic_category_pkey" PRIMARY KEY ("id"),
  -- Un umbral fuera de [0,1] no es un umbral: con 1.5 la categoría no se acepta
  -- nunca y con -1 se acepta siempre, y en los dos casos el síntoma aparece
  -- lejos de la fila que lo causó.
  CONSTRAINT "decision_semantic_category_threshold_range"
    CHECK ("acceptance_threshold" >= 0 AND "acceptance_threshold" <= 1)
);

CREATE UNIQUE INDEX "decision_semantic_category_tenant_code_key"
  ON "decision_semantic_category" ("tenant_id", "code");
CREATE INDEX "decision_semantic_category_tenant_active_idx"
  ON "decision_semantic_category" ("tenant_id", "is_active");

CREATE TABLE "decision_semantic_entity_alias" (
  "id"             BIGSERIAL    NOT NULL,
  "tenant_id"      BIGINT       NOT NULL,
  "alias"          VARCHAR(200) NOT NULL,
  "canonical_name" VARCHAR(200) NOT NULL,
  "entity_type"    VARCHAR(60)  NOT NULL,
  "is_active"      BOOLEAN      NOT NULL DEFAULT true,

  CONSTRAINT "decision_semantic_entity_alias_pkey" PRIMARY KEY ("id")
);

-- El tipo entra en la clave: «BCP» puede ser un banco y un identificador de
-- producto a la vez, y son entidades distintas.
CREATE UNIQUE INDEX "decision_semantic_entity_alias_tenant_type_alias_key"
  ON "decision_semantic_entity_alias" ("tenant_id", "entity_type", "alias");
CREATE INDEX "decision_semantic_entity_alias_tenant_active_idx"
  ON "decision_semantic_entity_alias" ("tenant_id", "is_active");

CREATE TABLE "decision_semantic_category_embedding" (
  "id"          BIGSERIAL    NOT NULL,
  "category_id" BIGINT       NOT NULL,
  "model"       VARCHAR(120) NOT NULL,
  "version"     INTEGER      NOT NULL DEFAULT 1,
  "vector"      JSONB        NOT NULL,

  CONSTRAINT "decision_semantic_category_embedding_pkey" PRIMARY KEY ("id")
);

-- El modelo forma parte de la clave: vectores de modelos distintos no son
-- comparables, y mezclarlos produce una similitud que parece un número pero no
-- significa nada.
CREATE UNIQUE INDEX "decision_semantic_category_embedding_category_model_key"
  ON "decision_semantic_category_embedding" ("category_id", "model");

ALTER TABLE "decision_semantic_category_embedding"
  ADD CONSTRAINT "decision_semantic_category_embedding_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "decision_semantic_category" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "decision_semantic_tenant_budget" (
  "id"             BIGSERIAL      NOT NULL,
  "tenant_id"      BIGINT         NOT NULL,
  "window_start"   TIMESTAMPTZ(6) NOT NULL,
  "analyses"       INTEGER        NOT NULL DEFAULT 0,
  "provider_calls" INTEGER        NOT NULL DEFAULT 0,

  CONSTRAINT "decision_semantic_tenant_budget_pkey" PRIMARY KEY ("id")
);

-- La clave única es lo que hace atómico el `INSERT … ON CONFLICT DO UPDATE` con
-- el que se reserva consumo. Sin ella, dos réplicas leyendo y escribiendo por
-- separado dejarían pasar más análisis que el presupuesto concedido.
CREATE UNIQUE INDEX "decision_semantic_tenant_budget_tenant_window_key"
  ON "decision_semantic_tenant_budget" ("tenant_id", "window_start");

-- ---------------------------------------------------------------------------
-- Aislamiento por tenant, igual que el resto de tablas con `tenant_id`.
--
-- `decision_semantic_category_embedding` no lleva política propia: no tiene
-- `tenant_id` y su aislamiento lo da la cascada desde la categoría, que sí está
-- bajo RLS. Es la misma forma que ya usa `decision_action_reason_mapping`.
-- ---------------------------------------------------------------------------

ALTER TABLE "decision_semantic_category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_semantic_category" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_semantic_category";
CREATE POLICY tenant_isolation ON "decision_semantic_category"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

ALTER TABLE "decision_semantic_entity_alias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_semantic_entity_alias" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_semantic_entity_alias";
CREATE POLICY tenant_isolation ON "decision_semantic_entity_alias"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

ALTER TABLE "decision_semantic_tenant_budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_semantic_tenant_budget" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "decision_semantic_tenant_budget";
CREATE POLICY tenant_isolation ON "decision_semantic_tenant_budget"
  USING (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::bigint);

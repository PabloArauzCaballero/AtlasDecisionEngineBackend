-- Configuración en tiempo de ejecución del proveedor de modelo del worker semántico.
--
-- Hasta ahora qué gateway atendía el escalón remoto (LiteLLM u OpenRouter) y qué modelo
-- servía cada nivel se decidía SOLO por variables de entorno, así que cambiar de modelo era
-- un redespliegue. Esta tabla permite elegirlo desde el portal; el entorno sigue siendo el
-- valor por omisión cuando no hay fila, de modo que ningún despliegue existente cambia.
--
-- Es GLOBAL por despliegue, no por tenant, y a propósito: el proveedor de modelo es una
-- propiedad del proceso —como lo era la variable de entorno que sustituye— y una sola
-- configuración significa un solo proveedor cacheado, un solo lease y una sola caché de
-- clasificación que invalidar. Por eso no lleva `tenant_id` ni política RLS. El acceso
-- lo gobiernan los roles del endpoint, no el aislamiento de filas.
--
-- Aditiva. Rollback operacional: DROP TABLE "decision_semantic_model_setting";
-- DROP TYPE "SemanticModelGateway"; — y el worker vuelve a leer el entorno.

CREATE TYPE "SemanticModelGateway" AS ENUM ('LITELLM', 'OPENROUTER');

CREATE TABLE "decision_semantic_model_setting" (
  "id"         INTEGER                NOT NULL PRIMARY KEY,
  "gateway"    "SemanticModelGateway" NOT NULL,
  "fast_model" VARCHAR(160)           NOT NULL,
  "deep_model" VARCHAR(160)           NOT NULL,
  "version"    INTEGER                NOT NULL DEFAULT 1,
  "updated_by" VARCHAR(160)           NOT NULL,
  "updated_at" TIMESTAMPTZ(6)         NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ(6)         NOT NULL DEFAULT now(),

  -- La tabla es la fila: una configuración por despliegue. El CHECK convierte un
  -- segundo INSERT en un error en vez de en una ambigüedad silenciosa.
  CONSTRAINT "decision_semantic_model_setting_singleton" CHECK ("id" = 1),
  -- Un modelo vacío pasaría la validación de tipo y fallaría en la primera
  -- clasificación, que es el peor sitio para descubrirlo.
  CONSTRAINT "decision_semantic_model_setting_models_present"
    CHECK (length(btrim("fast_model")) > 0 AND length(btrim("deep_model")) > 0)
);

COMMENT ON TABLE "decision_semantic_model_setting" IS
  'Gateway y modelos del escalón remoto del worker semántico, elegidos desde el portal. Global por despliegue; sin fila manda el entorno.';

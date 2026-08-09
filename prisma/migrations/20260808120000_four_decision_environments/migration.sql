-- Cuatro ambientes de decisión: DEV, STAGING, TEST y PROD.
--
-- Antes había tres (`SANDBOX`, `TEST`, `PROD`) y faltaba el escalón que casi
-- toda operación necesita: un ambiente que sea espejo de producción y donde se
-- valide una versión ANTES de que decida sobre clientes reales. Sin él, la
-- última prueba de una versión ocurría en `TEST` —que además es donde el QA Lab
-- mete miles de ejecuciones sintéticas— y el salto siguiente ya era PROD.
--
-- `SANDBOX` se RENOMBRA a `DEV` en vez de crearse al lado: son el mismo
-- ambiente (diseño y exploración, no productivo) con otro nombre. Duplicarlos
-- habría partido en dos el histórico de despliegues y ejecuciones del mismo
-- sitio, que es justo lo que una auditoría no puede permitirse.
--
-- Rollback operacional: renombrar `DEV` de vuelta a `SANDBOX` y desactivar
-- `STAGING` (`status='INACTIVE'`), NUNCA borrarlo — `decision_deployment`,
-- `decision_runtime_binding` y `decision_execution` lo referencian con FK
-- `ON DELETE RESTRICT`, y un borrado dejaría sin explicación las decisiones que
-- ya se sirvieron desde ahí.

-- 1. Estado de versión. El renombrado arrastra solo las filas existentes: no
--    hace falta un UPDATE, y por eso es preferible a añadir un valor nuevo y
--    migrar a mano.
ALTER TYPE "VersionStatus" RENAME VALUE 'DEPLOYED_TO_SANDBOX' TO 'DEPLOYED_TO_DEV';

-- `BEFORE` mantiene el orden del enum alineado con `schema.prisma`
-- (DEV → STAGING → TEST → PROD). El valor NO se usa en esta misma migración:
-- PostgreSQL prohíbe leer un valor de enum recién añadido dentro de la
-- transacción que lo añade.
ALTER TYPE "VersionStatus" ADD VALUE IF NOT EXISTS 'DEPLOYED_TO_STAGING' BEFORE 'DEPLOYED_TO_TEST';

-- 2. Catálogo de ambientes de decisión.
UPDATE "decision_environment"
SET "code" = 'DEV', "name" = 'Development', "environment_type" = 'DEV'
WHERE "code" = 'SANDBOX';

INSERT INTO "decision_environment" ("code", "name", "environment_type", "status", "is_production")
VALUES ('STAGING', 'Staging', 'STAGING', 'ACTIVE', false)
ON CONFLICT ("code") DO NOTHING;

-- 3. Librerías autorizadas (§7). `allowed_environments` guarda códigos de
--    ambiente como texto, así que el renombrado del catálogo no las alcanza.
UPDATE "decision_approved_library"
SET "allowed_environments" = array_replace("allowed_environments", 'SANDBOX', 'DEV')
WHERE 'SANDBOX' = ANY ("allowed_environments");

-- Una librería habilitada en TEST lo queda también en STAGING: STAGING es el
-- ensayo de producción, y si la librería no pudiera usarse ahí, el ensayo no
-- estaría ensayando la versión que se va a desplegar. Las que están limitadas a
-- no-producción (p. ej. `finance`, RESTRICTED) siguen SIN PROD.
UPDATE "decision_approved_library"
SET "allowed_environments" = "allowed_environments" || ARRAY['STAGING']
WHERE 'TEST' = ANY ("allowed_environments")
  AND NOT ('STAGING' = ANY ("allowed_environments"));

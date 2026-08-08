-- Aprovisionamiento idempotente de los roles de lectura y escritura de Atlas.
--
-- Equivalente declarativo de `provision-development-roles.mjs`, para entornos donde el
-- aprovisionamiento lo aplica un proceso controlado (IaC, DBA, pipeline de despliegue) y
-- no un script de Node: producción, preproducción o cualquier base cuyos cambios deban
-- quedar auditados.
--
-- NO contiene contraseñas. Las credenciales se fijan aparte, desde el gestor de secretos:
--
--   ALTER ROLE atlas_writer WITH PASSWORD '<secreto>';
--   ALTER ROLE atlas_reader WITH PASSWORD '<secreto>';
--
-- Uso:
--
--   psql "$POSTGRES_ADMIN_URL" \
--     -v writer=atlas_writer -v reader=atlas_reader -v schema=public -v owner=atlas \
--     -f scripts/postgres/provision-roles.sql
--
-- Reejecutable: no duplica roles, no acumula permisos y reafirma los atributos en cada
-- corrida, de modo que un privilegio concedido a mano queda revertido.
--
-- Nota de implementación: la creación condicional usa `\gexec` en vez de un bloque
-- `DO $$ … $$`, porque psql no interpola sus variables dentro de una cadena entrecomillada
-- con dólares — el bloque recibiría el texto literal `:'writer'`.

\if :{?writer} \else \set writer atlas_writer \endif
\if :{?reader} \else \set reader atlas_reader \endif
\if :{?schema} \else \set schema public \endif
\if :{?owner}  \else \set owner :USER \endif

\set ON_ERROR_STOP on

-- 1. Roles ------------------------------------------------------------------
SELECT format('CREATE ROLE %I LOGIN', candidate)
FROM (VALUES (:'writer'), (:'reader')) AS wanted(candidate)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = candidate)
\gexec

-- Atributos reafirmados en cada corrida: SUPERUSER o BYPASSRLS concedidos a mano vuelven
-- a quitarse. Un rol de aplicación que salte la RLS anula el aislamiento por tenant.
ALTER ROLE :"writer" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE :"reader" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- 2. Acceso a la base y al esquema -------------------------------------------
GRANT CONNECT ON DATABASE :"DBNAME" TO :"writer", :"reader";
GRANT USAGE ON SCHEMA :"schema" TO :"writer", :"reader";

-- 3. Objetos existentes -------------------------------------------------------
-- El lector se limpia antes de concederle SELECT, para que el estado final no dependa de
-- cómo estuviera al empezar.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA :"schema" FROM :"reader";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA :"schema" FROM :"reader";
GRANT SELECT ON ALL TABLES IN SCHEMA :"schema" TO :"reader";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA :"schema" TO :"writer";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA :"schema" TO :"writer";

-- 4. Objetos futuros ----------------------------------------------------------
-- Dependen del rol QUE CREA los objetos: sin el `FOR ROLE` correcto, la tabla de la
-- próxima migración nace sin permisos y la aplicación falla justo después de desplegar.
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA :"schema"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"writer";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA :"schema"
  GRANT SELECT ON TABLES TO :"reader";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA :"schema"
  GRANT USAGE, SELECT ON SEQUENCES TO :"writer";

-- 5. Cadena de auditoría append-only ------------------------------------------
-- El escritor inserta, nunca modifica ni borra. Espeja lo que la migración
-- 20260719080000 aplica al rol `atlas_app` y refuerza los disparadores existentes.
-- Condicionado a que la tabla exista, para que el script pueda correr antes de migrar.
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON %I.%I FROM %I', schemaname, tablename, :'writer')
FROM pg_tables
WHERE schemaname = :'schema' AND tablename = 'decision_audit_event'
\gexec

-- 6. Verificación --------------------------------------------------------------
-- Se pregunta al motor; no se da por hecho que el GRANT surtió efecto.
WITH scoped AS (
  SELECT schemaname || '.' || quote_ident(tablename) AS ref
  FROM pg_tables WHERE schemaname = :'schema'
)
SELECT
  :'writer' AS role,
  count(*) FILTER (WHERE has_table_privilege(:'writer', ref, 'SELECT')) AS can_select,
  count(*) FILTER (WHERE has_table_privilege(:'writer', ref, 'INSERT')) AS can_write
FROM scoped
UNION ALL
SELECT
  :'reader',
  count(*) FILTER (WHERE has_table_privilege(:'reader', ref, 'SELECT')),
  count(*) FILTER (WHERE has_table_privilege(:'reader', ref, 'INSERT')
                      OR has_table_privilege(:'reader', ref, 'UPDATE')
                      OR has_table_privilege(:'reader', ref, 'DELETE'))
FROM scoped;

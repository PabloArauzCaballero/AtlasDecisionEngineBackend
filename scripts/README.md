# Scripts de ingeniería y operación local

Esta carpeta contiene utilidades reproducibles que apoyan migraciones, bootstrap de RLS y smoke
tests. A nivel de negocio reducen errores manuales en entrega y validación; a nivel de sistema
automatizan comprobaciones que no pertenecen al proceso HTTP de la API.

| Archivo | Por qué existe |
|---|---|
| `validate-migrations.py` | Comprueba deriva schema/SQL, nombres, enums y cobertura RLS por tenant. |
| `validate-baseline.py` / `generate-baseline-sql.py` | Conservan herramientas históricas de verificación de la línea base; no reemplazan Prisma Migrate. |
| `set-app-db-role.mjs` | Configura la contraseña del rol no superusuario que hace efectiva la RLS. |
| `smoke.*` | Ejecuta el mismo escenario de salud, catálogo y runtime desde PowerShell, Bash o Node. |

Ningún script autoriza resetear una base compartida ni introducir secretos en el repositorio.

-- Tres estados nuevos del ciclo de vida de una ejecución, y NADA MÁS.
--
-- Va en una migración propia por una restricción de PostgreSQL que no perdona:
-- `ALTER TYPE … ADD VALUE` es admisible dentro de una transacción (12+), pero el
-- valor añadido **no puede usarse en esa misma transacción**. Prisma envuelve
-- cada migración en una, y la siguiente (`…_statement_review_triage`) declara
-- restricciones CHECK que nombran estos tres valores: juntas, la migración
-- aborta con «unsafe use of new value of enum type». Separarlas es la única
-- forma de que ambas se apliquen.
--
-- Qué significan, y por qué el ciclo de vida no tenía sitio para ellos:
--
--   · `PENDING_REVIEW` — el motor llegó hasta donde pudo y la duda que queda es
--     real. No es un fallo. Antes esto se escribía como `FAILED`, de modo que un
--     extracto legítimo con el encabezado ilegible y un contrato subido por error
--     eran indistinguibles en la tabla, en las métricas y en la pantalla.
--   · `IN_REVIEW` — alguien lo reclamó. Existe para que dos analistas no gasten
--     su tiempo en el mismo caso sin enterarse.
--   · `PDF_INVALID` — hay evidencia suficiente de que el documento no es lo que
--     este worker procesa. Terminal, registrado, y **fuera de la cola**.
ALTER TYPE "WorkerRunStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "WorkerRunStatus" ADD VALUE IF NOT EXISTS 'IN_REVIEW';
ALTER TYPE "WorkerRunStatus" ADD VALUE IF NOT EXISTS 'PDF_INVALID';

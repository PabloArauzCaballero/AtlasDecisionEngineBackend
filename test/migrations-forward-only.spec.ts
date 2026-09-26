/**
 * P-17 · Rollback: las migraciones del motor desde el plan de cumplimiento son ADITIVAS.
 *
 * Prisma no tiene `down`. La política del repositorio es corrección hacia adelante (ver
 * `docs/operations/restore-runbook.md`, «Rollback»): revertir la aplicación a la versión anterior
 * debe funcionar SIN tocar el esquema, y eso sólo es cierto si cada migración nueva es aditiva —
 * columnas nulables o con valor por omisión, tablas, índices y CHECK que las filas existentes ya
 * cumplen— y no reescribe ni borra datos. Borrar `consent_version` o `enabling_basis_policy` para
 * «deshacer» sería destruir la evidencia de bajo qué base y texto se decidió.
 *
 * Esta prueba lee cada migración desde `FORWARD_ONLY_SINCE` y falla ante cualquier sentencia que
 * destruya o reescriba hechos. Una excepción justificada va en `ALLOWED`, con motivo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
/** Primera migración del plan de cumplimiento (P-09/P-10). */
const FORWARD_ONLY_SINCE = '20260924000000';
/** carpeta → motivo. Vacío: ninguna migración nueva necesita destruir nada. */
const ALLOWED: Record<string, string> = {};

const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
  [/\bDROP\s+COLUMN\b/i, 'DROP COLUMN'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bDELETE\s+FROM\b/i, 'DELETE'],
  [/\bUPDATE\s+"?\w+"?\s+SET\b/i, 'UPDATE (reescritura de datos)'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, 'cambio de tipo de columna'],
  [/\bRENAME\s+(COLUMN|TO)\b/i, 'RENAME (rompe la versión anterior)'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL\b/i, 'SET NOT NULL sobre columna existente'],
];

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Devuelve las violaciones de una migración: sentencias destructivas o columnas no compatibles. */
function forwardOnlyViolations(sql: string): string[] {
  const body = stripComments(sql);
  const violations = DESTRUCTIVE.filter(([pattern]) => pattern.test(body)).map(([, what]) => what);
  // Una columna nueva NOT NULL sin DEFAULT rompe los INSERT de la versión anterior de la aplicación.
  for (const match of body.matchAll(
    /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?([^,;]*)/gi,
  )) {
    const definition = match[2] ?? '';
    if (/\bNOT\s+NULL\b/i.test(definition) && !/\bDEFAULT\b/i.test(definition)) {
      violations.push(`ADD COLUMN ${match[1]} NOT NULL sin DEFAULT`);
    }
  }
  return violations;
}

const newMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name >= FORWARD_ONLY_SINCE)
  .map((entry) => entry.name)
  .sort();

describe('migraciones del plan de cumplimiento: sólo hacia adelante (P-17)', () => {
  it('hay migraciones que vigilar desde el corte (el filtro no está vacío por error)', () => {
    expect(newMigrations).toContain('20260924120000_enabling_basis_and_output_policy_range');
  });

  it.each(newMigrations)(
    '%s es aditiva: no borra, no reescribe y la versión anterior sigue funcionando',
    (dir) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8');
      const violations = forwardOnlyViolations(sql);
      if (ALLOWED[dir]) return;
      expect(violations).toEqual([]);
    },
  );

  it('el detector reconoce lo que destruiría hechos (la prueba no es un verde vacío)', () => {
    expect(
      forwardOnlyViolations('ALTER TABLE "subject_consent" DROP COLUMN "consent_version";'),
    ).toContain('DROP COLUMN');
    expect(forwardOnlyViolations('DELETE FROM "decision_execution" WHERE true;')).toContain(
      'DELETE',
    );
    expect(forwardOnlyViolations('UPDATE "credit_facility" SET "principal_amount" = 0;')).toContain(
      'UPDATE (reescritura de datos)',
    );
    expect(forwardOnlyViolations('ALTER TABLE "x" ADD COLUMN "y" VARCHAR(10) NOT NULL;')).toContain(
      'ADD COLUMN y NOT NULL sin DEFAULT',
    );
    expect(
      forwardOnlyViolations(
        'ALTER TABLE "x" ADD COLUMN "y" JSONB; -- DROP TABLE en un comentario no cuenta\nALTER TABLE "x" ADD COLUMN "z" INT NOT NULL DEFAULT 0;',
      ),
    ).toEqual([]);
  });
});

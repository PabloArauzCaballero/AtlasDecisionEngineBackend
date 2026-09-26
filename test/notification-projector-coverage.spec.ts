/**
 * Todo evento que el proyector de notificaciones sabe traducir tiene que tener un emisor.
 *
 * `version.published` estaba declarado en el catálogo, tenía contrato de payload y una rama
 * en el proyector que avisaba a operaciones... y nadie lo emitía nunca: el despliegue
 * escribía `DEPLOYMENT_ACTIVATED`, un nombre distinto. La rama era inalcanzable y el aviso
 * "versión publicada" no llegaba a nadie, sin que nada fallara.
 *
 * Es la misma clase de deriva por nombres que describe CLAUDE.md para los roles: no es una
 * errata, es una funcionalidad que desaparece en silencio. Esta prueba la convierte en un
 * fallo visible.
 *
 * Lo detectó el smoke integral (`inbox.notifications-list` del operador).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DecisionEventType } from '../src/common/events/event-types';

const MODULES_DIR = join(__dirname, '..', 'src', 'modules');
const PROJECTOR = join(
  __dirname,
  '..',
  'src',
  'modules',
  'notifications',
  'notification-projector.service.ts',
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('proyector de notificaciones', () => {
  const projector = readFileSync(PROJECTOR, 'utf8');
  const handled = [...projector.matchAll(/case DecisionEventType\.([A-Z_]+)/g)].map((m) => m[1]);
  const allSources = sourceFiles(MODULES_DIR)
    .filter((file) => !file.includes('notification-projector'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('maneja al menos los eventos de gobierno, despliegue y seguridad', () => {
    expect(handled).toContain('VERSION_SUBMITTED_FOR_REVIEW');
    expect(handled).toContain('VERSION_APPROVED');
    expect(handled).toContain('VERSION_PUBLISHED');
    expect(handled).toContain('SECURITY_RISK_DETECTED');
  });

  it.each(handled)('el evento %s lo emite alguien', (name) => {
    const value = DecisionEventType[name as keyof typeof DecisionEventType];
    // Vale cualquiera de las dos formas de citarlo: por la constante o por su valor literal.
    const emitted =
      allSources.includes(`DecisionEventType.${name}`) || allSources.includes(`'${value}'`);
    expect(emitted).toBe(true);
  });
});

/**
 * Traduce una marca a variables CSS.
 *
 * Es el único punto donde un color de la marca se convierte en texto para el navegador. Que
 * sea uno solo es lo que permite que ningún `.hbs` ni ninguna hoja escriba un `#0f172a` a
 * mano: las plantillas usan `var(--ink)` y la marca decide qué vale. Un color literal dentro
 * de un template convierte ese documento en propiedad de una organización concreta.
 *
 * Los valores se vuelven a validar aquí aunque `assertBrand` ya lo hiciera al registrarla. No
 * es redundancia por gusto: esta función produce texto que se inserta en un `<style>`, y una
 * cadena con `;` o `}` cerraría la regla y abriría una nueva. La marca la configura un
 * operador, pero la barrera se pone donde ocurre el daño, no donde se confía.
 */
import type { DocumentBrand } from '../../domain/value-objects/document-brand';
import type { FontFaceBundle } from '../ports/font-provider.port';

const SAFE_VALUE = /^[#a-zA-Z0-9 ,.'"()%_-]{1,200}$/;

function safe(value: string, fallback: string): string {
  return SAFE_VALUE.test(value) ? value : fallback;
}

/** Bloque `:root` con la paleta, la tipografía y el espaciado de la marca. */
export function brandTokensCss(brand: DocumentBrand, fonts: FontFaceBundle): string {
  const { palette, typography, spacing } = brand;
  const declarations: readonly [string, string][] = [
    ['--ink', safe(palette.ink, '#111827')],
    ['--ink-muted', safe(palette.inkMuted, '#4b5563')],
    ['--accent', safe(palette.accent, '#1d4ed8')],
    ['--surface', safe(palette.surface, '#ffffff')],
    ['--surface-muted', safe(palette.surfaceMuted, '#f3f4f6')],
    ['--line', safe(palette.line, '#d1d5db')],
    ['--positive', safe(palette.positive, '#047857')],
    ['--caution', safe(palette.caution, '#b45309')],
    ['--critical', safe(palette.critical, '#b91c1c')],
    // La pila la manda el proveedor de fuentes, no la marca: es quien sabe cuál se ha
    // embebido de verdad. La familia de la marca queda delante como preferencia.
    ['--font-sans', safe(`${typography.fontFamily}, ${fonts.fontFamily}`, fonts.fontFamily)],
    ['--font-mono', safe(`${typography.monoFamily}, ${fonts.monoFamily}`, fonts.monoFamily)],
    ['--type-base', `${clamp(typography.baseSizePt, 6, 24)}pt`],
    ['--leading', String(clamp(typography.lineHeight, 1, 2.5))],
    ['--gap-block', safe(spacing.blockGap, '4mm')],
    ['--gap-section', safe(spacing.sectionGap, '8mm')],
    ['--cell-pad-y', safe(spacing.cellPaddingY, '1.6mm')],
    ['--cell-pad-x', safe(spacing.cellPaddingX, '2.4mm')],
  ];
  const body = declarations.map(([name, value]) => `  ${name}: ${value};`).join('\n');
  return `:root {\n${body}\n}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

import {
  BANK_STATEMENT_FIXTURES,
  fixtureReferenceDate,
} from '../src/modules/workers/bank-statement/fixtures/bank-statement-fixtures';

/**
 * OBS-31 (QA 2026-10-29): los escenarios de ejemplo estaban fechados enero–marzo de 2026 y, con la
 * compuerta de vigencia, hoy terminaban todos en «Extracto vencido». Ahora siguen al calendario.
 */
describe('escenarios del worker de extractos: ventana móvil', () => {
  const original = process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE;
  afterEach(() => {
    if (original === undefined) delete process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE;
    else process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = original;
  });

  const vistaPrevia = (code: string) =>
    BANK_STATEMENT_FIXTURES.find((f) => f.code === code)!.preview;

  it('con una fecha a mitad de año, la ventana son los tres últimos meses completos', () => {
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-10-29T21:00:00Z';
    expect(vistaPrevia('valid-basic')).toContain('julio a septiembre 2026');
  });

  it('el límite de año se ve en la etiqueta (noviembre 2025 a enero 2026)', () => {
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-02-10T15:00:00Z';
    expect(vistaPrevia('valid-basic')).toContain('noviembre 2025 a enero 2026');
  });

  it('el mes se mide en hora de Bolivia: el 1 de octubre a las 22:00 en La Paz sigue siendo septiembre', () => {
    // 22:00 en La Paz = 02:00 UTC del día 2.
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-10-02T02:00:00Z';
    expect(vistaPrevia('valid-basic')).toContain('julio a septiembre 2026');
    // 23:00 del 30/09 en La Paz = 03:00 UTC del 1/10: el mes completo todavía es agosto.
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-10-01T03:00:00Z';
    expect(vistaPrevia('valid-basic')).toContain('junio a agosto 2026');
  });

  it('los bytes cambian con la ventana pero son los mismos dentro de un mismo mes', () => {
    const fixture = BANK_STATEMENT_FIXTURES.find((f) => f.code === 'valid-basic')!;
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-10-05T12:00:00Z';
    const a = fixture.build();
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-10-28T12:00:00Z';
    const b = fixture.build();
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = '2026-11-02T12:00:00Z';
    const c = fixture.build();
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('una fecha de referencia ilegible cae al reloj real en vez de romper', () => {
    process.env.BANK_STATEMENT_FIXTURES_REFERENCE_DATE = 'no-es-una-fecha';
    expect(Number.isNaN(fixtureReferenceDate().getTime())).toBe(false);
  });
});

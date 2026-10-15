import { countLines, evaluate, isExempt, LIMIT } from '../scripts/check-file-size';

describe('check-file-size (trinquete)', () => {
  it('exime migraciones, seeders, fixtures, constants y generados', () => {
    expect(isExempt('src/database/migrations/2026-x.ts')).toBe(true);
    expect(isExempt('src/a/fixtures/x.ts')).toBe(true);
    expect(isExempt('src/a/b.constants.ts')).toBe(true);
    expect(isExempt('src/a/b.generated.ts')).toBe(true);
    expect(isExempt('src/a/b.service.ts')).toBe(false);
  });

  it('cuenta líneas y descuenta la cabecera @file/@business/@system', () => {
    expect(countLines('a\nb\nc')).toBe(3);
    expect(countLines('/**\n * @file x\n * @business y\n * @system z\n */\na\nb')).toBe(2);
  });

  it('error si un archivo nuevo supera el límite o la deuda crece', () => {
    const current = new Map([
      ['src/nuevo.ts', LIMIT + 1],
      ['src/viejo.ts', 410],
    ]);
    const { errors } = evaluate(current, { 'src/viejo.ts': 400 });
    expect(errors).toHaveLength(2);
  });

  it('informa mejoras y no falla si la deuda adelgaza o desaparece', () => {
    const { errors, warnings, improvements } = evaluate(new Map([['src/viejo.ts', 350]]), {
      'src/viejo.ts': 400,
      'src/borrado.ts': 500,
    });
    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(improvements).toHaveLength(2);
  });
});

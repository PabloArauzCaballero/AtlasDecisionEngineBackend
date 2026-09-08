import { describe, expect, it } from '@jest/globals';
import { normalizeNumeric } from '../src/modules/workers/bank-statement/core/parsers/parser-helpers';

/**
 * `normalizeNumeric` es a la vez conversor y FILTRO: recorre las fichas de una línea y descarta las
 * que no son cifras. El PDF de Banco Económico agrupa los millares con el carácter de control 0x0F
 * (Shift In) en vez de una coma, así que TODO saldo >= 10 000 quedaba fuera del patrón y devolvía
 * cadena vacía. El efecto era catastrófico y silencioso: en cuanto el saldo de una cuenta cruza los
 * 10 000, el parser deja de reconocer sus movimientos, el extracto se lee como vencido y sin
 * cobertura, y el cliente se queda sin línea de crédito con un extracto perfectamente válido.
 */
const SI = String.fromCharCode(0x0f); // separador de miles real del PDF de Banco Económico

describe('normalizeNumeric — separador de miles de control (Banco Económico)', () => {
  it('limpia el 0x0F que Banco Económico usa como separador de miles', () => {
    expect(normalizeNumeric(`12${SI}154.41`)).toBe('12154.41');
    expect(normalizeNumeric(`-1${SI}234${SI}567.89`)).toBe('-1234567.89');
  });

  it('sigue aceptando los formatos normales (coma de miles, negativos, decimales)', () => {
    expect(normalizeNumeric('715.12')).toBe('715.12');
    expect(normalizeNumeric('-257.40')).toBe('-257.40');
    expect(normalizeNumeric('1,234.56')).toBe('1234.56');
    expect(normalizeNumeric('0.00')).toBe('0.00');
  });

  it('sigue descartando lo que no es una cifra (mantiene su papel de filtro)', () => {
    expect(normalizeNumeric('Bs')).toBe('');
    expect(normalizeNumeric('DEBITO ACH QR')).toBe('');
    expect(normalizeNumeric('')).toBe('');
  });
});

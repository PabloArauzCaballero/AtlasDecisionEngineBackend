import type { BankTransaction } from '../../domain/models';

export function normalizeNumeric(value: string): string {
  // Los caracteres de control C0 (0x00–0x1F) se eliminan como separador de miles: el PDF de Banco
  // Económico agrupa los millares con 0x0F (Shift In) en lugar de una coma —`12‹SI›154.41`—, así que
  // TODO saldo de cinco cifras o más (>= 10 000) quedaba fuera del patrón numérico y devolvía cadena
  // vacía. El efecto era silencioso y catastrófico: una cuenta cuyo saldo cruza los 10 000 pierde
  // todos sus movimientos a partir de ahí, y el extracto se lee como vencido y sin cobertura. `\s` no
  // los cubre (0x0F no es espacio). No se tocan la coma ni el punto decimal.
  const normalized = value
    .trim()
    .replace(/[+]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s/g, '')
    .replace(/,/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return '';
  }
  return Number(normalized).toFixed(2);
}

/**
 * Normaliza un importe que viaja con su divisa pegada en la misma ficha de
 * texto: `-Bs 50.00`, `+Bs 1,234.56`, `Bs 0.00`.
 *
 * Se separa de `normalizeNumeric()` en lugar de ampliarla porque esa función
 * también hace de filtro: es la que descarta las fichas que **no** son cifras al
 * recorrer una línea. Si aceptara rótulos de divisa, un encabezado como
 * `Monto (Bs)` empezaría a colarse como valor en todos los analizadores.
 *
 * Devuelve cadena vacía si la ficha no tiene exactamente esa forma.
 */
export function normalizeLabeledAmount(value: string): string {
  const match = value.trim().match(/^([+-]?)\s*(?:Bs|\$us|USD)\s*([\d,]+(?:\.\d{1,2})?)$/i);
  if (!match) return '';
  return normalizeNumeric(`${match[1] ?? ''}${match[2] ?? ''}`);
}

export function splitAmount(amount: string): Pick<BankTransaction, 'debit' | 'credit' | 'amount'> {
  const normalized = normalizeNumeric(amount);
  if (!normalized) {
    return { debit: '', credit: '', amount: '' };
  }
  const numeric = Number(normalized);
  return {
    debit: numeric < 0 ? Math.abs(numeric).toFixed(2) : '',
    credit: numeric > 0 ? numeric.toFixed(2) : '',
    amount: numeric.toFixed(2),
  };
}

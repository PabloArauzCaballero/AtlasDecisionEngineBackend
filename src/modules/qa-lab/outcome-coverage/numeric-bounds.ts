import { resolvedConstraintsOf, type GeneratorContractVariable } from '../contract-value-factory';
import type { SeededRandom } from '../seeded-random';

/** Intervalo cerrado admisible para una variable numérica, tal como lo dejan las ramas. */
export interface Bounds {
  min?: number;
  max?: number;
}

/**
 * Un valor dentro del intervalo que exigieron las ramas, sin salirse del contrato.
 *
 * Se sortea en vez de devolver el borde: dos casos de la misma rama tienen que ser dos
 * casos. Si el intervalo se queda en un único valor —o del revés, vacío—, se entrega ese
 * y `verifyPath` dirá después si la rama se cumple; inventar aquí un valor fuera sería
 * peor, porque el caso dejaría de respetar el contrato.
 */
export function drawWithin(
  variable: GeneratorContractVariable,
  range: Bounds,
  random: SeededRandom,
): number {
  const contract = resolvedConstraintsOf(variable);
  const entero = String(variable.dataType).toUpperCase() === 'INTEGER';
  const suelo = mayor(range.min, contract.min);
  const techo = menor(range.max, contract.max);

  // Con un solo extremo, el otro se abre una ventana proporcional al propio valor: sin
  // ella habría que sortear entre un mínimo y el mayor entero seguro, y saldrían importes
  // de catorce cifras que no se parecen a ningún dato real.
  const lo = suelo ?? (techo !== undefined ? techo - ventana(techo, entero) : 0);
  const hi = techo ?? (suelo !== undefined ? suelo + ventana(suelo, entero) : 0);
  if (!(hi > lo)) return round(hi);

  const bruto = lo + random.next() * (hi - lo);
  const valor = entero ? Math.round(bruto) : Number(bruto.toFixed(2));
  return round(Math.min(hi, Math.max(lo, valor)));
}

function ventana(referencia: number, entero: boolean): number {
  const ancho = Math.max(entero ? 10 : 1, Math.abs(referencia));
  return entero ? Math.round(ancho) : ancho;
}

export function mayor(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

export function menor(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * El intervalo que impone una desigualdad, o `null` si el operador no es de orden.
 *
 * Los límites abiertos se cierran con el paso del tipo: `> 750` sobre un entero es
 * `>= 751`, y sobre un decimal de dos cifras, `>= 750.01`. Trabajar con intervalos
 * cerrados deja el sorteo posterior en una sola cuenta.
 */
export function boundFor(
  operator: string,
  expected: unknown,
  target: boolean,
  variable: GeneratorContractVariable,
): Bounds | null {
  const numero = typeof expected === 'number' ? expected : Number(expected);
  if (!Number.isFinite(numero)) return null;
  const paso = String(variable.dataType).toUpperCase() === 'INTEGER' ? 1 : 0.01;

  switch (operator) {
    // `gt` cierto ⇒ estrictamente mayor; `gt` falso ⇒ menor o igual, y así las cuatro.
    case 'gt':
      return target ? { min: round(numero + paso) } : { max: numero };
    case 'gte':
      return target ? { min: numero } : { max: round(numero - paso) };
    case 'lt':
      return target ? { max: round(numero - paso) } : { min: numero };
    case 'lte':
      return target ? { max: numero } : { min: round(numero + paso) };
    default:
      return null;
  }
}

export function round(value: number): number {
  return Number(value.toFixed(10));
}

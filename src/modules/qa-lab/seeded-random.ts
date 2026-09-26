/**
 * Generador pseudoaleatorio determinista para el QA Lab (§10.5).
 *
 * No se usa `Math.random`: una corrida tiene que poder reproducirse bit a bit a partir
 * de su semilla, y eso es imposible con una fuente que el proceso no controla. Tampoco
 * se usa Faker en producción: Faker es una dependencia de DESARROLLO y su algoritmo
 * puede cambiar entre versiones menores, lo que rompería la reproducibilidad de una
 * corrida archivada. Aquí el algoritmo está congelado en el repositorio y versionado.
 */
/**
 * 1.2.0: la generación pasa a respetar `pattern`, `format`, `precision`, `itemType` y los
 * límites de longitud, y los bordes se criban contra el contrato. Para la misma semilla,
 * un contrato que declare esas restricciones ya no produce los mismos valores que en
 * 1.1.0, así que la versión sube: una corrida archivada dice con qué versión se generó.
 */
export const GENERATOR_VERSION = 'atlas-qa-generator-1.2.0';

/**
 * Formas de distribución admitidas al generar un valor dentro de su rango (§10.4).
 *
 * Es un catálogo CERRADO, como el de operaciones de los campos calculados: una corrida
 * archivada tiene que poder reejecutarse años después, y eso exige que la forma sea un
 * nombre estable del repositorio y no una función que el usuario escriba.
 */
export const DISTRIBUTION_SHAPES = [
  'UNIFORM',
  'LOW_TAIL',
  'HIGH_TAIL',
  'CENTERED',
  'EXTREMES',
] as const;

export type DistributionShape = (typeof DISTRIBUTION_SHAPES)[number];

/** Mulberry32: pequeño, rápido y con periodo suficiente para lotes de miles de casos. */
export class SeededRandom {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  /** Flotante en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /**
   * Flotante en [0, 1) deformado según la distribución pedida (§10.4).
   *
   * `UNIFORM` devuelve `next()` tal cual y consume exactamente un valor del flujo, así que
   * una corrida sin distribuciones sigue siendo bit a bit la misma que antes de existir
   * esta función. Las demás formas son transformaciones deterministas de ese mismo flujo;
   * `CENTERED` consume dos porque una triangular es la suma de dos uniformes.
   */
  unit(shape: DistributionShape = 'UNIFORM'): number {
    switch (shape) {
      // u² acumula masa cerca de 0: la cola baja del rango, que es donde suelen estar
      // los casos raros (ingresos mínimos, plazos cortos) que un reparto uniforme
      // infrarrepresenta.
      case 'LOW_TAIL': {
        const u = this.next();
        return u * u;
      }
      // La simétrica de la anterior: √u acumula masa cerca de 1.
      case 'HIGH_TAIL':
        return Math.sqrt(this.next());
      case 'CENTERED':
        return (this.next() + this.next()) / 2;
      // Empuja hacia AMBOS extremos y vacía el centro: sirve para castigar los umbrales
      // por los dos lados en una sola corrida.
      case 'EXTREMES': {
        const centered = this.next() * 2 - 1;
        return (Math.sign(centered) * Math.sqrt(Math.abs(centered)) + 1) / 2;
      }
      default:
        return this.next();
    }
  }

  /** Entero en [min, max], ambos inclusive. */
  int(min: number, max: number, shape: DistributionShape = 'UNIFORM'): number {
    if (max <= min) return min;
    return min + Math.floor(this.unit(shape) * (max - min + 1));
  }

  /** Flotante en [min, max) redondeado a `decimals`. */
  float(min: number, max: number, decimals = 2, shape: DistributionShape = 'UNIFORM'): number {
    const value = min + this.unit(shape) * (max - min);
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  /**
   * Elige un valor con pesos relativos. Un peso ausente vale 1, de modo que declarar el
   * peso de un solo valor ya lo sesga frente a los demás sin tener que enumerarlos todos.
   * Los pesos negativos se descartan (cuentan como 0); si todos quedan a 0 se reparte
   * uniformemente, porque no elegir nada no es una opción para un generador.
   */
  pickWeighted<T>(values: readonly T[], weightOf: (value: T) => number): T {
    const weights = values.map((value) => {
      const weight = weightOf(value);
      return Number.isFinite(weight) && weight > 0 ? weight : 0;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(values);
    let threshold = this.next() * total;
    for (let index = 0; index < values.length; index += 1) {
      threshold -= weights[index];
      if (threshold < 0) return values[index];
    }
    return values[values.length - 1];
  }

  bool(probabilityTrue = 0.5): boolean {
    return this.next() < probabilityTrue;
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length) % values.length];
  }

  /** Cadena de longitud exacta a partir de un alfabeto estable. */
  string(length: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'): string {
    let out = '';
    for (let index = 0; index < length; index += 1) out += this.pick([...alphabet]);
    return out;
  }

  /** Fecha ISO entre dos años, determinista y siempre válida. */
  isoDate(fromYear = 1950, toYear = 2030): string {
    const year = this.int(fromYear, toYear);
    const month = this.int(1, 12);
    // Se acota a 28 para que ningún mes produzca una fecha inexistente.
    const day = this.int(1, 28);
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  }
}

/** Semilla legible y estable, apta para guardar y volver a ejecutar. */
export function generateSeed(source: string): string {
  return hashSeed(source).toString(36).padStart(7, '0');
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

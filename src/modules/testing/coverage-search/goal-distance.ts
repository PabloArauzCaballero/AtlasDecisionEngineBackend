import {
  isLiteral,
  isRecord,
  literalValue,
  referencedNames,
  variableName,
  COMPARISONS,
} from './expression-nodes';
import { MAX_INLINE_DEPTH, type ShadowModel } from './shadow-model';

/** Lo que cuesta, en distancia, un objetivo no numérico sin cumplir. */
const MISS = 1;
/** Una comparación entre dos constantes que no se cumple: ningún cambio de la entrada la arregla. */
const UNREACHABLE = 1_000_000;

/** Mide cuánto falta para que una condición valga lo que se quiere, sobre el modelo en sombra. */
export class GoalDistance {
  constructor(private readonly shadow: ShadowModel) {}

  /** Cuánto falta para que `expression` valga `truth`: 0 si ya vale. */
  distance(
    expression: unknown,
    truth: boolean,
    context: Record<string, unknown>,
    depth = 0,
  ): number {
    const node = this.shadow.inline(expression, depth);
    if (!isRecord(node) || isLiteral(node) || variableName(node)) {
      return Boolean(this.shadow.safe(node, context)) === truth ? 0 : MISS;
    }
    const op = String(node.op ?? '').toLowerCase();
    const args = Array.isArray(node.args) ? node.args : [];
    const each = (target: boolean) =>
      args.map((arg) => this.distance(arg, target, context, depth + 1));
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const least = (values: number[]) => (values.length ? Math.min(...values) : MISS);
    if (op === 'and') return truth ? sum(each(true)) : least(each(false));
    if (op === 'or') return truth ? least(each(true)) : sum(each(false));
    if (op === 'not') return this.distance(node.arg ?? args[0], !truth, context, depth + 1);
    if (op === 'if') {
      // Un `si` usado como condición: se cumple por la rama del «entonces» o por la del «si no».
      return Math.min(
        this.distance(node.condition, true, context, depth + 1) +
          this.distance(node.then, truth, context, depth + 1),
        this.distance(node.condition, false, context, depth + 1) +
          this.distance(node.else, truth, context, depth + 1),
      );
    }
    if (COMPARISONS.has(op))
      return this.comparison(
        op,
        node.left ?? args[0],
        node.right ?? args[1],
        truth,
        context,
        depth,
      );
    if (op === 'in' || op === 'not_in') {
      const options = literalValue(node.right ?? args[1]);
      if (Array.isArray(options) && options.length) {
        const wanted = op === 'in' ? truth : !truth;
        const keys = new Set(options.map((option) => JSON.stringify(option)));
        return this.membership(
          node.left ?? args[0],
          (value) => keys.has(JSON.stringify(value)) === wanted,
          context,
          depth + 1,
        );
      }
    }
    return Boolean(this.shadow.safe(node, context)) === truth ? 0 : MISS;
  }

  /**
   * Cuánto falta para que `expression` tome un valor que cumpla `accepts`.
   *
   * Sobre una cadena de «si… si no…» (una banda, un motivo) es UNA pregunta: ¿cuál es la rama
   * permitida más cercana? Medir «no es D» y «no es E» por separado y sumarlos crea una trampa en
   * la frontera: en el límite entre D y E uno empuja hacia E y el otro hacia D, y ninguno sale.
   */
  private membership(
    expression: unknown,
    accepts: (value: unknown) => boolean,
    context: Record<string, unknown>,
    depth: number,
  ): number {
    const node = this.shadow.inline(expression, depth);
    if (
      isRecord(node) &&
      String(node.op ?? '').toLowerCase() === 'if' &&
      depth < MAX_INLINE_DEPTH
    ) {
      return Math.min(
        this.distance(node.condition, true, context, depth + 1) +
          this.membership(node.then, accepts, context, depth + 1),
        this.distance(node.condition, false, context, depth + 1) +
          this.membership(node.else, accepts, context, depth + 1),
      );
    }
    if (accepts(this.shadow.safe(node, context))) return 0;
    return referencedNames(node).size === 0 ? UNREACHABLE : MISS;
  }

  private comparison(
    op: string,
    left: unknown,
    right: unknown,
    truth: boolean,
    context: Record<string, unknown>,
    depth: number,
  ): number {
    // Un lado que es un `si` (o una intermedia cuya fórmula lo es) se abre en sus dos ramas:
    // así `banda == "E"` hereda la pendiente del umbral que decide la banda.
    for (const [side, other, flipped] of [
      [left, right, false],
      [right, left, true],
    ] as const) {
      const opened = this.shadow.inline(side, depth);
      if (
        isRecord(opened) &&
        String(opened.op ?? '').toLowerCase() === 'if' &&
        depth < MAX_INLINE_DEPTH
      ) {
        const compare = (branch: unknown) =>
          flipped
            ? this.comparison(op, other, branch, truth, context, depth + 1)
            : this.comparison(op, branch, other, truth, context, depth + 1);
        return Math.min(
          this.distance(opened.condition, true, context, depth + 1) + compare(opened.then),
          this.distance(opened.condition, false, context, depth + 1) + compare(opened.else),
        );
      }
    }
    const a = this.shadow.safe(left, context);
    const b = this.shadow.safe(right, context);
    // Dos constantes: o se cumple o esa rama es imposible. Si costara lo mismo que una condición por
    // corregir, la búsqueda se quedaría en la rama del «si» que devuelve otro literal.
    const constant = referencedNames(left).size === 0 && referencedNames(right).size === 0;
    const miss = constant ? UNREACHABLE : MISS;
    const effective = truth
      ? op
      : { eq: 'neq', neq: 'eq', gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt' }[op];
    if (typeof a === 'number' && typeof b === 'number') {
      const gap =
        {
          eq: Math.abs(a - b),
          neq: a !== b ? 0 : 1,
          gt: a > b ? 0 : b - a + 1,
          gte: a >= b ? 0 : b - a,
          lt: a < b ? 0 : a - b + 1,
          lte: a <= b ? 0 : a - b,
        }[effective as string] ?? MISS;
      if (gap > 0 && constant) return UNREACHABLE;
      // Normalizada a [0, 1): que un objetivo lejano no tape a los demás de un `y`.
      return gap <= 0 ? 0 : gap / (gap + 1);
    }
    const same = JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (effective === 'eq') return same ? 0 : miss;
    if (effective === 'neq') return same ? miss : 0;
    return miss;
  }
}

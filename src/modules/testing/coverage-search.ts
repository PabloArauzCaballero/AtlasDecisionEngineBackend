/**
 * Buscar los casos que recorren TODO el grafo de una versión.
 *
 * Un caso por desenlace (`qa-lab/outcome-coverage.ts`) no basta para la cobertura que exige la
 * revisión: no puede forzar una condición sobre una variable INTERMEDIA —el puntaje que calcula el
 * propio grafo, lo que responde un worker— y deja sin recorrer los nodos que cuelgan de ella.
 *
 * ## Cómo busca
 *
 * Por cada ARISTA sin recorrer se arma su objetivo: las condiciones que hay que cumplir a lo largo
 * de un camino desde el inicio (las de cada arista elegida) y las que hay que incumplir (las de las
 * aristas de más prioridad, que se llevarían la ejecución por otro lado). A cada objetivo se le
 * mide una DISTANCIA: cero si se cumple, y si no, cuánto falta —`x > 180` con `x = 150` está a 30;
 * un `y` suma las distancias de sus partes; un `o`, la menor—. Desde una entrada se cambia una
 * variable cada vez hacia donde la distancia baja, hasta llegar a cero.
 *
 * La distancia se calcula SIN ejecutar el motor: las intermedias se evalúan aquí con el mismo
 * evaluador de expresiones, y una intermedia calculada se sustituye por su fórmula para que haya
 * pendiente (`banda == "E"` no dice nada; `puntaje > 180` sí). El motor sólo corre para CONFIRMAR
 * el caso encontrado, y lo que cuenta como cobertura es lo que el motor recorrió, no lo estimado.
 *
 * Los nodos `WORKER` se gobiernan con dobles (`worker-doubles.ts`): lo que responde el servicio
 * entra a la búsqueda como una variable más, y el caso guarda qué habría respondido.
 *
 * ## Lo que NO promete
 *
 * - Un nodo inalcanzable (una arista que ninguna entrada válida toma) no se cubre: se devuelve en
 *   `missing`, que es justamente un hallazgo sobre el grafo.
 * - La búsqueda tiene presupuesto. Si se agota antes del 100 % se dice cuánto faltó.
 * - Lo que sale es una suite de REGRESIÓN: fija lo que el grafo hace hoy. Avisa si mañana cambia;
 *   no dice si lo que hace hoy es lo que el negocio quería. Eso lo dicen los casos escritos a mano.
 */
import { ExpressionEvaluator } from '../graph/expression-evaluator';
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  WorkerCallSnapshot,
} from '../graph/graph.types';
import { intermediateAssignmentsOf } from '../graph/validators/graph-intermediate.validator';
import { parseWorkerCall } from '../graph/worker-call';
import {
  buildValidValue,
  satisfiesContract,
  type GeneratorContractVariable,
} from '../qa-lab/contract-value-factory';
import { generateBoundaryValue } from '../qa-lab/contract-generator';
import type { SeededRandom } from '../qa-lab/seeded-random';
import type { WorkerDoubles } from './worker-doubles';

export interface CoverageCandidate {
  variables: Record<string, unknown>;
  workerDoubles: WorkerDoubles;
}

export interface CoverageObservation {
  /** Falso si el contrato rechazó la entrada o el motor falló: el caso no sirve para la suite. */
  usable: boolean;
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  terminalNodeKey?: string;
  /** Lo que el caso tendrá que esperar: desenlace, motivos y salidas. */
  actual: Record<string, unknown>;
}

export type Observe = (candidate: CoverageCandidate) => Promise<CoverageObservation>;

export interface CoverageCase {
  candidate: CoverageCandidate;
  observation: CoverageObservation;
}

export interface CoverageSearchResult {
  cases: CoverageCase[];
  executions: number;
  exhaustedBudget: boolean;
  nodes: { covered: string[]; missing: string[]; percentage: number };
  edges: { covered: string[]; missing: string[]; percentage: number };
}

export interface CoverageBudget {
  maxExecutions: number;
  maxMillis: number;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
}

type Goal = { expression: unknown; truth: boolean };

/** Una dimensión de la búsqueda: una variable de entrada, o algo que responde un worker. */
interface Dimension {
  key: string;
  values: unknown[];
  numeric: boolean;
  integer: boolean;
  accepts: (value: unknown) => boolean;
  read: (candidate: CoverageCandidate) => unknown;
  apply: (candidate: CoverageCandidate, value: unknown) => void;
}

const ABSENT = Symbol('ausente');
const COMPARISONS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const NUMERIC_PROBES = [0, 1, 2, 5, 10, 50, 100, 1000, 10_000];
const MAX_CLIMB_STEPS = 60;
const MAX_PATHS_PER_EDGE = 4;
/** Niveles que se abre una cadena de fórmulas y de «si… si no…». Cada nivel abre dos ramas y una suele ser literal: lineal. */
const MAX_INLINE_DEPTH = 64;
/** Lo que cuesta, en distancia, un objetivo no numérico sin cumplir. */
const MISS = 1;
/** Una comparación entre dos constantes que no se cumple: ningún cambio de la entrada la arregla. */
const UNREACHABLE = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(candidate: CoverageCandidate): CoverageCandidate {
  return JSON.parse(JSON.stringify(candidate)) as CoverageCandidate;
}

function variableName(node: unknown): string | null {
  if (!isRecord(node)) return null;
  const raw =
    typeof node.var === 'string'
      ? node.var
      : typeof node.variable === 'string'
        ? node.variable
        : null;
  if (!raw) return null;
  return raw.startsWith('variables.') ? raw.slice('variables.'.length) : raw;
}

function isLiteral(node: unknown): boolean {
  if (node === null || ['string', 'number', 'boolean'].includes(typeof node)) return true;
  // Una lista escrita tal cual (`x in ["A", "B"]`) también es un literal.
  if (Array.isArray(node)) return node.every((item) => item === null || typeof item !== 'object');
  return isRecord(node) && 'value' in node && !('op' in node);
}

function literalValue(node: unknown): unknown {
  return isRecord(node) ? node.value : node;
}

function referencedNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => referencedNames(item, found));
  else if (isRecord(node)) {
    const name = variableName(node);
    if (name) found.add(name);
    Object.values(node).forEach((item) => referencedNames(item, found));
  }
  return found;
}

/**
 * Los literales con que el grafo compara cada variable: `x > 0.4`, `x == "VERIFIED"`,
 * `x in ["DPD_30", …]`, y también `coalesce(x, 0) >= 2`. Son los puntos donde la decisión cambia.
 */
export function comparedLiterals(compiled: CompiledDecisionArtifact): Map<string, unknown[]> {
  const found = new Map<string, unknown[]>();
  const add = (name: string, value: unknown) => {
    const list = found.get(name) ?? [];
    if (!list.some((item) => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
    found.set(name, list);
  };
  const attribute = (side: unknown, value: unknown) => {
    // El lado que no es literal puede ser la variable o una envoltura de UNA variable.
    const names = [...referencedNames(side)];
    if (names.length === 1) add(names[0], value);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isRecord(value)) return;
    const op = typeof value.op === 'string' ? value.op.toLowerCase() : null;
    const args = Array.isArray(value.args) ? value.args : [];
    const left: unknown = value.left ?? args[0];
    const right: unknown = value.right ?? args[1];
    if (op && COMPARISONS.has(op)) {
      if (isLiteral(right)) attribute(left, literalValue(right));
      if (isLiteral(left)) attribute(right, literalValue(left));
    }
    if ((op === 'in' || op === 'not_in') && isLiteral(right)) {
      const options = literalValue(right);
      if (Array.isArray(options)) options.forEach((item) => attribute(left, item));
    }
    Object.values(value).forEach(walk);
  };
  Object.values(compiled.conditions).forEach((condition) => walk(condition.expression));
  Object.values(compiled.nodes).forEach((node) => walk(node.config));
  return found;
}

function isInteger(dataType: string): boolean {
  return ['INTEGER', 'INT', 'LONG', 'BIGINT'].includes(dataType.trim().toUpperCase());
}

function isNumeric(dataType: string): boolean {
  return (
    isInteger(dataType) ||
    ['DECIMAL', 'NUMBER', 'FLOAT', 'DOUBLE', 'MONEY', 'PERCENTAGE'].includes(
      dataType.trim().toUpperCase(),
    )
  );
}

function isBoolean(dataType: string): boolean {
  return ['BOOLEAN', 'BOOL'].includes(dataType.trim().toUpperCase());
}

/** Un literal y sus vecinos: el umbral, justo por debajo y justo por encima. */
function around(literal: unknown, integer: boolean): unknown[] {
  if (typeof literal !== 'number' || !Number.isFinite(literal)) return [literal];
  const step = integer ? 1 : Math.max(Math.abs(literal) * 0.05, 0.01);
  const round = (value: number) =>
    integer ? Math.round(value) : Math.round(value * 10_000) / 10_000;
  return [literal, round(literal - step), round(literal + step)];
}

function distinct(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value === ABSENT ? '\u0000ausente' : JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateValues(dataType: string, literals: unknown[], extra: unknown[]): unknown[] {
  const values: unknown[] = [...extra];
  for (const literal of literals) values.push(...around(literal, isInteger(dataType)));
  if (isBoolean(dataType)) values.push(true, false);
  // Un texto distinto de todos los que el grafo compara: el «ninguno de los anteriores».
  if (literals.some((literal) => typeof literal === 'string')) values.push('OTRO_VALOR');
  if (isNumeric(dataType)) values.push(...NUMERIC_PROBES);
  return values;
}

function inputDimension(
  variable: GeneratorContractVariable,
  literals: unknown[],
  base: unknown,
  random: SeededRandom,
): Dimension {
  const boundary = generateBoundaryValue(variable, random);
  const accepts = (value: unknown) =>
    value === ABSENT
      ? !variable.required
      : value === null
        ? variable.nullable
        : satisfiesContract(variable, value);
  const values = candidateValues(
    variable.dataType,
    literals,
    boundary ? [base, boundary.value] : [base],
  );
  // Una opcional también se prueba AUSENTE: las ramas de `coalesce` y de «no vino el dato».
  values.push(ABSENT, null);
  return {
    key: variable.code,
    values: distinct(values.filter(accepts)),
    numeric: isNumeric(variable.dataType),
    integer: isInteger(variable.dataType),
    accepts,
    read: (candidate) =>
      variable.code in candidate.variables ? candidate.variables[variable.code] : ABSENT,
    apply: (candidate, value) => {
      if (value === ABSENT) delete candidate.variables[variable.code];
      else candidate.variables[variable.code] = value;
    },
  };
}

/**
 * Un valor de partida «tranquilo»: cero, falso, lo más corriente que el contrato acepte.
 *
 * Un valor válido al azar puede ser 8.000 consultas o 90 millones de saldo: la entrada base caía
 * siempre en el extremo del grafo, y llegar desde ahí a la rama corriente costaba decenas de pasos.
 */
function calmValue(variable: GeneratorContractVariable, random: SeededRandom): unknown {
  const candidates: unknown[] = isBoolean(variable.dataType)
    ? [false]
    : isNumeric(variable.dataType)
      ? [0, 1]
      : [];
  const calm = candidates.find((value) => satisfiesContract(variable, value));
  return calm !== undefined ? calm : buildValidValue(variable, random).value;
}

function getPath(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((cursor, segment) => {
    if (Array.isArray(cursor) && segment === 'length') return cursor.length;
    return isRecord(cursor) ? cursor[segment] : undefined;
  }, source);
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;
  path.slice(0, -1).forEach((segment) => {
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  });
  cursor[path[path.length - 1]] = value;
}

/** Las dimensiones que aporta un nodo WORKER: si la llamada falla (y con qué código) y cada salida que proyecta. */
function workerDimensions(
  node: GraphNodeSnapshot,
  call: WorkerCallSnapshot,
  compiled: CompiledDecisionArtifact,
  literals: Map<string, unknown[]>,
): Dimension[] {
  const errorCodes: unknown[] = [];
  for (const output of call.outputs) {
    if (output.source !== 'EXPRESSION' && output.path === 'call.errorCode') {
      errorCodes.push(
        ...(literals.get(`intermediate.${output.intermediateCode}`) ?? []).filter(
          (item) => typeof item === 'string' && item,
        ),
      );
    }
  }
  const states = distinct([
    'SUCCEEDED',
    'FAILED',
    ...errorCodes.map((code) => `FAILED:${String(code)}`),
  ]);
  const dimensions: Dimension[] = [
    {
      key: `${node.key}#estado`,
      values: states,
      numeric: false,
      integer: false,
      accepts: () => true,
      read: (candidate) => {
        const double = candidate.workerDoubles[node.key];
        if (double?.status !== 'FAILED') return 'SUCCEEDED';
        return double.errorCode ? `FAILED:${double.errorCode}` : 'FAILED';
      },
      apply: (candidate, value) => {
        const [status, errorCode] = String(value).split(':');
        const double = { ...(candidate.workerDoubles[node.key] ?? {}) };
        double.status = status === 'FAILED' ? 'FAILED' : 'SUCCEEDED';
        if (errorCode) double.errorCode = errorCode;
        else delete double.errorCode;
        candidate.workerDoubles[node.key] = double;
      },
    },
  ];
  for (const output of call.outputs) {
    const path = output.source === 'EXPRESSION' ? null : (output.path ?? '');
    // Sólo se gobierna lo que el nodo lee de `result.*`: `call.*` lo decide el estado, y una
    // salida calculada por expresión no se puede invertir.
    if (!path || !path.startsWith('result.')) continue;
    const declared = compiled.intermediates.find((item) => item.code === output.intermediateCode);
    const dataType = declared?.dataType ?? 'STRING';
    const segments = path.slice('result.'.length).split('.');
    const countsItems = segments[segments.length - 1] === 'length';
    const numeric = isNumeric(dataType) || countsItems;
    const extra =
      output.defaultValue !== undefined && output.defaultValue !== null
        ? [output.defaultValue]
        : [];
    const values = candidateValues(
      numeric ? (countsItems ? 'INTEGER' : dataType) : dataType,
      literals.get(`intermediate.${output.intermediateCode}`) ?? [],
      extra,
    );
    dimensions.push({
      key: `${node.key}#${output.intermediateCode}`,
      values: distinct(values.length ? values : [null]),
      numeric,
      integer: countsItems || isInteger(dataType),
      accepts: (value) => !countsItems || (typeof value === 'number' && value >= 0 && value <= 200),
      read: (candidate) => {
        const result = candidate.workerDoubles[node.key]?.result ?? {};
        return getPath(result, segments) ?? null;
      },
      apply: (candidate, value) => {
        const double = {
          ...(candidate.workerDoubles[node.key] ?? { status: 'SUCCEEDED' as const }),
        };
        const result = isRecord(double.result) ? double.result : {};
        if (countsItems) {
          const size = Math.max(0, Math.min(200, Math.round(Number(value) || 0)));
          setPath(
            result,
            segments.slice(0, -1),
            Array.from({ length: size }, () => ({})),
          );
        } else {
          setPath(result, segments, value);
        }
        double.result = result;
        candidate.workerDoubles[node.key] = double;
      },
    });
  }
  return dimensions;
}

function percentage(covered: number, total: number): number {
  return total ? Math.round((covered / total) * 10_000) / 100 : 100;
}

/**
 * Calcula, sin ejecutar el motor, lo que valdrían las intermedias con esta entrada y cuánto falta
 * para cumplir un objetivo.
 */
class ShadowModel {
  private readonly evaluator = new ExpressionEvaluator();
  /** Fórmula de cada intermedia calculada por un nodo Expresión. */
  private readonly formulas = new Map<string, unknown>();
  private readonly workerOutputs: Array<{ nodeKey: string; call: WorkerCallSnapshot }> = [];
  /** Fórmulas en orden de dependencia: cada una después de las que lee. */
  private ordered: Array<[string, unknown]> = [];
  /** De qué depende cada intermedia que escribe un worker: la clave de su dimensión. */
  private readonly workerSources = new Map<string, string[]>();

  constructor(private readonly compiled: CompiledDecisionArtifact) {
    for (const node of Object.values(compiled.nodes)) {
      for (const assignment of intermediateAssignmentsOf(node)) {
        const code = typeof assignment.code === 'string' ? assignment.code : null;
        if (!code) continue;
        const source = String(assignment.source ?? 'EXPRESSION').toUpperCase();
        if (source === 'EXPRESSION' && assignment.expression !== undefined)
          this.formulas.set(code, assignment.expression);
        else if (source === 'LITERAL') this.formulas.set(code, { value: assignment.value });
      }
      if (node.type === 'WORKER') {
        const call = parseWorkerCall(node).call;
        if (call) {
          this.workerOutputs.push({ nodeKey: node.key, call });
          for (const output of call.outputs) {
            this.workerSources.set(output.intermediateCode, [
              `${node.key}#estado`,
              `${node.key}#${output.intermediateCode}`,
            ]);
          }
        }
      }
    }
    this.ordered = this.sortFormulas();
  }

  private sortFormulas(): Array<[string, unknown]> {
    const pending = new Map(this.formulas);
    const sorted: Array<[string, unknown]> = [];
    while (pending.size) {
      const ready = [...pending].filter(([, formula]) =>
        [...referencedNames(formula)].every(
          (name) =>
            !name.startsWith('intermediate.') || !pending.has(name.slice('intermediate.'.length)),
        ),
      );
      // Un ciclo no debería existir (el validador lo rechaza); si lo hay, se toma lo que queda tal cual.
      const batch = ready.length ? ready : [...pending];
      for (const entry of batch) {
        sorted.push(entry);
        pending.delete(entry[0]);
      }
    }
    return sorted;
  }

  /**
   * Las dimensiones de las que depende un objetivo, siguiendo las fórmulas hasta las entradas.
   * Una compuerta que mira dos variables se resuelve moviendo esas dos, no las cuarenta.
   */
  relevantDimensions(goals: Goal[]): Set<string> {
    const keys = new Set<string>();
    const seen = new Set<string>();
    const visit = (expression: unknown): void => {
      for (const name of referencedNames(expression)) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!name.startsWith('intermediate.')) {
          keys.add(name.split('.')[0]);
          continue;
        }
        const code = name.slice('intermediate.'.length).split('.')[0];
        (this.workerSources.get(code) ?? []).forEach((key) => keys.add(key));
        const formula = this.formulas.get(code);
        if (formula !== undefined) visit(formula);
      }
    };
    goals.forEach((goal) => visit(goal.expression));
    return keys;
  }

  context(candidate: CoverageCandidate): Record<string, unknown> {
    const intermediate: Record<string, unknown> = {};
    const context: Record<string, unknown> = {
      ...candidate.variables,
      variables: candidate.variables,
      decision: {},
      output: {},
      intermediate,
    };
    for (const { nodeKey, call } of this.workerOutputs) {
      const double = candidate.workerDoubles[nodeKey] ?? {};
      const failed = double.status === 'FAILED';
      const envelope = {
        ...context,
        result: failed ? {} : (double.result ?? {}),
        call: {
          status: failed ? 'FAILED' : 'SUCCEEDED',
          errorCode: failed ? (double.errorCode ?? 'WORKER_SERVICE_FAILED') : undefined,
        },
      };
      for (const output of call.outputs) {
        const raw = this.safe(
          output.source === 'EXPRESSION' ? output.expression : { var: output.path ?? '' },
          envelope,
        );
        intermediate[output.intermediateCode] =
          raw === undefined || raw === null ? (output.defaultValue ?? null) : raw;
      }
    }
    for (const [code, formula] of this.ordered) {
      const value = this.safe(formula, context);
      if (value !== undefined) intermediate[code] = value;
    }
    return context;
  }

  private safe(expression: unknown, context: Record<string, unknown>): unknown {
    try {
      return this.evaluator.evaluate(expression, context);
    } catch {
      return undefined;
    }
  }

  /** La fórmula de una intermedia calculada, para sustituirla donde se la compara. */
  private inline(expression: unknown, depth: number): unknown {
    if (depth > MAX_INLINE_DEPTH) return expression;
    const name = variableName(expression);
    if (name?.startsWith('intermediate.')) {
      const formula = this.formulas.get(name.slice('intermediate.'.length));
      if (formula !== undefined) return this.inline(formula, depth + 1);
    }
    return expression;
  }

  /** Cuánto falta para que `expression` valga `truth`: 0 si ya vale. */
  distance(
    expression: unknown,
    truth: boolean,
    context: Record<string, unknown>,
    depth = 0,
  ): number {
    const node = this.inline(expression, depth);
    if (!isRecord(node) || isLiteral(node) || variableName(node)) {
      return Boolean(this.safe(node, context)) === truth ? 0 : MISS;
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
    return Boolean(this.safe(node, context)) === truth ? 0 : MISS;
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
    const node = this.inline(expression, depth);
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
    if (accepts(this.safe(node, context))) return 0;
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
      const opened = this.inline(side, depth);
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
    const a = this.safe(left, context);
    const b = this.safe(right, context);
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

/** Lo que hay que cumplir para tomar `edge` desde su nodo: sus condiciones, y no las de las de más prioridad. */
function edgeGoals(compiled: CompiledDecisionArtifact, edge: GraphEdgeSnapshot): Goal[] {
  const conjunction = (target: GraphEdgeSnapshot) => ({
    op: 'and',
    args: target.conditions.map(
      (condition) => compiled.conditions[condition.code]?.expression ?? { value: true },
    ),
  });
  const goals: Goal[] = [];
  const siblings = compiled.edgesByNode[edge.from] ?? [];
  for (const sibling of siblings) {
    if (sibling.key === edge.key) break;
    if (!sibling.default && sibling.conditions.length)
      goals.push({ expression: conjunction(sibling), truth: false });
  }
  if (edge.default) {
    for (const sibling of siblings) {
      if (sibling.key !== edge.key && !sibling.default && sibling.conditions.length)
        goals.push({ expression: conjunction(sibling), truth: false });
    }
  } else if (edge.conditions.length) {
    goals.push({ expression: conjunction(edge), truth: true });
  }
  return goals;
}

/** Caminos de aristas desde el inicio hasta `target`, los más cortos primero. */
function pathsTo(
  compiled: CompiledDecisionArtifact,
  target: string,
  limit: number,
): GraphEdgeSnapshot[][] {
  const found: GraphEdgeSnapshot[][] = [];
  const queue: Array<{ node: string; path: GraphEdgeSnapshot[]; seen: Set<string> }> = [
    { node: compiled.startNodeKey, path: [], seen: new Set([compiled.startNodeKey]) },
  ];
  let guard = 0;
  while (queue.length && found.length < limit && guard < 5_000) {
    guard += 1;
    const current = queue.shift()!;
    if (current.node === target) {
      found.push(current.path);
      continue;
    }
    for (const edge of compiled.edgesByNode[current.node] ?? []) {
      if (current.seen.has(edge.to)) continue;
      queue.push({
        node: edge.to,
        path: [...current.path, edge],
        seen: new Set([...current.seen, edge.to]),
      });
    }
  }
  return found;
}

export async function searchCoverage(
  compiled: CompiledDecisionArtifact,
  contract: GeneratorContractVariable[],
  random: SeededRandom,
  observe: Observe,
  budget: CoverageBudget,
  seeds: CoverageCandidate[] = [],
): Promise<CoverageSearchResult> {
  const now = budget.now ?? (() => Date.now());
  const deadline = now() + budget.maxMillis;
  const allNodes = Object.keys(compiled.nodes);
  const everyEdge = Object.values(compiled.edgesByNode).flat();
  const allEdges = everyEdge.map((edge) => edge.key);
  const literals = comparedLiterals(compiled);
  const shadow = new ShadowModel(compiled);

  const base: CoverageCandidate = { variables: {}, workerDoubles: {} };
  const dimensions: Dimension[] = [];
  for (const variable of contract) {
    const value = calmValue(variable, random);
    base.variables[variable.code] = value;
    dimensions.push(inputDimension(variable, literals.get(variable.code) ?? [], value, random));
  }
  for (const node of Object.values(compiled.nodes)) {
    if (node.type !== 'WORKER') continue;
    const call = parseWorkerCall(node).call;
    if (!call) continue;
    base.workerDoubles[node.key] = { status: 'SUCCEEDED', result: {} };
    const own = workerDimensions(node, call, compiled, literals);
    // La base responde con el primer candidato de cada salida: una respuesta «normal» del servicio.
    own.slice(1).forEach((dimension) => dimension.apply(base, dimension.values[0]));
    dimensions.push(...own);
  }

  const coveredNodes = new Set<string>();
  const coveredEdges = new Set<string>();
  const kept: CoverageCase[] = [];
  let executions = 0;
  let exhaustedBudget = false;

  const complete = () =>
    coveredNodes.size === allNodes.length && coveredEdges.size === allEdges.length;
  const outOfBudget = () => {
    if (executions >= budget.maxExecutions || now() >= deadline) exhaustedBudget = true;
    return exhaustedBudget;
  };

  /** Ejecuta un candidato con el motor; lo guarda si recorre algo nuevo. Devuelve si aportó. */
  const consider = async (candidate: CoverageCandidate): Promise<boolean> => {
    executions += 1;
    const observation = await observe(candidate);
    if (!observation.usable) return false;
    const gained =
      observation.visitedNodeKeys.some((key) => !coveredNodes.has(key)) ||
      observation.traversedEdgeKeys.some((key) => !coveredEdges.has(key));
    if (!gained) return false;
    observation.visitedNodeKeys.forEach((key) => coveredNodes.add(key));
    observation.traversedEdgeKeys.forEach((key) => coveredEdges.add(key));
    kept.push({ candidate, observation });
    return true;
  };

  const distances = (candidate: CoverageCandidate, goals: Goal[]): number[] => {
    const context = shadow.context(candidate);
    return goals.map((goal) => shadow.distance(goal.expression, goal.truth, context));
  };
  const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
  const fitness = (candidate: CoverageCandidate, goals: Goal[]): number =>
    total(distances(candidate, goals));

  /** Movimientos de una dimensión: sus candidatos y, si es numérica, pasos relativos al valor actual. */
  const moves = (dimension: Dimension, current: unknown): unknown[] => {
    if (!dimension.numeric || typeof current !== 'number') return dimension.values;
    const step = dimension.integer ? 1 : Math.max(Math.abs(current) * 0.1, 0.01);
    const fix = (value: number) =>
      dimension.integer ? Math.round(value) : Math.round(value * 10_000) / 10_000;
    const relative = [
      current + step,
      current - step,
      current * 2,
      current / 2,
      current * 10,
      current / 10,
    ]
      .map(fix)
      .filter((value) => dimension.accepts(value));
    return [...dimension.values, ...relative];
  };

  /** Baja la distancia cambiando una variable cada vez, sin ejecutar el motor. */
  const climb = (
    start: CoverageCandidate,
    goals: Goal[],
  ): { candidate: CoverageCandidate; distance: number } => {
    const candidate = clone(start);
    // De qué dimensiones depende cada objetivo: al mover una, sólo se recalculan los suyos.
    const dependencies = goals.map((goal) => shadow.relevantDimensions([goal]));
    const movable = dimensions.filter((dimension) =>
      dependencies.some((keys) => keys.has(dimension.key)),
    );
    let current = distances(candidate, goals);
    let distance = total(current);
    for (let step = 0; step < MAX_CLIMB_STEPS && distance > 0 && !outOfBudget(); step += 1) {
      let best: { dimension: Dimension; value: unknown; distance: number } | null = null;
      for (const dimension of movable) {
        const affected = goals
          .map((_, index) => index)
          .filter((index) => dependencies[index].has(dimension.key));
        const untouched = distance - total(affected.map((index) => current[index]));
        const before = dimension.read(candidate);
        for (const value of moves(dimension, before)) {
          dimension.apply(candidate, value);
          const context = shadow.context(candidate);
          const reached =
            untouched +
            total(
              affected.map((index) =>
                shadow.distance(goals[index].expression, goals[index].truth, context),
              ),
            );
          if (reached < distance - 1e-9 && (!best || reached < best.distance))
            best = { dimension, value, distance: reached };
        }
        dimension.apply(candidate, before);
      }
      if (!best) break;
      best.dimension.apply(candidate, best.value);
      current = distances(candidate, goals);
      distance = total(current);
    }
    return { candidate, distance };
  };

  for (const seed of [base, ...seeds]) {
    if (outOfBudget()) break;
    await consider(clone(seed));
  }

  // Rondas: mientras alguna arista sin recorrer se deje alcanzar, se sigue.
  for (let round = 0; round < 6 && !complete() && !outOfBudget(); round += 1) {
    let progressed = false;
    for (const edge of everyEdge) {
      if (coveredEdges.has(edge.key)) continue;
      if (complete() || outOfBudget()) break;
      const routes = pathsTo(compiled, edge.from, MAX_PATHS_PER_EDGE);
      for (const route of routes) {
        if (coveredEdges.has(edge.key) || outOfBudget()) break;
        const goals = [...route, edge].flatMap((step) => edgeGoals(compiled, step));
        // Se parte de lo que ya esté MÁS CERCA del objetivo: la base o un caso encontrado. Partir
        // siempre de la base obligaba a resolver otra vez las mismas compuertas en cada arista.
        const starts = [base, ...kept.map((item) => item.candidate)]
          .map((candidate) => ({ candidate, distance: fitness(candidate, goals) }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 2);
        for (const start of starts) {
          if (coveredEdges.has(edge.key) || outOfBudget()) break;
          const reached = climb(start.candidate, goals);
          if (await consider(reached.candidate)) progressed = true;
        }
      }
    }
    if (!progressed) break;
  }

  // Lo que quede: mezclas de varias variables a la vez, por si el modelo en sombra se quedó corto.
  let stale = 0;
  while (!complete() && !outOfBudget() && dimensions.length && kept.length && stale < 400) {
    const candidate = clone(random.pick(kept).candidate);
    const changes = random.int(2, Math.min(6, dimensions.length));
    for (let step = 0; step < changes; step += 1) {
      const dimension = random.pick(dimensions);
      dimension.apply(candidate, random.pick(dimension.values));
    }
    stale = (await consider(candidate)) ? 0 : stale + 1;
  }

  return {
    cases: minimize(kept),
    executions,
    exhaustedBudget: exhaustedBudget && !complete(),
    nodes: {
      covered: allNodes.filter((key) => coveredNodes.has(key)),
      missing: allNodes.filter((key) => !coveredNodes.has(key)),
      percentage: percentage(coveredNodes.size, allNodes.length),
    },
    edges: {
      covered: allEdges.filter((key) => coveredEdges.has(key)),
      missing: allEdges.filter((key) => !coveredEdges.has(key)),
      percentage: percentage(coveredEdges.size, allEdges.length),
    },
  };
}

/**
 * La suite más corta que conserva la cobertura: en cada vuelta, el caso que más aporta.
 * Los casos se guardaron según aparecieron, y los primeros suelen quedar tapados por otros.
 */
function minimize(kept: CoverageCase[]): CoverageCase[] {
  const target = new Set<string>();
  const items = (item: CoverageCase) => [
    ...item.observation.visitedNodeKeys.map((key) => `n:${key}`),
    ...item.observation.traversedEdgeKeys.map((key) => `e:${key}`),
  ];
  kept.forEach((item) => items(item).forEach((key) => target.add(key)));
  const chosen: CoverageCase[] = [];
  const remaining = [...kept];
  while (target.size && remaining.length) {
    let best = 0;
    let bestGain = -1;
    remaining.forEach((item, index) => {
      const gain = items(item).filter((key) => target.has(key)).length;
      if (gain > bestGain) {
        best = index;
        bestGain = gain;
      }
    });
    if (bestGain <= 0) break;
    const [picked] = remaining.splice(best, 1);
    items(picked).forEach((key) => target.delete(key));
    chosen.push(picked);
  }
  return chosen;
}

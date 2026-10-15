import type { CompiledDecisionArtifact, GraphEdgeSnapshot } from '../../graph/graph.types';
import type { GeneratorContractVariable } from '../contract-value-factory';
import { boundFor, mayor, menor, type Bounds } from './numeric-bounds';
import { differentFrom, NOT_SOLVABLE, valueFor } from './value-solver';

/**
 * Empuja la entrada hacia la arista elegida: cumple sus condiciones y rompe las de las
 * que van por delante. El orden importa —las de más prioridad se rompen ANTES— porque
 * el motor toma la primera que pasa, y una entrada que cumple dos aristas se va por la
 * primera, no por la que este caso perseguía.
 */
export function steer(
  compiled: CompiledDecisionArtifact,
  byCode: Map<string, GeneratorContractVariable>,
  input: Record<string, unknown>,
  bounds: Map<string, Bounds>,
  edges: GraphEdgeSnapshot[],
  taken: GraphEdgeSnapshot,
): void {
  for (const edge of edges) {
    if (edge.key === taken.key) break;
    if (edge.default) continue;
    // Basta con romper UNA condición para que la arista no se lleve la ejecución.
    const first = [...edge.conditions].sort((a, b) => a.order - b.order)[0];
    const expression = first ? compiled.conditions[first.code]?.expression : undefined;
    if (expression) apply(expression, false, byCode, input, bounds);
  }

  for (const reference of [...taken.conditions].sort((a, b) => a.order - b.order)) {
    const condition = compiled.conditions[reference.code];
    if (condition) apply(condition.expression, true, byCode, input, bounds);
  }
}

/**
 * Ajusta la entrada para que `expression` valga `target`. Devuelve `false` cuando la
 * expresión no depende de ninguna variable de entrada —una intermedia, `decision.*`, un
 * operador que no admite despeje— y por tanto el caso no la puede gobernar.
 */
function apply(
  expression: unknown,
  target: boolean,
  byCode: Map<string, GeneratorContractVariable>,
  input: Record<string, unknown>,
  bounds: Map<string, Bounds>,
): boolean {
  if (!expression || typeof expression !== 'object') return false;
  const node = expression as Record<string, unknown>;

  if ('variable' in node && 'operator' in node) {
    return assign(
      String(node.variable),
      String(node.operator),
      node.value,
      target,
      byCode,
      input,
      bounds,
    );
  }

  // Referencia suelta usada como booleano: `{ not: { var: consent_active } }`. Es la
  // forma que más usan los grafos sembrados para las banderas, y tratarla como «no
  // despejable» dejaba sin gobernar justo las ramas de KYC y de fraude.
  const bare = readVariablePath(node);
  if (bare !== null) return assignTruthy(bare, target, byCode, input);

  const op = String(node.op ?? '').toLowerCase();
  const args: unknown[] = Array.isArray(node.args) ? (node.args as unknown[]) : [];
  if (op === 'not') return apply(node.arg ?? args[0], !target, byCode, input, bounds);
  if (op === 'and' || op === 'or') {
    // Para que un AND sea cierto hay que cumplir todos sus términos; para que sea falso
    // basta romper uno. En un OR es al revés.
    const all = (op === 'and') === target;
    if (all)
      return args.length > 0 && args.every((arg) => apply(arg, target, byCode, input, bounds));
    return args.some((arg) => apply(arg, target, byCode, input, bounds));
  }
  if (COMPARISONS.has(op)) {
    const left = args[0] ?? node.left;
    const right = args[1] ?? node.right;
    const path = readVariablePath(left);
    if (path === null) return false;
    return assign(path, op, literalOf(right), target, byCode, input, bounds);
  }
  if (op === 'exists' || op === 'is_null') {
    const path = readVariablePath(node.arg ?? node.left ?? args[0]);
    if (path === null) return false;
    return assignPresence(path, (op === 'exists') === target, byCode, input);
  }
  return false;
}

/** Una bandera leída como booleano: se escribe el valor que la hace cierta o falsa. */
function assignTruthy(
  path: string,
  target: boolean,
  byCode: Map<string, GeneratorContractVariable>,
  input: Record<string, unknown>,
): boolean {
  const variable = inputVariable(path, byCode);
  if (!variable) return false;
  const type = String(variable.dataType).toUpperCase();
  if (type === 'BOOLEAN') {
    input[variable.code] = target;
    return true;
  }
  // Fuera de los booleanos, «verdadero» depende del tipo y forzarlo produciría valores
  // que el contrato rechaza (un texto vacío con `minLength`, un 0 fuera de rango). Se
  // declara no despejable en vez de fabricar una entrada inválida.
  return false;
}

/** `exists` / `is_null`: la variable tiene que llegar o no llegar en el payload. */
function assignPresence(
  path: string,
  present: boolean,
  byCode: Map<string, GeneratorContractVariable>,
  input: Record<string, unknown>,
): boolean {
  const variable = inputVariable(path, byCode);
  if (!variable) return false;
  if (present) return input[variable.code] !== undefined;
  // Obligatoria: quitarla convertiría el caso en uno que el motor rechaza por contrato
  // antes de llegar a ninguna rama, y el desenlace perseguido no se probaría.
  if (variable.required) return false;
  delete input[variable.code];
  return true;
}

/** La variable de ENTRADA que nombra la ruta, o `undefined` si la produce el grafo. */
function inputVariable(
  path: string,
  byCode: Map<string, GeneratorContractVariable>,
): GeneratorContractVariable | undefined {
  const code = path.startsWith('variables.') ? path.slice('variables.'.length) : path;
  if (code.includes('.')) return undefined;
  return byCode.get(code);
}

const COMPARISONS = new Set([
  'eq',
  'equals',
  'neq',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'ends_with',
]);

function readVariablePath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Record<string, unknown>;
  if (typeof node.var === 'string') return node.var;
  if (typeof node.variable === 'string' && !('operator' in node)) return node.variable;
  return null;
}

function literalOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return (value as Record<string, unknown>).value;
  }
  return value;
}

/**
 * Escribe en la entrada el valor que hace verdadera (o falsa) una comparación.
 *
 * Sólo actúa sobre variables del contrato de entrada: `intermediate.dti` o
 * `decision.score` los produce el grafo, y fabricarlos en el payload daría un caso que
 * el motor ignora mientras el informe presume de cubrir esa rama.
 */
function assign(
  path: string,
  operator: string,
  expected: unknown,
  target: boolean,
  byCode: Map<string, GeneratorContractVariable>,
  input: Record<string, unknown>,
  bounds: Map<string, Bounds>,
): boolean {
  const variable = inputVariable(path, byCode);
  if (!variable) return false;

  // Las desigualdades ESTRECHAN el intervalo; el valor se sortea después dentro de lo que
  // quede. Escribirlo aquí hacía que la última condición pisara a la anterior y que todos
  // los casos de una rama cayeran en el mismo borde.
  const limite = boundFor(operator.toLowerCase(), expected, target, variable);
  if (limite) {
    const actual = bounds.get(variable.code) ?? {};
    bounds.set(variable.code, {
      min: mayor(actual.min, limite.min),
      max: menor(actual.max, limite.max),
    });
    return true;
  }

  const other = (value: unknown) => differentFrom(value, input[variable.code], variable);
  const valor = valueFor(operator.toLowerCase(), expected, target, other);
  if (valor === NOT_SOLVABLE) return false;
  // Un valor exacto manda sobre cualquier intervalo anterior sobre la misma variable: una
  // igualdad no admite margen.
  bounds.delete(variable.code);
  input[variable.code] = valor;
  return true;
}

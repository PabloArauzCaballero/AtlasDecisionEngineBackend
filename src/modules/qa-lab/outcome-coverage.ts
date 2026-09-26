/**
 * Un caso de prueba por cada DESENLACE del grafo, no por cada clase de contrato.
 *
 * `VALID`/`BOUNDARY`/`INVALID` describen la ENTRADA: dicen si el payload respeta el
 * contrato. Con ellas se puede generar cien casos válidos que recorran siempre la
 * misma rama y dejar sin ejercitar la mitad de las decisiones que el artefacto sabe
 * tomar. Lo que hace falta para probar un algoritmo es lo contrario: partir de cada
 * final posible —aprobado, rechazado, revisión manual, cada resultado del contrato de
 * salida— y construir una entrada que lo alcance.
 *
 * El plan se deriva del grafo compilado, que es el mismo que ejecutará el motor:
 * caminos desde el nodo inicial hasta cada terminal, y por cada camino las condiciones
 * que hay que cumplir (las de la arista elegida) y las que hay que incumplir (las de
 * las aristas de más prioridad, que si pasaran se llevarían la ejecución por otro
 * lado).
 *
 * ## Lo que este generador NO puede prometer
 *
 * Una condición sobre una variable INTERMEDIA o sobre `decision.*` no se puede forzar
 * desde el payload: su valor lo produce un nodo del propio grafo. Esos casos se
 * entregan igual —el resto del camino sí queda preparado— pero declaran en
 * `unresolved` qué condición quedó al azar. Un generador que callara eso estaría
 * afirmando una cobertura que no tiene, que es peor que no generar el caso.
 */
import { ExpressionEvaluator } from '../graph/expression-evaluator';
import type {
  CompiledDecisionArtifact,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
} from '../graph/graph.types';
import {
  buildValidValue,
  resolvedConstraintsOf,
  type GeneratorContractVariable,
} from './contract-value-factory';
import type { SeededRandom } from './seeded-random';

export interface OutcomeCase {
  index: number;
  kind: 'OUTCOME';
  /** Nodo terminal que el caso persigue. */
  nodeKey: string;
  /** Cómo se llama ese desenlace en la pantalla: la etiqueta del nodo o su acción. */
  outcome: string;
  /** Camino de nodos, para explicar por qué se espera ese final. */
  path: string[];
  input: Record<string, unknown>;
  /** Condiciones que no se pueden forzar desde la entrada; ver la nota de cabecera. */
  unresolved: string[];
  unsatisfiable?: string[];
}

const MAX_PATH_DEPTH = 40;

/**
 * Un caso por desenlace alcanzable, en orden estable.
 *
 * `limit` acota cuántos se devuelven; cuando hay más desenlaces que casos pedidos se
 * entregan los primeros y el llamador informa de cuántos quedaron fuera. Un recorte
 * silencioso se leería como «el artefacto sólo tiene estos finales».
 */
export function planOutcomeCases(
  compiled: CompiledDecisionArtifact,
  variables: GeneratorContractVariable[],
  random: SeededRandom,
  limit: number,
): { cases: OutcomeCase[]; totalOutcomes: number } {
  const evaluator = new ExpressionEvaluator();
  const byOutcome = pathsByOutcome(compiled);
  const inputs = variables.filter((variable) => variable.code);
  const cases: OutcomeCase[] = [];
  for (const [nodeKey, path] of byOutcome) {
    if (cases.length >= limit) break;
    cases.push(buildCase(compiled, evaluator, inputs, random, path, nodeKey, cases.length));
  }
  return { cases, totalOutcomes: byOutcome.size };
}

/**
 * Varios casos por desenlace, según el reparto pedido (§10.4).
 *
 * `planOutcomeCases` responde «¿se ejecuta cada rama al menos una vez?». Esto responde
 * otra pregunta: «¿qué pasa cuando el 70 % de la población acaba en rechazado?». Cada
 * caso vuelve a construirse desde cero con el flujo aleatorio en curso, así que los
 * treinta casos de una misma rama NO son treinta copias de la misma entrada —lo serían
 * si se clonara uno, y entonces la corrida diría treinta y habría probado uno—.
 *
 * Los desenlaces que el grafo no alcanza se ignoran en silencio aquí porque el servicio
 * ya los rechazó antes: aquí sólo llegan claves verificadas contra este mismo grafo.
 */
export function planOutcomeAllocation(
  compiled: CompiledDecisionArtifact,
  variables: GeneratorContractVariable[],
  random: SeededRandom,
  allocation: ReadonlyMap<string, number>,
): OutcomeCase[] {
  const evaluator = new ExpressionEvaluator();
  const byOutcome = pathsByOutcome(compiled);
  const inputs = variables.filter((variable) => variable.code);
  const cases: OutcomeCase[] = [];
  for (const [nodeKey, count] of allocation) {
    const path = byOutcome.get(nodeKey);
    if (!path) continue;
    for (let made = 0; made < count; made += 1) {
      cases.push(buildCase(compiled, evaluator, inputs, random, path, nodeKey, cases.length));
    }
  }
  return cases;
}

/** Los desenlaces que el grafo alcanza de verdad, en orden estable. */
export function reachableOutcomeKeys(compiled: CompiledDecisionArtifact): string[] {
  return [...pathsByOutcome(compiled).keys()];
}

/**
 * Lo mismo, con el nombre que se enseña en pantalla.
 *
 * Va aparte de `reachableOutcomeKeys` porque quien reparte pesos necesita la CLAVE
 * —`nodeKey`, que es lo que valida el servicio— y quien elige en la interfaz necesita el
 * RÓTULO. Devolver sólo uno obligaba a la pantalla a inventar el otro.
 */
export function describeOutcomes(
  compiled: CompiledDecisionArtifact,
): Array<{ nodeKey: string; label: string }> {
  return reachableOutcomeKeys(compiled).map((nodeKey) => ({
    nodeKey,
    label: outcomeLabel(compiled, nodeKey),
  }));
}

/**
 * Convierte pesos relativos en un número EXACTO de casos por desenlace.
 *
 * Reparto por resto mayor: los enteros primero y las plazas que sobran a quien tenía la
 * fracción más alta, con el código como desempate para que el resultado sea el mismo en
 * cada corrida. Redondear cada peso por su cuenta perdía casos —diez casos repartidos
 * entre tres ramas daban nueve— y la corrida ejecutaba menos de los que decía.
 *
 * Vive aquí, y no en el servicio, porque es aritmética pura: así se prueba sin levantar
 * medio Nest para comprobar una suma.
 */
export function allocateOutcomeCounts(
  weights: ReadonlyArray<readonly [string, number]>,
  total: number,
): Map<string, number> {
  const suma = weights.reduce((acumulado, [, peso]) => acumulado + peso, 0);
  if (suma <= 0 || total <= 0) return new Map(weights.map(([clave]) => [clave, 0]));

  const exactos = weights.map(([clave, peso]) => [clave, (peso / suma) * total] as const);
  const reparto = new Map(exactos.map(([clave, parte]) => [clave, Math.floor(parte)]));
  let sobran = total - [...reparto.values()].reduce((acumulado, casos) => acumulado + casos, 0);
  const porResto = [...exactos].sort((a, b) => (b[1] % 1) - (a[1] % 1) || a[0].localeCompare(b[0]));
  for (const [clave] of porResto) {
    if (sobran <= 0) break;
    reparto.set(clave, (reparto.get(clave) ?? 0) + 1);
    sobran -= 1;
  }
  return reparto;
}

/** El primer camino hasta cada terminal. Uno por desenlace: los demás llegan al mismo sitio. */
function pathsByOutcome(compiled: CompiledDecisionArtifact): Map<string, string[]> {
  const byOutcome = new Map<string, string[]>();
  for (const path of enumeratePaths(compiled)) {
    const terminal = path[path.length - 1];
    if (!byOutcome.has(terminal)) byOutcome.set(terminal, path);
  }
  return byOutcome;
}

/** Todos los caminos nodo a nodo desde el inicio hasta un terminal, sin repetir nodo. */
function enumeratePaths(compiled: CompiledDecisionArtifact): string[][] {
  const found: string[][] = [];
  const walk = (nodeKey: string, trail: string[]): void => {
    if (trail.length > MAX_PATH_DEPTH || found.length > 200) return;
    const node = compiled.nodes[nodeKey];
    if (!node) return;
    const next = compiled.edgesByNode[nodeKey] ?? [];
    // Un nodo terminal cierra el camino aunque tenga aristas colgando: el motor no
    // sigue después de él, y seguir aquí inventaría desenlaces que no ocurren.
    if (node.terminal || !next.length) {
      found.push([...trail, nodeKey]);
      return;
    }
    for (const edge of next) {
      if (trail.includes(edge.to)) continue;
      walk(edge.to, [...trail, nodeKey]);
    }
  };
  walk(compiled.startNodeKey, []);
  return found;
}

function buildCase(
  compiled: CompiledDecisionArtifact,
  evaluator: ExpressionEvaluator,
  inputs: GeneratorContractVariable[],
  random: SeededRandom,
  path: string[],
  nodeKey: string,
  index: number,
): OutcomeCase {
  const input: Record<string, unknown> = {};
  const unsatisfiable: string[] = [];
  for (const variable of inputs) {
    const generated = buildValidValue(variable, random);
    input[variable.code] = generated.value;
    if (!generated.satisfied) unsatisfiable.push(variable.code);
  }

  const byCode = new Map(inputs.map((variable) => [variable.code, variable]));
  // Los límites numéricos se ACUMULAN y el valor se sortea al final, dentro del intervalo
  // que queda. Escribir el valor en cada condición tenía dos defectos: la última pisaba a
  // la anterior (que se cumplía sólo por suerte del orden) y, sobre todo, clavaba el valor
  // en el borde —los treinta casos de una misma rama salían idénticos, así que el informe
  // decía treinta habiendo probado uno—.
  const bounds = new Map<string, Bounds>();
  for (let step = 0; step < path.length - 1; step += 1) {
    const edges = compiled.edgesByNode[path[step]] ?? [];
    const taken = edges.find((edge) => edge.to === path[step + 1]);
    if (taken) steer(compiled, byCode, input, bounds, edges, taken);
  }
  for (const [code, range] of bounds) {
    const variable = byCode.get(code);
    if (variable) input[code] = drawWithin(variable, range, random);
  }
  // Se comprueba al FINAL y con el evaluador del motor, nunca durante el ajuste: una
  // condición que el primer paso no supo evitar puede quedar evitada por el valor que
  // escribió el siguiente, y avisar en el momento del intento llenaba el informe de
  // advertencias falsas sobre ramas que sí estaban bien cerradas.
  const unresolved = verifyPath(compiled, evaluator, path, input);

  return {
    index,
    kind: 'OUTCOME',
    nodeKey,
    outcome: outcomeLabel(compiled, nodeKey),
    path,
    input,
    unresolved,
    ...(unsatisfiable.length ? { unsatisfiable } : {}),
  };
}

/**
 * Empuja la entrada hacia la arista elegida: cumple sus condiciones y rompe las de las
 * que van por delante. El orden importa —las de más prioridad se rompen ANTES— porque
 * el motor toma la primera que pasa, y una entrada que cumple dos aristas se va por la
 * primera, no por la que este caso perseguía.
 */
function steer(
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

/** Intervalo cerrado admisible para una variable numérica, tal como lo dejan las ramas. */
interface Bounds {
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
function drawWithin(
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

function mayor(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function menor(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

/**
 * Qué ramas del camino NO quedan garantizadas por la entrada construida.
 *
 * Se distinguen dos cosas que no son lo mismo: una condición que se puede evaluar y sale
 * mal (la entrada no consigue el desvío) y una que no se puede evaluar porque lee un
 * valor que produce el propio grafo. La primera es un fallo del ajuste; la segunda es un
 * límite del método, y mezclarlas dejaría al analista sin saber cuál de las dos mira.
 */
function verifyPath(
  compiled: CompiledDecisionArtifact,
  evaluator: ExpressionEvaluator,
  path: string[],
  input: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (let step = 0; step < path.length - 1; step += 1) {
    const edges = compiled.edgesByNode[path[step]] ?? [];
    const taken = edges.find((edge) => edge.to === path[step + 1]);
    if (!taken) continue;

    for (const edge of edges) {
      if (edge.key === taken.key) break;
      if (edge.default) continue;
      const { verdict, blame } = edgeVerdict(compiled, evaluator, edge, input);
      if (verdict === true) {
        problems.push(
          `${edge.key}: se cumple antes que «${taken.key}», así que la ejecución se desviaría`,
        );
      }
      if (verdict === null) {
        problems.push(`«${blame}» lo calcula el grafo: no se puede descartar la rama ${edge.key}`);
      }
    }

    if (taken.default || !taken.conditions.length) continue;
    const { verdict, blame } = edgeVerdict(compiled, evaluator, taken, input);
    if (verdict === false) {
      problems.push(`${taken.key}: «${blame}» no se cumple con los valores elegidos`);
    }
    if (verdict === null) {
      problems.push(
        `«${blame}» lo calcula el grafo, no la entrada: la rama ${taken.key} no está garantizada`,
      );
    }
  }
  return problems;
}

/**
 * `true`/`false` si la entrada lo decide; `null` si depende del propio grafo. `blame`
 * nombra la condición responsable, que es lo que el analista necesita para ir a mirarla.
 */
function edgeVerdict(
  compiled: CompiledDecisionArtifact,
  evaluator: ExpressionEvaluator,
  edge: GraphEdgeSnapshot,
  input: Record<string, unknown>,
): { verdict: boolean | null; blame?: string } {
  let blame: string | undefined;
  for (const reference of edge.conditions) {
    const expression = compiled.conditions[reference.code]?.expression;
    if (!expression) return { verdict: null, blame: reference.code };
    if (!governableFromInput(evaluator, expression, input)) {
      blame ??= reference.code;
      continue;
    }
    try {
      // Una sola condición falsa basta para que la arista no se tome, la evalúe quien la
      // evalúe: ahí ya no importa lo que no se pueda determinar.
      if (!evaluator.evaluate(expression, contextOf(input))) {
        return { verdict: false, blame: reference.code };
      }
    } catch {
      blame ??= reference.code;
    }
  }
  return blame ? { verdict: null, blame } : { verdict: true };
}

/**
 * ¿La expresión se decide sólo con el payload? `intermediate.*`, `decision.*` y
 * `output.*` los escribe el grafo durante la ejecución: evaluarlos aquí daría `undefined`
 * y una comparación falsa que parecería un veredicto firme.
 */
function governableFromInput(
  evaluator: ExpressionEvaluator,
  expression: unknown,
  input: Record<string, unknown>,
): boolean {
  for (const reference of evaluator.referencedVariables(expression)) {
    if (reference.startsWith('intermediate.')) return false;
    if (reference === 'decision' || reference === 'output') return false;
    if (!(reference in input)) return false;
  }
  return true;
}

/** Mismo contexto que arma el motor al evaluar una condición, con lo que hay: la entrada. */
function contextOf(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, variables: input, decision: {}, output: {}, intermediate: {} };
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

/**
 * El intervalo que impone una desigualdad, o `null` si el operador no es de orden.
 *
 * Los límites abiertos se cierran con el paso del tipo: `> 750` sobre un entero es
 * `>= 751`, y sobre un decimal de dos cifras, `>= 750.01`. Trabajar con intervalos
 * cerrados deja el sorteo posterior en una sola cuenta.
 */
function boundFor(
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

const NOT_SOLVABLE = Symbol('not-solvable');

function valueFor(
  operator: string,
  expected: unknown,
  target: boolean,
  differentFrom: (value: unknown) => unknown,
): unknown {
  const number = typeof expected === 'number' ? expected : Number(expected);
  const numeric = Number.isFinite(number);
  const step = Number.isInteger(number) ? 1 : 0.01;

  switch (operator) {
    case 'eq':
    case 'equals':
      return target ? expected : differentFrom(expected);
    case 'neq':
    case 'not_equals':
      return target ? differentFrom(expected) : expected;
    case 'gt':
      if (!numeric) return NOT_SOLVABLE;
      return target ? round(number + step) : number;
    case 'gte':
      if (!numeric) return NOT_SOLVABLE;
      return target ? number : round(number - step);
    case 'lt':
      if (!numeric) return NOT_SOLVABLE;
      return target ? round(number - step) : number;
    case 'lte':
      if (!numeric) return NOT_SOLVABLE;
      return target ? number : round(number + step);
    case 'in':
      if (!Array.isArray(expected) || !expected.length) return NOT_SOLVABLE;
      return target ? expected[0] : differentFrom(expected[0]);
    case 'not_in':
      if (!Array.isArray(expected) || !expected.length) return NOT_SOLVABLE;
      return target ? differentFrom(expected[0]) : expected[0];
    case 'contains':
    case 'starts_with':
    case 'ends_with':
      if (typeof expected !== 'string') return NOT_SOLVABLE;
      if (!target) return differentFrom(expected);
      return operator === 'contains' ? `x${expected}x` : buildAffix(operator, expected);
    default:
      return NOT_SOLVABLE;
  }
}

function buildAffix(operator: string, expected: string): string {
  return operator === 'starts_with' ? `${expected}X` : `X${expected}`;
}

/**
 * Un valor distinto del esperado que el CONTRATO siga aceptando.
 *
 * Con una enumeración cerrada esto importa: para esquivar `kyc_status == REJECTED` hay
 * que elegir otro valor de la lista, no inventar `NO_REJECTED`. Ese invento rompía el
 * contrato, y el caso moría con VARIABLE_MISSING_OR_INVALID sin llegar a la rama que
 * decía probar.
 */
function differentFrom(
  expected: unknown,
  current: unknown,
  variable: GeneratorContractVariable,
): unknown {
  const allowed = resolvedConstraintsOf(variable).allowedValues;
  const alternative = allowed?.find((candidate) => candidate !== expected);
  if (alternative !== undefined) return alternative;
  if (typeof expected === 'number') return expected + 1;
  if (typeof expected === 'boolean') return !expected;
  if (typeof current === 'string' && current !== expected) return current;
  return `NO_${String(expected)}`;
}

function round(value: number): number {
  return Number(value.toFixed(10));
}

/** Cómo se llama el desenlace: la acción terminal manda sobre la etiqueta del nodo. */
function outcomeLabel(compiled: CompiledDecisionArtifact, nodeKey: string): string {
  const node: GraphNodeSnapshot | undefined = compiled.nodes[nodeKey];
  if (!node) return nodeKey;
  const terminalAction = [...node.actions]
    .sort((a, b) => a.order - b.order)
    .map((reference) => compiled.actions[reference.code])
    .find((action) => action?.terminal);
  const outcome = terminalAction?.payload?.outcome ?? terminalAction?.payload?.value;
  if (typeof outcome === 'string' && outcome.trim()) return outcome;
  return node.label || nodeKey;
}

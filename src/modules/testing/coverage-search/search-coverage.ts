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
import type { CompiledDecisionArtifact } from '../../graph/graph.types';
import { parseWorkerCall } from '../../graph/worker-call';
import type { GeneratorContractVariable } from '../../qa-lab/contract-value-factory';
import type { SeededRandom } from '../../qa-lab/seeded-random';
import { comparedLiterals } from './compared-literals';
import { edgeGoals, pathsTo } from './edge-goals';
import { calmValue, inputDimension } from './input-dimensions';
import { GoalDistance } from './goal-distance';
import { minimize } from './minimize';
import { ShadowModel } from './shadow-model';
import type {
  CoverageBudget,
  CoverageCandidate,
  CoverageCase,
  CoverageSearchResult,
  Dimension,
  Goal,
  Observe,
} from './types';
import { workerDimensions } from './worker-dimensions';

const MAX_CLIMB_STEPS = 60;
const MAX_PATHS_PER_EDGE = 4;

function clone(candidate: CoverageCandidate): CoverageCandidate {
  return JSON.parse(JSON.stringify(candidate)) as CoverageCandidate;
}

function percentage(covered: number, total: number): number {
  return total ? Math.round((covered / total) * 10_000) / 100 : 100;
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
  const meter = new GoalDistance(shadow);

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
    return goals.map((goal) => meter.distance(goal.expression, goal.truth, context));
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
                meter.distance(goals[index].expression, goals[index].truth, context),
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

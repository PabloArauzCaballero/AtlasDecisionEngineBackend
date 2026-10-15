import { ExpressionEvaluator } from '../../graph/expression-evaluator';
import type { CompiledDecisionArtifact } from '../../graph/graph.types';
import { buildValidValue, type GeneratorContractVariable } from '../contract-value-factory';
import type { SeededRandom } from '../seeded-random';
import { steer } from './condition-steering';
import { verifyPath } from './edge-verdict';
import { drawWithin, type Bounds } from './numeric-bounds';
import { outcomeLabel, pathsByOutcome } from './outcome-paths';
import type { OutcomeCase } from './types';

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
    // `defineProperty` y no `input[code] = …`: el código viene del contrato, y un `__proto__`
    // asignado por corchetes cambiaría el prototipo en vez de crear la propiedad.
    Object.defineProperty(input, variable.code, {
      value: generated.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
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

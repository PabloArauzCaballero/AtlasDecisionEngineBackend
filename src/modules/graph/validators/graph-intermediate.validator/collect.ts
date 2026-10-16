import { extractTemplateReferences } from '../../template-reference';
import { workerArgumentIntermediatesOf, workerOutputCodesOf } from '../../worker-call';
import type { ArtifactGraphSnapshot, GraphNodeSnapshot } from '../../graph.types';
import { INTERMEDIATE_PREFIX, IntermediateWrite } from './validate';

/**
 * Escrituras declaradas por cada nodo: las asignaciones directas de
 * `config.intermediateAssignments`, los resultados de los campos calculados que el nodo
 * invoca y las proyecciones de la respuesta de un servicio en un nodo `WORKER`. Las tres
 * pasan por la misma autorización, así que las tres cuentan como productor.
 */
export function collectWrites(snapshot: ArtifactGraphSnapshot): IntermediateWrite[] {
  return snapshot.nodes.flatMap((node) => [
    ...intermediateAssignmentsOf(node).map((assignment) => ({
      nodeKey: node.key,
      code: String(assignment.code ?? ''),
    })),
    ...(node.calculatedFieldCalls ?? [])
      .filter((call) => call.target?.kind === 'INTERMEDIATE')
      .map((call) => ({ nodeKey: node.key, code: call.target.code })),
    ...workerOutputCodesOf(node).map((code) => ({ nodeKey: node.key, code })),
  ]);
}

export function intermediateAssignmentsOf(node: GraphNodeSnapshot): Array<Record<string, unknown>> {
  const raw = (node.config as { intermediateAssignments?: unknown }).intermediateAssignments;
  return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
}

/** Lecturas `intermediate.<code>` que hace cada nodo (condiciones, expresiones, plantillas). */
export function collectReads(snapshot: ArtifactGraphSnapshot): Map<string, Set<string>> {
  const conditionsByCode = new Map(
    snapshot.conditions.map((condition) => [condition.code, condition]),
  );
  const reads = new Map<string, Set<string>>();
  const add = (nodeKey: string, value: unknown): void => {
    const found = referencedIntermediates(value);
    if (!found.length) return;
    const existing = reads.get(nodeKey) ?? new Set<string>();
    for (const code of found) existing.add(code);
    reads.set(nodeKey, existing);
  };

  const addBareCode = (nodeKey: string, code: string): void => {
    const existing = reads.get(nodeKey) ?? new Set<string>();
    existing.add(code);
    reads.set(nodeKey, existing);
  };

  for (const node of snapshot.nodes) {
    add(node.key, node.config);
    for (const call of node.calculatedFieldCalls ?? []) {
      for (const entry of Object.values(call.inputMapping ?? {})) {
        if (entry.source === 'INTERMEDIATE' && entry.path) {
          addBareCode(node.key, String(entry.path));
        }
      }
    }
    // Un argumento de una llamada a servicio nombra la intermedia SIN el prefijo
    // `intermediate.`, igual que la entrada de un campo calculado, así que el recorrido de
    // cadenas de `add()` no lo ve. Sin esto, un nodo `WORKER` podría alimentar su llamada
    // con una variable que en ese punto del grafo todavía no existe.
    for (const code of workerArgumentIntermediatesOf(node)) {
      addBareCode(node.key, code);
    }
    for (const binding of node.conditions) {
      add(node.key, conditionsByCode.get(binding.code)?.expression);
    }
  }
  for (const edge of snapshot.edges) {
    for (const binding of edge.conditions) {
      // Una condición de arista se evalúa en el nodo origen: es allí donde la
      // variable tiene que estar disponible.
      add(edge.from, conditionsByCode.get(binding.code)?.expression);
    }
  }
  return reads;
}

/** Todos los `intermediate.<code>` alcanzables dentro de un valor JSON arbitrario. */
export function referencedIntermediates(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (current: unknown): void => {
    if (typeof current === 'string') {
      if (current.startsWith(INTERMEDIATE_PREFIX)) {
        found.add(current.slice(INTERMEDIATE_PREFIX.length).split('.')[0]);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (current && typeof current === 'object') {
      for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
        // `{ var: 'intermediate.dti' }` y `{ intermediateAssignments: [{ code }] }`
        // ya quedan cubiertos por el recorrido de cadenas; aquí solo se evita
        // confundir la clave con el valor.
        if (key === 'intermediateAssignments') continue;
        walk(entry);
      }
      return;
    }
  };
  walk(value);
  for (const path of extractTemplateReferences(value)) {
    if (path.startsWith(INTERMEDIATE_PREFIX)) {
      found.add(path.slice(INTERMEDIATE_PREFIX.length).split('.')[0]);
    }
  }
  return [...found];
}

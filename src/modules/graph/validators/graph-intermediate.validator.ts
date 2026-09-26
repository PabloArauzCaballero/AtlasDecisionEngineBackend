/**
 * Reglas estáticas de las variables intermedias (§2.3).
 *
 * La disponibilidad se calcula aquí, en validación, y no en ejecución: el requisito es
 * que el motor IMPIDA leer una intermedia antes de crearla, y eso solo se puede
 * garantizar demostrando que el nodo productor domina a todos los lectores en el grafo.
 * Comprobarlo en runtime detectaría el fallo una ejecución demasiado tarde.
 */
import { normalizeDataTypeOrString } from '../../../common/contracts/data-types';
import { extractTemplateReferences } from '../template-reference';
import { workerArgumentIntermediatesOf, workerOutputCodesOf } from '../worker-call';
import type { ArtifactGraphSnapshot, GraphNodeSnapshot, ValidationIssue } from '../graph.types';
import type { GraphLookups } from './graph-lookups';
import { issue } from './validation-issue';

export interface GraphIntermediateResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const INTERMEDIATE_PREFIX = 'intermediate.';

/** Una escritura declarada por un nodo sobre una variable intermedia. */
interface IntermediateWrite {
  nodeKey: string;
  code: string;
}

export function validateGraphIntermediates(
  snapshot: ArtifactGraphSnapshot,
  lookups: GraphLookups,
): GraphIntermediateResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (!snapshot.intermediates.length && !collectWrites(snapshot).length) {
    return { errors, warnings };
  }

  const declared = new Map(snapshot.intermediates.map((entry) => [entry.code, entry]));

  // Colisiones de nombre: una intermedia que se llama igual que una entrada o una
  // salida vuelve ambiguo cualquier `{{ codigo }}` de una plantilla.
  for (const intermediate of snapshot.intermediates) {
    if (lookups.variableCodes.has(intermediate.code)) {
      errors.push(
        issue(
          'INTERMEDIATE_NAME_COLLISION',
          `La variable intermedia ${intermediate.code} colisiona con una variable del contrato público`,
          'VARIABLE',
          intermediate.code,
        ),
      );
    }
    if (!lookups.nodeKeys.has(intermediate.producerNodeKey)) {
      errors.push(
        issue(
          'INTERMEDIATE_PRODUCER_MISSING',
          `La variable intermedia ${intermediate.code} declara el nodo productor ${intermediate.producerNodeKey}, que no existe`,
          'VARIABLE',
          intermediate.code,
        ),
      );
    }
    for (const consumer of intermediate.consumerNodeKeys) {
      if (!lookups.nodeKeys.has(consumer)) {
        errors.push(
          issue(
            'INTERMEDIATE_CONSUMER_MISSING',
            `La variable intermedia ${intermediate.code} autoriza al nodo ${consumer}, que no existe`,
            'VARIABLE',
            intermediate.code,
          ),
        );
      }
    }
    if (normalizeDataTypeOrString(intermediate.dataType) !== intermediate.dataType.toUpperCase()) {
      // Solo advertencia: el alias se normaliza, pero conviene que el autor lo vea.
      warnings.push(
        issue(
          'INTERMEDIATE_TYPE_ALIAS',
          `El tipo ${intermediate.dataType} de ${intermediate.code} se normaliza a ${normalizeDataTypeOrString(intermediate.dataType)}`,
          'VARIABLE',
          intermediate.code,
        ),
      );
    }
  }

  // Escrituras: solo el nodo productor puede escribir, y solo sobre lo declarado.
  const writes = collectWrites(snapshot);
  for (const write of writes) {
    const intermediate = declared.get(write.code);
    if (!intermediate) {
      errors.push(
        issue(
          'INTERMEDIATE_NOT_DECLARED',
          `El nodo ${write.nodeKey} escribe la variable intermedia ${write.code}, que no está declarada`,
          'NODE',
          write.nodeKey,
        ),
      );
      continue;
    }
    if (intermediate.producerNodeKey !== write.nodeKey) {
      errors.push(
        issue(
          'INTERMEDIATE_WRITE_UNAUTHORIZED',
          `Solo ${intermediate.producerNodeKey} puede escribir ${write.code}; lo intenta ${write.nodeKey}`,
          'NODE',
          write.nodeKey,
        ),
      );
    }
  }
  const writtenCodes = new Set(writes.map((write) => write.code));
  for (const intermediate of snapshot.intermediates) {
    if (!writtenCodes.has(intermediate.code) && intermediate.initialValue === undefined) {
      errors.push(
        issue(
          'INTERMEDIATE_NEVER_WRITTEN',
          `La variable intermedia ${intermediate.code} no la escribe ningún nodo y no tiene valor inicial`,
          'VARIABLE',
          intermediate.code,
        ),
      );
    }
  }

  const dominators = computeDominators(snapshot);
  const reads = collectReads(snapshot);
  for (const [nodeKey, codes] of reads) {
    for (const code of codes) {
      const intermediate = declared.get(code);
      if (!intermediate) {
        errors.push(
          issue(
            'INTERMEDIATE_NOT_DECLARED',
            `El nodo ${nodeKey} lee la variable intermedia ${code}, que no está declarada`,
            'NODE',
            nodeKey,
          ),
        );
        continue;
      }
      if (
        intermediate.consumerNodeKeys.length &&
        !intermediate.consumerNodeKeys.includes(nodeKey) &&
        nodeKey !== intermediate.producerNodeKey
      ) {
        errors.push(
          issue(
            'INTERMEDIATE_READ_UNAUTHORIZED',
            `El nodo ${nodeKey} no está autorizado a leer ${code}`,
            'NODE',
            nodeKey,
          ),
        );
      }
      // Con valor inicial la variable está disponible desde el arranque; sin él, el
      // productor tiene que ejecutarse necesariamente antes que el lector.
      const availableFromStart = intermediate.initialValue !== undefined;
      const producerDominates =
        nodeKey === intermediate.producerNodeKey ||
        (dominators.get(nodeKey)?.has(intermediate.producerNodeKey) ?? false);
      if (!availableFromStart && !producerDominates) {
        errors.push(
          issue(
            'INTERMEDIATE_READ_BEFORE_WRITE',
            `El nodo ${nodeKey} puede leer ${code} por caminos en los que ${intermediate.producerNodeKey} no se ha ejecutado`,
            'NODE',
            nodeKey,
          ),
        );
      }
    }
  }

  const readCodes = new Set([...reads.values()].flatMap((codes) => [...codes]));
  const mappedToOutput = new Set(
    snapshot.outputContract
      .filter((field) => field.sourceKind === 'INTERMEDIATE')
      .map((field) => field.sourceRef),
  );
  for (const intermediate of snapshot.intermediates) {
    if (!readCodes.has(intermediate.code) && !mappedToOutput.has(intermediate.code)) {
      warnings.push(
        issue(
          'INTERMEDIATE_UNUSED',
          `La variable intermedia ${intermediate.code} se crea pero nunca se consume`,
          'VARIABLE',
          intermediate.code,
        ),
      );
    }
  }

  // Una intermedia no puede convertirse en salida final sin un mapeo explícito (§2.3).
  for (const field of snapshot.outputContract) {
    if (field.sourceKind === 'INTERMEDIATE' && !declared.has(field.sourceRef)) {
      errors.push(
        issue(
          'OUTPUT_SOURCE_INTERMEDIATE_MISSING',
          `El campo de salida ${field.code} mapea la intermedia ${field.sourceRef}, que no está declarada`,
          'VARIABLE',
          field.code,
        ),
      );
    }
  }

  return { errors, warnings };
}

/**
 * Escrituras declaradas por cada nodo: las asignaciones directas de
 * `config.intermediateAssignments`, los resultados de los campos calculados que el nodo
 * invoca y las proyecciones de la respuesta de un servicio en un nodo `WORKER`. Las tres
 * pasan por la misma autorización, así que las tres cuentan como productor.
 */
function collectWrites(snapshot: ArtifactGraphSnapshot): IntermediateWrite[] {
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
function collectReads(snapshot: ArtifactGraphSnapshot): Map<string, Set<string>> {
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

/**
 * Dominadores por iteración de punto fijo: `dom(n)` es el conjunto de nodos por los que
 * pasa OBLIGATORIAMENTE cualquier camino desde START hasta `n`. Es la única forma
 * correcta de responder "¿está esta variable siempre creada cuando llego aquí?" en un
 * grafo con ramas; una simple búsqueda de alcanzabilidad diría que sí en cuanto exista
 * UN camino que pase por el productor.
 */
function computeDominators(snapshot: ArtifactGraphSnapshot): Map<string, Set<string>> {
  const start = snapshot.nodes.find((node) => node.type === 'START');
  const allKeys = snapshot.nodes.map((node) => node.key);
  const dominators = new Map<string, Set<string>>();
  if (!start) return dominators;

  const predecessors = new Map<string, string[]>();
  for (const edge of snapshot.edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  }
  for (const key of allKeys) {
    dominators.set(key, key === start.key ? new Set([start.key]) : new Set(allKeys));
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const key of allKeys) {
      if (key === start.key) continue;
      const preds = predecessors.get(key) ?? [];
      // Un nodo inalcanzable no tiene predecesores: su conjunto se queda vacío para
      // que ninguna lectura suya se considere "cubierta" por accidente.
      let intersection: Set<string> = preds.length
        ? new Set(dominators.get(preds[0]) ?? [])
        : new Set();
      for (const pred of preds.slice(1)) {
        const predDom = dominators.get(pred) ?? new Set<string>();
        intersection = new Set([...intersection].filter((entry) => predDom.has(entry)));
      }
      intersection.add(key);
      const current = dominators.get(key)!;
      if (intersection.size !== current.size || [...intersection].some((e) => !current.has(e))) {
        dominators.set(key, intersection);
        changed = true;
      }
    }
  }
  return dominators;
}

import { normalizeDataTypeOrString } from '../../../../common/contracts/data-types';
import type { ArtifactGraphSnapshot, ValidationIssue } from '../../graph.types';
import type { GraphLookups } from '../graph-lookups';
import { issue } from '../validation-issue';
import { collectReads, collectWrites } from './collect';
import { computeDominators } from './dominators';

export interface GraphIntermediateResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export const INTERMEDIATE_PREFIX = 'intermediate.';

/** Una escritura declarada por un nodo sobre una variable intermedia. */
export interface IntermediateWrite {
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

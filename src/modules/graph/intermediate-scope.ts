/**
 * Ámbito temporal de las variables intermedias de UNA ejecución (§2.1).
 *
 * El objeto se crea al empezar `execute()` y se descarta al terminar: no hay caché,
 * ni estado de módulo, ni nada que sobreviva entre ejecuciones. Esa es exactamente la
 * garantía que pide §2.1 ("no debe reutilizarse entre ejecuciones", "debe desaparecer
 * cuando termina o falla la ejecución"), y por eso vive aquí y no en el servicio
 * inyectable, que es un singleton compartido por todas las peticiones.
 */
import {
  validateAgainstConstraints,
  parseConstraints,
} from '../../common/contracts/constraint-engine';
import { DomainException } from '../../common/errors/domain-exception';
import type { IntermediateStateEntry, IntermediateVariableSnapshot } from './graph.types';

/** Subconjunto de estados que una intermedia puede alcanzar (§3.1). */
export type IntermediateState = Extract<
  IntermediateStateEntry['state'],
  'NOT_AVAILABLE' | 'AVAILABLE' | 'COMPUTED' | 'UPDATED' | 'CONSUMED' | 'INVALID' | 'REDACTED'
>;

export type IntermediateSnapshotEntry = IntermediateStateEntry;

interface Slot {
  definition: IntermediateVariableSnapshot;
  value: unknown;
  previousValue?: unknown;
  state: IntermediateState;
  writes: number;
  writtenByNodeKey?: string;
  createdAtStepIndex?: number;
  consumedBy: Set<string>;
}

export class IntermediateScope {
  private readonly slots = new Map<string, Slot>();
  /**
   * Paso de la traza que se está ejecutando. El ámbito no lo deduce: lo fija el motor al
   * entrar en cada nodo, porque es él quien lleva el recorrido. Empieza en -1 para que una
   * escritura hecha sin haber entrado en ningún paso —que no debería ocurrir— no se
   * atribuya al paso 0.
   */
  private currentStepIndex = -1;

  constructor(definitions: readonly IntermediateVariableSnapshot[]) {
    for (const definition of definitions) {
      const hasInitial = definition.initialValue !== undefined;
      this.slots.set(definition.code, {
        definition,
        value: hasInitial ? definition.initialValue : undefined,
        state: hasInitial ? 'AVAILABLE' : 'NOT_AVAILABLE',
        writes: 0,
        consumedBy: new Set(),
      });
    }
  }

  get size(): number {
    return this.slots.size;
  }

  /** El motor anuncia en qué paso de la traza está, para poder fechar cada creación. */
  enterStep(stepIndex: number): void {
    this.currentStepIndex = stepIndex;
  }

  /**
   * Vista de solo lectura para las expresiones: `intermediate.<code>`.
   *
   * Cada código se expone como un getter, no como un valor copiado, para que el
   * "nodo consumidor" que acaba en la traza sea el que realmente leyó la variable y
   * no todo nodo para el que se construyó un contexto.
   */
  readableView(readerNodeKey: string): Record<string, unknown> {
    const view: Record<string, unknown> = {};
    for (const [code, slot] of this.slots) {
      if (slot.state === 'NOT_AVAILABLE') continue;
      if (!this.canRead(slot, readerNodeKey)) continue;
      Object.defineProperty(view, code, {
        enumerable: true,
        get: () => {
          slot.consumedBy.add(readerNodeKey);
          if (slot.state === 'AVAILABLE' || slot.state === 'COMPUTED' || slot.state === 'UPDATED') {
            slot.state = 'CONSUMED';
          }
          return slot.value;
        },
      });
    }
    return view;
  }

  /**
   * Escribe una intermedia. Falla cerrado ante toda la casuística de §2.3: variable
   * inexistente, nodo no autorizado, tipo incompatible y reescritura no permitida.
   */
  write(code: string, nodeKey: string, value: unknown): void {
    const slot = this.slots.get(code);
    if (!slot) {
      throw new DomainException(
        'INTERMEDIATE_NOT_DECLARED',
        `El nodo ${nodeKey} intenta escribir la variable intermedia ${code}, que no está declarada`,
      );
    }
    if (slot.definition.producerNodeKey !== nodeKey) {
      throw new DomainException(
        'INTERMEDIATE_WRITE_UNAUTHORIZED',
        `Solo ${slot.definition.producerNodeKey} puede escribir la variable intermedia ${code}`,
      );
    }
    if (slot.writes > 0 && slot.definition.updatePolicy === 'SINGLE_WRITE') {
      throw new DomainException(
        'INTERMEDIATE_ALREADY_WRITTEN',
        `La variable intermedia ${code} es de escritura única y ya tiene valor`,
      );
    }

    const next =
      slot.definition.updatePolicy === 'ACCUMULATE' && slot.writes > 0
        ? accumulate(slot.value, value, code)
        : value;

    if (next === null || next === undefined) {
      if (!slot.definition.nullable) {
        throw new DomainException(
          'INTERMEDIATE_NULL_NOT_ALLOWED',
          `La variable intermedia ${code} no admite valores nulos`,
        );
      }
    } else {
      const violations = validateAgainstConstraints(
        slot.definition.dataType,
        parseConstraints(slot.definition.constraints),
        next,
        { siblings: {} },
      );
      if (violations.length) {
        slot.state = 'INVALID';
        throw new DomainException(
          'INTERMEDIATE_VALUE_INVALID',
          `La variable intermedia ${code} ${violations[0].message}`,
        );
      }
    }

    slot.previousValue = slot.writes > 0 ? slot.value : undefined;
    // Solo la PRIMERA escritura crea la variable; una reescritura (OVERWRITE/ACCUMULATE)
    // la actualiza, y confundir ambas haría que el paso de creación se moviera hacia
    // delante justo en las trazas largas donde sirve para algo.
    if (slot.writes === 0 && this.currentStepIndex >= 0) {
      slot.createdAtStepIndex = this.currentStepIndex;
    }
    slot.value = next;
    slot.writes += 1;
    slot.writtenByNodeKey = nodeKey;
    slot.state = slot.writes > 1 ? 'UPDATED' : 'COMPUTED';
  }

  /** ¿Puede este nodo leer la variable, según los consumidores autorizados? */
  private canRead(slot: Slot, readerNodeKey: string): boolean {
    if (!slot.definition.consumerNodeKeys.length) return true;
    return (
      slot.definition.consumerNodeKeys.includes(readerNodeKey) ||
      slot.definition.producerNodeKey === readerNodeKey
    );
  }

  /** Estado de todas las intermedias, sanitizado para la traza (§2.2 / §3.2). */
  snapshot(): IntermediateSnapshotEntry[] {
    return [...this.slots.values()].map((slot) => ({
      code: slot.definition.code,
      dataType: slot.definition.dataType,
      state: slot.definition.tracePolicy === 'REDACTED' ? 'REDACTED' : slot.state,
      value: sanitize(slot.value, slot.definition.tracePolicy),
      producerNodeKey: slot.definition.producerNodeKey,
      writtenByNodeKey: slot.writtenByNodeKey,
      consumedByNodeKeys: [...slot.consumedBy].sort(),
      previousValue: sanitize(slot.previousValue, slot.definition.tracePolicy),
      createdAtStepIndex: slot.createdAtStepIndex,
      sensitivityClass: slot.definition.sensitivityClass,
      tracePolicy: slot.definition.tracePolicy,
    }));
  }

  /** Valor actual de una intermedia, sin marcarla como consumida. Solo para mapeos de salida. */
  peek(code: string): { available: boolean; value: unknown } {
    const slot = this.slots.get(code);
    if (!slot || slot.state === 'NOT_AVAILABLE') return { available: false, value: undefined };
    return { available: true, value: slot.value };
  }
}

/** Aplica la política de traza a un valor antes de que salga del motor. */
export function sanitize(value: unknown, tracePolicy: string): unknown {
  if (value === undefined) return undefined;
  switch (tracePolicy) {
    case 'EXCLUDED':
    case 'REDACTED':
      return null;
    case 'MASKED':
      return maskValue(value);
    default:
      return value;
  }
}

function maskValue(value: unknown): unknown {
  if (typeof value === 'number') return '***';
  if (typeof value === 'string') {
    // Se conservan los dos últimos caracteres: bastan para cotejar un caso en soporte
    // sin revelar el dato completo.
    return value.length <= 2 ? '**' : `${'*'.repeat(value.length - 2)}${value.slice(-2)}`;
  }
  if (Array.isArray(value)) return `***[${value.length}]`;
  if (value && typeof value === 'object') return '***{}';
  return '***';
}

function accumulate(current: unknown, addition: unknown, code: string): unknown {
  if (typeof current === 'number' && typeof addition === 'number') return current + addition;
  if (Array.isArray(current)) return [...current, addition];
  if (typeof current === 'string' && typeof addition === 'string') return current + addition;
  if (current === undefined) return addition;
  throw new DomainException(
    'INTERMEDIATE_ACCUMULATE_UNSUPPORTED',
    `La variable intermedia ${code} no admite acumulación para este tipo de valor`,
  );
}

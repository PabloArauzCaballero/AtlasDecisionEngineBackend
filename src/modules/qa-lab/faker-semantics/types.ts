export type FakerType = 'caso' | 'comercio';

/** Un elemento de cada faker pedido, para el mismo índice de caso. */
export interface FakerRecord {
  caso?: Record<string, unknown>;
  comercio?: Record<string, unknown>;
}

export interface SemanticRule {
  /** Nombre estable del dato, para el informe («persona.documentNumber»). */
  field: string;
  type: FakerType;
  /** Valores candidatos, en orden de preferencia; el primero que el contrato acepte gana. */
  pick: (record: Record<string, unknown>) => unknown[];
}

export type Tokens = ReadonlySet<string>;

export interface RuleDefinition extends SemanticRule {
  matches: (tokens: Tokens) => boolean;
}

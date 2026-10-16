export class ExpressionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionParseError';
  }
}

/** Nodo interno para literales de objeto/diccionario; nunca llega al motor. */
export const OBJECT_OP = '__object';
export interface ObjectAst {
  op: typeof OBJECT_OP;
  entries: Array<{ key: string; value: unknown }>;
}

export function isObjectAst(value: unknown): value is ObjectAst {
  return Boolean(value) && typeof value === 'object' && (value as ObjectAst).op === OBJECT_OP;
}

/** Resuelve un identificador suelto: variable local ya calculada o del contrato. */
export type NameResolver = (name: string) => unknown;

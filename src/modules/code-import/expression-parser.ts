import type { ImportLanguage } from './code-import.types';

/**
 * Traduce una expresión de JavaScript o Python al AST determinista que evalúa el
 * motor (ver expression-evaluator.ts: op/left/right, and/or/not, if, add/sub/...).
 *
 * Es un parser de precedencia por descenso recursivo sobre un subconjunto
 * deliberadamente pequeño: comparaciones, lógica booleana, aritmética, ternarios,
 * literales, acceso a `variables` y las funciones min/max/round. Todo lo que
 * quede fuera lanza {@link ExpressionParseError}, y quien llama degrada a un nodo
 * de script en vez de inventarse una condición — una regla mal traducida cambiaría
 * decisiones de crédito en silencio.
 */

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

interface Token {
  type: 'number' | 'string' | 'name' | 'punct';
  value: string;
}

const PUNCTUATION = [
  '===',
  '!==',
  '==',
  '!=',
  '>=',
  '<=',
  '&&',
  '||',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  '.',
  '+',
  '-',
  '*',
  '/',
  '%',
  '>',
  '<',
  '?',
  '!',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '#' || (char === '/' && source[index + 1] === '/')) break;
    if (char === '"' || char === "'") {
      let value = '';
      index += 1;
      while (index < source.length && source[index] !== char) {
        if (source[index] === '\\') index += 1;
        value += source[index];
        index += 1;
      }
      if (index >= source.length) throw new ExpressionParseError('cadena sin cerrar');
      index += 1;
      tokens.push({ type: 'string', value });
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      let value = '';
      while (index < source.length && /[0-9._]/.test(source[index])) {
        if (source[index] !== '_') value += source[index];
        index += 1;
      }
      tokens.push({ type: 'number', value });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      let value = '';
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        value += source[index];
        index += 1;
      }
      tokens.push({ type: 'name', value });
      continue;
    }
    const punct = PUNCTUATION.find((candidate) => source.startsWith(candidate, index));
    if (!punct) throw new ExpressionParseError(`carácter no soportado: ${char}`);
    tokens.push({ type: 'punct', value: punct });
    index += punct.length;
  }
  return tokens;
}

const COMPARISONS: Record<string, string> = {
  '==': 'eq',
  '===': 'eq',
  '!=': 'neq',
  '!==': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly language: ImportLanguage,
    private readonly resolveName: NameResolver,
  ) {}

  parse(): unknown {
    const value = this.parseTernary();
    if (this.position < this.tokens.length) {
      throw new ExpressionParseError(
        `sobra "${this.peek()?.value ?? ''}" al final de la expresión`,
      );
    }
    return value;
  }

  /** Sólo para literales de objeto/diccionario (cuerpo de una rama). */
  parseValue(): unknown {
    return this.parseTernary();
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  private eat(value: string): boolean {
    const token = this.peek();
    if (token && token.value === value) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new ExpressionParseError(`se esperaba "${value}"`);
    }
  }

  private parseTernary(): unknown {
    if (this.language === 'PYTHON') {
      const then = this.parseOr();
      if (!this.eat('if')) return then;
      const condition = this.parseOr();
      this.expect('else');
      return { op: 'if', condition, then, else: this.parseTernary() };
    }
    const condition = this.parseOr();
    if (!this.eat('?')) return condition;
    const then = this.parseTernary();
    this.expect(':');
    return { op: 'if', condition, then, else: this.parseTernary() };
  }

  private parseOr(): unknown {
    const args = [this.parseAnd()];
    while (this.eat(this.language === 'PYTHON' ? 'or' : '||')) args.push(this.parseAnd());
    return args.length === 1 ? args[0] : { op: 'or', args };
  }

  private parseAnd(): unknown {
    const args = [this.parseNot()];
    while (this.eat(this.language === 'PYTHON' ? 'and' : '&&')) args.push(this.parseNot());
    return args.length === 1 ? args[0] : { op: 'and', args };
  }

  private parseNot(): unknown {
    if (this.eat(this.language === 'PYTHON' ? 'not' : '!')) {
      return { op: 'not', arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parseAdditive();
    const token = this.peek();
    if (token?.type === 'punct' && COMPARISONS[token.value]) {
      this.position += 1;
      return { op: COMPARISONS[token.value], left, right: this.parseAdditive() };
    }
    if (this.language === 'PYTHON' && token?.value === 'in') {
      this.position += 1;
      return { op: 'in', left, right: this.parseAdditive() };
    }
    if (this.language === 'PYTHON' && token?.value === 'not' && this.peek(1)?.value === 'in') {
      this.position += 2;
      return { op: 'not_in', left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    for (;;) {
      if (this.eat('+')) left = { op: 'add', args: [left, this.parseMultiplicative()] };
      else if (this.eat('-')) left = { op: 'sub', args: [left, this.parseMultiplicative()] };
      else return left;
    }
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    for (;;) {
      if (this.eat('*')) left = { op: 'mul', args: [left, this.parseUnary()] };
      else if (this.eat('/')) left = { op: 'div', left, right: this.parseUnary() };
      else return left;
    }
  }

  private parseUnary(): unknown {
    if (this.eat('-')) return { op: 'sub', args: [{ value: 0 }, this.parseUnary()] };
    if (this.eat('+')) return this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const token = this.peek();
    if (!token) throw new ExpressionParseError('expresión incompleta');

    if (token.type === 'number') {
      this.position += 1;
      return { value: Number(token.value) };
    }
    if (token.type === 'string') {
      this.position += 1;
      return { value: token.value };
    }
    if (token.value === '(') {
      this.position += 1;
      const inner = this.parseTernary();
      this.expect(')');
      return inner;
    }
    if (token.value === '{') return this.parseObject();
    if (token.type === 'name') return this.parseName();
    throw new ExpressionParseError(`no se entiende "${token.value}"`);
  }

  private parseObject(): ObjectAst {
    this.expect('{');
    const entries: ObjectAst['entries'] = [];
    while (!this.eat('}')) {
      const keyToken = this.peek();
      if (!keyToken || (keyToken.type !== 'string' && keyToken.type !== 'name')) {
        throw new ExpressionParseError('la clave de un resultado debe ser un texto');
      }
      this.position += 1;
      this.expect(':');
      entries.push({ key: keyToken.value, value: this.parseTernary() });
      if (!this.eat(',') && this.peek()?.value !== '}') {
        throw new ExpressionParseError('falta una coma entre los campos del resultado');
      }
    }
    return { op: OBJECT_OP, entries };
  }

  private parseName(): unknown {
    const token = this.peek()!;
    this.position += 1;
    const literal = this.literalKeyword(token.value);
    if (literal !== undefined) return literal;

    // `variables.x`, `variables["x"]`, `variables.get("x", 0)` → { var: 'x' }
    if (token.value === 'variables' || token.value === 'input') {
      return this.parseVariableAccess();
    }
    if (this.peek()?.value === '(') return this.parseCall(token.value);
    if (this.peek()?.value === '.' || this.peek()?.value === '[') {
      throw new ExpressionParseError(`no se soporta el acceso a campos de "${token.value}"`);
    }
    const resolved = this.resolveName(token.value);
    if (resolved === undefined) {
      throw new ExpressionParseError(
        `"${token.value}" no es una variable declarada en el contrato`,
      );
    }
    return resolved;
  }

  private literalKeyword(name: string): unknown {
    if (name === 'true' || name === 'True') return { value: true };
    if (name === 'false' || name === 'False') return { value: false };
    if (name === 'null' || name === 'None' || name === 'undefined') return { value: null };
    return undefined;
  }

  private parseVariableAccess(): unknown {
    if (this.eat('.')) {
      const field = this.peek();
      if (field?.type !== 'name') throw new ExpressionParseError('falta el nombre de la variable');
      this.position += 1;
      if (field.value === 'get') return this.parseVariablesGet();
      return { var: field.value };
    }
    if (this.eat('[')) {
      const key = this.peek();
      if (key?.type !== 'string') {
        throw new ExpressionParseError('el índice de `variables` debe ser un texto');
      }
      this.position += 1;
      this.expect(']');
      return { var: key.value };
    }
    throw new ExpressionParseError('`variables` debe usarse como `variables.<nombre>`');
  }

  /** `variables.get('code')` o `variables.get('code', porDefecto)` → var / coalesce. */
  private parseVariablesGet(): unknown {
    this.expect('(');
    const key = this.peek();
    if (key?.type !== 'string') {
      throw new ExpressionParseError('`variables.get` requiere el nombre entre comillas');
    }
    this.position += 1;
    if (this.eat(')')) return { var: key.value };
    this.expect(',');
    const fallback = this.parseTernary();
    this.expect(')');
    return { op: 'coalesce', args: [{ var: key.value }, fallback] };
  }

  private parseCall(name: string): unknown {
    this.expect('(');
    const args: unknown[] = [];
    while (!this.eat(')')) {
      args.push(this.parseTernary());
      if (!this.eat(',') && this.peek()?.value !== ')') {
        throw new ExpressionParseError(`falta una coma en los argumentos de ${name}()`);
      }
    }
    const lowered = name.toLowerCase().replace(/^math\./, '');
    if (lowered === 'min' || lowered === 'max') return { op: lowered, args };
    if (lowered === 'round') {
      return { op: 'round', arg: args[0], precision: readPrecision(args[1]) };
    }
    throw new ExpressionParseError(`la función ${name}() no está soportada`);
  }
}

function readPrecision(argument: unknown): number {
  if (argument === undefined) return 0;
  const value = (argument as { value?: unknown }).value;
  if (typeof value !== 'number') {
    throw new ExpressionParseError('la precisión de round() debe ser un número fijo');
  }
  return value;
}

export function parseExpression(
  source: string,
  language: ImportLanguage,
  resolveName: NameResolver,
): unknown {
  const trimmed = source.trim();
  if (!trimmed) throw new ExpressionParseError('expresión vacía');
  return new Parser(tokenize(trimmed), language, resolveName).parse();
}

/** Valor literal de un AST `{ value }`, o `undefined` si es una expresión. */
export function literalOf(ast: unknown): unknown {
  if (!ast || typeof ast !== 'object') return undefined;
  const node = ast as Record<string, unknown>;
  return 'value' in node && Object.keys(node).length === 1 ? node.value : undefined;
}

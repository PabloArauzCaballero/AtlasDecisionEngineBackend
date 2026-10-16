import type { ImportLanguage } from '../code-import.types';
import { ExpressionParseError, NameResolver, OBJECT_OP, ObjectAst } from './ast';
import { readPrecision } from './entry';
import { Token } from './tokenizer';

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

export class Parser {
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

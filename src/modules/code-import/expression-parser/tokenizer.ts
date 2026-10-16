import { ExpressionParseError } from './ast';

export interface Token {
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

export function tokenize(source: string): Token[] {
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

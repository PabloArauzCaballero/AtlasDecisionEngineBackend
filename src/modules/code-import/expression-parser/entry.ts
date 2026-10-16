import type { ImportLanguage } from '../code-import.types';
import { ExpressionParseError, NameResolver } from './ast';
import { Parser } from './parser';
import { tokenize } from './tokenizer';

export function readPrecision(argument: unknown): number {
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

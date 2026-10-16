import { stripComment } from './lines';
import { simpleStatement } from './python';
import { ReadArm, ReadStatement } from './types';

export function readJavaScript(source: string): ReadStatement[] {
  const statements: ReadStatement[] = [];
  let index = 0;
  const lineOf = (position: number) => source.slice(0, position).split(/\r?\n/).length;

  while (index < source.length) {
    const rest = source.slice(index);
    const leading = rest.length - rest.trimStart().length;
    index += leading;
    if (index >= source.length) break;

    if (source.startsWith('//', index)) {
      index = endOfLine(source, index);
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index);
      index = close === -1 ? source.length : close + 2;
      continue;
    }
    if (/^if\s*\(/.test(source.slice(index))) {
      const parsed = readJavaScriptChain(source, index, lineOf);
      statements.push(parsed.statement);
      index = parsed.next;
      continue;
    }

    const end = statementEnd(source, index);
    const text = stripComment(source.slice(index, end)).trim();
    if (text) {
      statements.push(
        simpleStatement({ indent: 0, text: text.replace(/;$/, ''), line: lineOf(index) }),
      );
    }
    index = end;
  }
  return statements;
}

function readJavaScriptChain(
  source: string,
  start: number,
  lineOf: (position: number) => number,
): { statement: ReadStatement; next: number } {
  const arms: ReadArm[] = [];
  let index = start;
  for (;;) {
    let condition: string | undefined;
    if (/^if\s*\(/.test(source.slice(index))) {
      const open = source.indexOf('(', index);
      const close = matchDelimiter(source, open, '(', ')');
      condition = source.slice(open + 1, close);
      index = close + 1;
    }
    const bodyStart = source.indexOf('{', index);
    const bodyEnd = bodyStart === -1 ? -1 : matchDelimiter(source, bodyStart, '{', '}');
    if (bodyStart === -1 || bodyEnd === -1) {
      return {
        statement: { kind: 'unsupported', text: 'if sin bloque { }', line: lineOf(start) },
        next: source.length,
      };
    }
    arms.push({
      condition,
      body: readJavaScript(source.slice(bodyStart + 1, bodyEnd)),
      line: lineOf(index),
    });
    index = bodyEnd + 1;

    const after = source.slice(index);
    const elseMatch = /^\s*else\s*/.exec(after);
    if (!elseMatch || condition === undefined) break;
    index += elseMatch[0].length;
    if (!/^if\s*\(/.test(source.slice(index))) continue;
  }
  return { statement: { kind: 'if', arms, line: lineOf(start) }, next: index };
}

function endOfLine(source: string, index: number): number {
  const next = source.indexOf('\n', index);
  return next === -1 ? source.length : next + 1;
}

/** Fin de una sentencia simple: el `;` o el salto de línea de nivel superior. */
function statementEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (depth === 0 && (char === ';' || char === '\n')) return index + 1;
  }
  return source.length;
}

function matchDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

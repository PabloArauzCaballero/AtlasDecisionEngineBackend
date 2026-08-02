import type { ImportLanguage } from './code-import.types';

/**
 * Lee la ESTRUCTURA de un script (asignaciones, cadena if/elif/else, returns) sin
 * ejecutarlo y sin interpretar todavía las expresiones: eso lo hace después
 * {@link ../code-import/branch-extractor.service}. Python se lee por indentación y
 * JavaScript por llaves, pero ambos producen la misma lista de sentencias, así el
 * resto del pipeline es común a los dos lenguajes.
 *
 * Es a propósito un lector de un subconjunto pequeño: si aparece cualquier otra
 * cosa (bucles, funciones, try) se marca como no soportada y el importador
 * degrada a un único nodo de script en vez de adivinar el árbol.
 */

export interface ReadArm {
  /** Texto de la condición; ausente en el `else` final. */
  condition?: string;
  body: ReadStatement[];
  line: number;
}

export type ReadStatement =
  | { kind: 'assign'; name: string; expression: string; line: number }
  | { kind: 'return'; expression: string; line: number }
  | { kind: 'if'; arms: ReadArm[]; line: number }
  | { kind: 'unsupported'; text: string; line: number };

interface SourceLine {
  indent: number;
  text: string;
  line: number;
}

const ASSIGNMENT = /^(?:const|let|var\s)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*(.+)$/;

/**
 * Líneas LÓGICAS: quita comentarios y blancos, y une las líneas físicas que
 * continúan una misma sentencia porque dejan un paréntesis, corchete o llave sin
 * cerrar.
 *
 * Sin esto, un diccionario de resultado repartido en varias líneas —la forma
 * natural de escribirlo— se leía como sentencias sueltas ilegibles y el árbol no
 * se podía derivar: había que escribir cada resultado en una sola línea.
 */
function readLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let pending: SourceLine | null = null;
  let depth = 0;

  source.split(/\r?\n/).forEach((raw, index) => {
    const withoutComment = stripComment(raw);
    const text = withoutComment.trim();
    if (text === '') return;
    if (pending) pending.text += ` ${text}`;
    else {
      pending = {
        indent: withoutComment.length - withoutComment.trimStart().length,
        text,
        line: index + 1,
      };
    }
    depth = Math.max(0, depth + bracketDelta(withoutComment));
    if (depth === 0) {
      lines.push(pending);
      pending = null;
    }
  });
  // Un cierre que nunca llega (código incompleto): se conserva lo leído para que
  // el analizador de sintaxis sea quien reporte el error, no este lector.
  if (pending) lines.push(pending);
  return lines;
}

/** Saldo de aperturas menos cierres fuera de cadenas. */
function bracketDelta(line: string): number {
  let delta = 0;
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('([{'.includes(char)) delta += 1;
    else if (')]}'.includes(char)) delta -= 1;
  }
  return delta;
}

function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '#' || (char === '/' && raw[index + 1] === '/')) return raw.slice(0, index);
  }
  return raw;
}

export function readStatements(source: string, language: ImportLanguage): ReadStatement[] {
  return language === 'PYTHON'
    ? readPython(readLines(source), 0).statements
    : readJavaScript(source);
}

// --------------------------------------------------------------------------
// Python: bloques por indentación.
// --------------------------------------------------------------------------

function readPython(
  lines: SourceLine[],
  start: number,
  indent?: number,
): { statements: ReadStatement[]; next: number } {
  const statements: ReadStatement[] = [];
  const blockIndent = indent ?? lines[start]?.indent ?? 0;
  let index = start;

  while (index < lines.length && lines[index].indent >= blockIndent) {
    const current = lines[index];
    if (current.indent > blockIndent) {
      // Indentación inesperada: no se puede razonar sobre el bloque.
      statements.push({ kind: 'unsupported', text: current.text, line: current.line });
      index += 1;
      continue;
    }
    const header = /^(if|elif)\s+(.+):$/.exec(current.text) ?? /^(else)\s*:$/.exec(current.text);
    if (header && header[1] === 'if') {
      const chain = readPythonChain(lines, index);
      statements.push(chain.statement);
      index = chain.next;
      continue;
    }
    if (header) {
      // `elif`/`else` sin su `if`: la cadena la consume readPythonChain.
      statements.push({ kind: 'unsupported', text: current.text, line: current.line });
      index += 1;
      continue;
    }
    statements.push(simpleStatement(current));
    index += 1;
  }
  return { statements, next: index };
}

/** Lee `if … / elif … / else` completo a partir de la línea del `if`. */
function readPythonChain(
  lines: SourceLine[],
  start: number,
): { statement: ReadStatement; next: number } {
  const headerIndent = lines[start].indent;
  const arms: ReadArm[] = [];
  let index = start;

  for (;;) {
    const header = lines[index];
    const condition = /^(?:if|elif)\s+(.+):$/.exec(header.text)?.[1];
    const bodyStart = index + 1;
    let body: ReadStatement[] = [];
    if (bodyStart < lines.length && lines[bodyStart].indent > headerIndent) {
      const parsed = readPython(lines, bodyStart, lines[bodyStart].indent);
      body = parsed.statements;
      index = parsed.next;
    } else {
      index = bodyStart;
    }
    arms.push({ condition, body, line: header.line });

    const next = lines[index];
    if (!next || next.indent !== headerIndent) break;
    if (!/^(elif\s+.+|else\s*):$/.test(next.text)) break;
  }
  return { statement: { kind: 'if', arms, line: lines[start].line }, next: index };
}

function simpleStatement(current: SourceLine): ReadStatement {
  const text = current.text.replace(/;$/, '');
  const returnMatch = /^return\s+(.+)$/.exec(text);
  if (returnMatch) return { kind: 'return', expression: returnMatch[1], line: current.line };
  const assignment = ASSIGNMENT.exec(text);
  if (assignment) {
    return {
      kind: 'assign',
      name: assignment[1],
      expression: assignment[2],
      line: current.line,
    };
  }
  return { kind: 'unsupported', text, line: current.line };
}

// --------------------------------------------------------------------------
// JavaScript: bloques por llaves.
// --------------------------------------------------------------------------

function readJavaScript(source: string): ReadStatement[] {
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

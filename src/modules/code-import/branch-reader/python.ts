import { ASSIGNMENT, SourceLine } from './lines';
import { ReadArm, ReadStatement } from './types';

export function readPython(
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

export function simpleStatement(current: SourceLine): ReadStatement {
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

export interface SourceLine {
  indent: number;
  text: string;
  line: number;
}

export const ASSIGNMENT = /^(?:const|let|var\s)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*(.+)$/;

/**
 * Líneas LÓGICAS: quita comentarios y blancos, y une las líneas físicas que
 * continúan una misma sentencia porque dejan un paréntesis, corchete o llave sin
 * cerrar.
 *
 * Sin esto, un diccionario de resultado repartido en varias líneas —la forma
 * natural de escribirlo— se leía como sentencias sueltas ilegibles y el árbol no
 * se podía derivar: había que escribir cada resultado en una sola línea.
 */
export function readLines(source: string): SourceLine[] {
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

export function stripComment(raw: string): string {
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

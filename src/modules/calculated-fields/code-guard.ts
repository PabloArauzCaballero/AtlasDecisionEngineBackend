/**
 * Análisis estático del código de un campo calculado (§6.2, §6.3, §8).
 *
 * Es la PRIMERA barrera, no la única: el sandbox de proceso sigue siendo el límite de
 * seguridad real. Lo que se gana aquí es rechazar en tiempo de autoría lo que nunca
 * debería llegar a ejecutarse, con un mensaje que el autor entiende, y hacer cumplir
 * el límite de tres líneas que separa un campo calculado de un artefacto.
 */
export const MAX_EXECUTABLE_LINES = 3;

export interface CodeGuardResult {
  ok: boolean;
  executableLines: number;
  violations: Array<{ code: string; message: string }>;
}

/** Construcciones prohibidas, comunes a ambos lenguajes (§6.3, §8). */
const SHARED_BANS: Array<{ pattern: RegExp; code: string; message: string }> = [
  {
    pattern: /\b(import|require)\s*[\s(]/,
    code: 'IMPORT_FORBIDDEN',
    message: 'no se permiten importaciones',
  },
  {
    pattern: /\beval\b/,
    code: 'DYNAMIC_EVAL_FORBIDDEN',
    message: 'no se permite evaluación dinámica',
  },
  {
    pattern: /\bexec\b/,
    code: 'DYNAMIC_EVAL_FORBIDDEN',
    message: 'no se permite ejecución dinámica',
  },
  {
    pattern: /\b(while|for)\b/,
    code: 'LOOP_FORBIDDEN',
    message: 'no se permiten bucles; usa una operación de agregación',
  },
  {
    pattern: /__[a-zA-Z]/,
    code: 'DUNDER_FORBIDDEN',
    message: 'no se permiten atributos internos (__)',
  },
  {
    pattern: /\bglobals?\b/,
    code: 'GLOBAL_ACCESS_FORBIDDEN',
    message: 'no se permite tocar el estado global',
  },
  {
    pattern: /\b(process|os|sys|subprocess|open|fetch|XMLHttpRequest|WebSocket)\b/,
    code: 'HOST_ACCESS_FORBIDDEN',
    message: 'no se permite acceder al sistema, la red ni los ficheros',
  },
  {
    pattern: /\b(Date|datetime|time)\s*[.(]/,
    code: 'CLOCK_ACCESS_FORBIDDEN',
    message: 'no se permite leer el reloj: rompería el determinismo',
  },
  {
    pattern: /\brandom\b/,
    code: 'RANDOM_FORBIDDEN',
    message: 'no se permite aleatoriedad: rompería el determinismo',
  },
];

const JS_BANS: Array<{ pattern: RegExp; code: string; message: string }> = [
  {
    pattern: /\bFunction\s*\(/,
    code: 'DYNAMIC_EVAL_FORBIDDEN',
    message: 'no se permite construir funciones en tiempo de ejecución',
  },
  {
    pattern: /\b(setTimeout|setInterval|queueMicrotask|Promise)\b/,
    code: 'ASYNC_FORBIDDEN',
    message: 'no se permite código asíncrono',
  },
  {
    pattern: /\bfunction\b|=>\s*\{[^}]*\breturn\b[^}]*\}[^;]*\(/,
    code: 'NESTED_FUNCTION_FORBIDDEN',
    message: 'define artefactos, no funciones: un campo calculado es una expresión',
  },
  { pattern: /\bclass\b/, code: 'CLASS_FORBIDDEN', message: 'no se permiten clases' },
];

const PY_BANS: Array<{ pattern: RegExp; code: string; message: string }> = [
  { pattern: /\bclass\b/, code: 'CLASS_FORBIDDEN', message: 'no se permiten clases' },
  {
    pattern: /\b(try|except|finally|raise|with|yield|async|await)\b/,
    code: 'STATEMENT_FORBIDDEN',
    message: 'no se permiten estas sentencias en un campo calculado',
  },
  {
    pattern: /\bdef\b/,
    code: 'NESTED_FUNCTION_FORBIDDEN',
    message: 'define artefactos, no funciones: un campo calculado es una expresión',
  },
  {
    pattern: /\.\s*(format|format_map)\s*\(/,
    code: 'STRING_FORMAT_FORBIDDEN',
    message: 'no se permite format()/format_map()',
  },
];

/**
 * Cuenta líneas ejecutables: no cuentan las vacías ni los comentarios. Los comentarios
 * del contrato viven en `commentsJson` y por definición no consumen presupuesto (§6.2).
 */
export function countExecutableLines(source: string, language: 'JAVASCRIPT' | 'PYTHON'): number {
  return splitExecutableLines(source, language).length;
}

export function splitExecutableLines(source: string, language: 'JAVASCRIPT' | 'PYTHON'): string[] {
  const commentPrefix = language === 'PYTHON' ? '#' : '//';
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(commentPrefix));
}

/** Elimina cadenas y comentarios para que un literal no dispare un falso positivo. */
function stripLiterals(source: string, language: 'JAVASCRIPT' | 'PYTHON'): string {
  const withoutStrings = source
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  return language === 'PYTHON'
    ? withoutStrings.replace(/#.*$/gm, '')
    : withoutStrings.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

export function guardCalculatedFieldCode(
  source: string,
  language: 'JAVASCRIPT' | 'PYTHON',
  /** Identificadores expuestos por las librerías autorizadas seleccionadas. */
  allowedLibraryFunctions: readonly string[] = [],
): CodeGuardResult {
  const violations: CodeGuardResult['violations'] = [];
  const lines = splitExecutableLines(source, language);

  if (!lines.length) {
    violations.push({
      code: 'CODE_EMPTY',
      message: 'el campo calculado no tiene código ejecutable',
    });
  }
  if (lines.length > MAX_EXECUTABLE_LINES) {
    violations.push({
      code: 'CODE_TOO_LONG',
      message: `el código tiene ${lines.length} líneas ejecutables y el máximo es ${MAX_EXECUTABLE_LINES}; conviértelo en un artefacto`,
    });
  }
  // Un punto y coma no puede usarse para meter cinco sentencias en una línea y así
  // burlar el límite: eso convertiría el tope de tres líneas en decorativo.
  const statements = lines.flatMap((line) => line.split(';').filter((part) => part.trim()));
  if (statements.length > MAX_EXECUTABLE_LINES) {
    violations.push({
      code: 'CODE_TOO_MANY_STATEMENTS',
      message: `el código tiene ${statements.length} sentencias y el máximo es ${MAX_EXECUTABLE_LINES}`,
    });
  }

  const cleaned = stripLiterals(source, language);
  const bans = [...SHARED_BANS, ...(language === 'PYTHON' ? PY_BANS : JS_BANS)];
  for (const ban of bans) {
    if (!ban.pattern.test(cleaned)) continue;
    // Una librería autorizada puede legítimamente aportar un identificador que, por sí
    // solo, coincidiría con una prohibición (p. ej. `dates_days_between`).
    if (allowedLibraryFunctions.some((fn) => cleaned.includes(fn) && ban.pattern.test(fn))) {
      continue;
    }
    violations.push({ code: ban.code, message: ban.message });
  }

  if (language === 'PYTHON' && !/\bresult\s*=/.test(cleaned)) {
    violations.push({
      code: 'PYTHON_RESULT_NOT_ASSIGNED',
      message: 'el código Python debe asignar el valor devuelto a `result`',
    });
  }
  if (language === 'JAVASCRIPT' && !/\breturn\b/.test(cleaned)) {
    violations.push({
      code: 'JS_RETURN_MISSING',
      message: 'el código JavaScript debe devolver el valor con `return`',
    });
  }

  return { ok: violations.length === 0, executableLines: lines.length, violations };
}

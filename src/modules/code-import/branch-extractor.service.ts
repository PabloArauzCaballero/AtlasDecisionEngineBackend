import { Injectable } from '@nestjs/common';
import { readStatements, type ReadArm, type ReadStatement } from './branch-reader';
import type { ImportLanguage, LineIssue, MetadataContract } from './code-import.types';
import {
  ExpressionParseError,
  isObjectAst,
  literalOf,
  parseExpression,
  type ObjectAst,
} from './expression-parser';

export interface BranchAssignment {
  outputId: string;
  /** AST del motor; si es un literal, `literal` trae su valor ya resuelto. */
  expression: unknown;
  literal?: unknown;
  isLiteral: boolean;
}

export interface DecisionBranch {
  /** Condición traducida al AST del motor; ausente en la rama por defecto (else). */
  condition?: unknown;
  conditionSource?: string;
  assignments: BranchAssignment[];
  line: number;
}

export interface BranchExtraction {
  branches: DecisionBranch[];
  /** Motivo por el que NO se pudo derivar el árbol (entonces se usa un nodo script). */
  unsupported?: LineIssue;
}

/**
 * Deriva el árbol de decisión que describe un script: cada `if/elif/else` se
 * convierte en una condición del motor y cada rama en el resultado que asigna.
 *
 * Antes, importar código generaba SIEMPRE dos nodos (inicio → un nodo script con
 * todo el código dentro): la pantalla prometía "importar código como árbol de
 * decisión" y devolvía una caja negra imposible de revisar, cubrir con pruebas o
 * explicar. Ahora el árbol es de verdad; y cuando el código usa algo fuera del
 * subconjunto soportado se devuelve el motivo exacto y el importador vuelve al
 * nodo script, sin traducir nunca una regla "a medias".
 */
@Injectable()
export class BranchExtractorService {
  extract(
    language: ImportLanguage,
    scriptBody: string,
    contract: MetadataContract,
  ): BranchExtraction {
    const statements = readStatements(scriptBody, language);
    const inputIds = new Set(contract.inputs.map((variable) => variable.id));
    const outputIds = new Set(contract.outputs.map((variable) => variable.id));
    const requiredOutputIds = new Set(
      contract.outputs.filter((variable) => variable.required).map((variable) => variable.id),
    );
    const locals = new Map<string, unknown>();
    const resolve = (name: string) =>
      locals.has(name) ? locals.get(name) : nameOf(name, inputIds);

    let chain: ReadStatement | undefined;
    for (const statement of statements) {
      if (statement.kind === 'assign') {
        try {
          locals.set(statement.name, parseExpression(statement.expression, language, resolve));
        } catch (error) {
          return { branches: [], unsupported: issueFor(error, statement.line) };
        }
        continue;
      }
      if (statement.kind === 'if') {
        if (chain) {
          return {
            branches: [],
            unsupported: unsupportedIssue(
              statement.line,
              'el código tiene más de una cadena if/else en el nivel principal',
            ),
          };
        }
        chain = statement;
        continue;
      }
      // `return result` final y sentencias sueltas: no aportan al árbol, pero
      // tampoco lo invalidan mientras la cadena ya haya asignado los resultados.
      if (statement.kind === 'unsupported') {
        return {
          branches: [],
          unsupported: unsupportedIssue(
            statement.line,
            `no se entiende la sentencia "${truncate(statement.text, 60)}"`,
          ),
        };
      }
    }

    // Un script sin ramas (una sola expresión, un único return) no es un error:
    // simplemente se importa como un nodo de script y la vista previa ya lo dice.
    if (!chain || chain.kind !== 'if') return { branches: [] };
    if (!chain.arms.some((arm) => arm.condition === undefined)) {
      return {
        branches: [],
        unsupported: unsupportedIssue(
          chain.line,
          'la cadena no tiene una rama `else`: falta el camino por defecto',
        ),
      };
    }

    const branches: DecisionBranch[] = [];
    for (const arm of chain.arms) {
      const branch = this.readArm(arm, language, locals, resolve, outputIds, requiredOutputIds);
      if ('unsupported' in branch) return { branches: [], unsupported: branch.unsupported };
      branches.push(branch.branch);
    }
    return { branches };
  }

  private readArm(
    arm: ReadArm,
    language: ImportLanguage,
    outerLocals: Map<string, unknown>,
    resolveOuter: (name: string) => unknown,
    outputIds: Set<string>,
    requiredOutputIds: Set<string>,
  ): { branch: DecisionBranch } | { unsupported: LineIssue } {
    const locals = new Map(outerLocals);
    const resolve = (name: string) => (locals.has(name) ? locals.get(name) : resolveOuter(name));

    let condition: unknown;
    if (arm.condition !== undefined) {
      try {
        condition = parseExpression(arm.condition, language, resolve);
      } catch (error) {
        return { unsupported: issueFor(error, arm.line) };
      }
    }

    let result: ObjectAst | undefined;
    for (const statement of arm.body) {
      if (statement.kind === 'if') {
        return {
          unsupported: unsupportedIssue(
            statement.line,
            'hay un if anidado dentro de una rama; divide el código en condiciones de un solo nivel',
          ),
        };
      }
      if (statement.kind === 'unsupported') {
        return {
          unsupported: unsupportedIssue(
            statement.line,
            `no se entiende la sentencia "${truncate(statement.text, 60)}"`,
          ),
        };
      }
      try {
        const value = parseExpression(statement.expression, language, resolve);
        if (statement.kind === 'assign') locals.set(statement.name, value);
        if (isObjectAst(value)) result = value;
      } catch (error) {
        return { unsupported: issueFor(error, statement.line) };
      }
    }

    if (!result) {
      return {
        unsupported: unsupportedIssue(
          arm.line,
          'la rama no asigna ni devuelve un objeto con los resultados declarados',
        ),
      };
    }
    const unknownKeys = result.entries
      .map((entry) => entry.key)
      .filter((key) => !outputIds.has(key));
    if (unknownKeys.length) {
      return {
        unsupported: unsupportedIssue(
          arm.line,
          `la rama escribe campos que el contrato no declara como salida: ${unknownKeys.join(', ')}`,
        ),
      };
    }
    const writtenKeys = new Set(result.entries.map((entry) => entry.key));
    const missingRequired = [...requiredOutputIds].filter((key) => !writtenKeys.has(key));

    // Every derived RESULT node is terminal. Dropping a required field here would
    // change a valid script into a graph that only fails later at runtime with
    // REQUIRED_OUTPUT_MISSING. Refuse the visual translation and preserve the
    // original script semantics instead.
    if (missingRequired.length) {
      return {
        unsupported: unsupportedIssue(
          arm.line,
          `la rama no escribe las salidas declaradas: ${missingRequired.join(', ')}`,
        ),
      };
    }

    return {
      branch: {
        condition,
        conditionSource: arm.condition?.trim(),
        line: arm.line,
        assignments: result.entries.map((entry) => {
          const literal = literalOf(entry.value);
          return {
            outputId: entry.key,
            expression: entry.value,
            literal,
            isLiteral: literal !== undefined,
          };
        }),
      },
    };
  }
}

function nameOf(name: string, inputIds: Set<string>): unknown {
  return inputIds.has(name) ? { var: name } : undefined;
}

function issueFor(error: unknown, line: number): LineIssue {
  const message =
    error instanceof ExpressionParseError ? error.message : 'expresión no soportada en el árbol';
  return unsupportedIssue(line, message);
}

function unsupportedIssue(line: number, message: string): LineIssue {
  return {
    source: 'GRAPH',
    severity: 'WARNING',
    line,
    code: 'CODE_IMPORT_TREE_NOT_DERIVABLE',
    message: `No se pudo derivar el árbol de decisión: ${message}. Se importará como un único nodo de script.`,
  };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

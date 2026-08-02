import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'node:child_process';
import * as vm from 'node:vm';
import type { ImportLanguage, LineIssue } from './code-import.types';

const PYTHON_SYNTAX_CHECK = String.raw`
import ast, sys
source = sys.stdin.read()
try:
    ast.parse(source, filename='<atlas-code-import>')
except SyntaxError as error:
    print(f"{error.lineno or 1}|{error.offset or 1}|{error.msg}")
    sys.exit(1)
`;

/**
 * Pure syntax check — does NOT execute the submitted code. JS is compiled (never
 * run) via `vm.Script`; Python is parsed (never executed) via `ast.parse` in a
 * throwaway subprocess. Both only ever return line/column/message, never a result.
 */
@Injectable()
export class SyntaxAnalyzerService {
  constructor(private readonly config: ConfigService = new ConfigService()) {}

  analyze(language: ImportLanguage, source: string): LineIssue[] {
    return language === 'PYTHON' ? this.analyzePython(source) : this.analyzeJavaScript(source);
  }

  private analyzeJavaScript(source: string): LineIssue[] {
    // The real runner always executes this source inside a function body
    // (script-node-runner.service.ts's JS_WRAPPER), where a bare `return` is valid
    // and expected. Checking the raw source as a top-level script would reject the
    // exact shape every valid RESULT-node script is written in, so the same
    // one-line wrapper is applied here before compiling — and subtracted back out
    // of any reported line number, so errors point at the user's own source line.
    const wrapped = `(function (variables, decision, output) {\n${source}\n})`;
    try {
      // Compiling never executes the script; this only validates grammar.
      new vm.Script(wrapped, { filename: 'atlas-code-import.js' });
      return [];
    } catch (error) {
      const { line, column, message } = this.parseJsErrorStack(error);
      return [
        {
          source: 'SYNTAX',
          severity: 'ERROR',
          line: Math.max(1, line - 1),
          column,
          message,
          code: 'JS_SYNTAX_ERROR',
        },
      ];
    }
  }

  private parseJsErrorStack(error: unknown): { line: number; column?: number; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? '') : '';
    const lines = stack.split('\n');
    // V8 formats a compile-time SyntaxError stack as:
    //   atlas-code-import.js:<line>
    //   <offending source line>
    //   <caret line marking the column>
    //   SyntaxError: <message>
    const locationMatch = /atlas-code-import\.js:(\d+)/.exec(lines[0] ?? '');
    const line = locationMatch ? Number(locationMatch[1]) : 1;
    const caretLine = lines.find((candidate) => /^\s*\^+\s*$/.test(candidate));
    const column = caretLine ? caretLine.indexOf('^') + 1 : undefined;
    return { line, column, message };
  }

  private analyzePython(source: string): LineIssue[] {
    const execution = spawnSync(
      this.config.get<string>('PYTHON_EXECUTABLE') ?? 'python',
      ['-I', '-S', '-B', '-c', PYTHON_SYNTAX_CHECK],
      {
        input: source,
        encoding: 'utf8',
        // The checker is a separate interpreter process. Honour the documented
        // bound so a broken Python installation cannot pin an API worker.
        timeout: this.config.get<number>('CODE_IMPORT_ANALYSIS_TIMEOUT_MS') ?? 2_000,
        windowsHide: true,
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
      },
    );
    if (execution.error) {
      return [
        {
          source: 'SYNTAX',
          severity: 'ERROR',
          line: 1,
          message: `Could not run the Python syntax checker: ${execution.error.message}`,
          code: 'PYTHON_CHECKER_UNAVAILABLE',
        },
      ];
    }
    if (execution.status === 0) return [];
    const [lineRaw, columnRaw, ...messageParts] = (execution.stdout || '').trim().split('|');
    return [
      {
        source: 'SYNTAX',
        severity: 'ERROR',
        line: Number(lineRaw) || 1,
        column: columnRaw ? Number(columnRaw) : undefined,
        message: messageParts.join('|') || 'Python syntax error',
        code: 'PYTHON_SYNTAX_ERROR',
      },
    ];
  }
}

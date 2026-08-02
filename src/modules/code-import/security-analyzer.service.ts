import { Injectable } from '@nestjs/common';
import type { ImportLanguage, LineIssue } from './code-import.types';

interface ForbiddenPattern {
  pattern: RegExp;
  code: string;
  message: string;
}

// Mirrors the intent of the existing script-node-runner sandbox (no filesystem,
// network, process, or dynamic-code access) but as a pre-flight static check the
// user sees immediately, before the code ever reaches the runner.
const JS_FORBIDDEN: ForbiddenPattern[] = [
  {
    pattern: /\brequire\s*\(/,
    code: 'JS_REQUIRE',
    message: 'require() is not allowed in imported code',
  },
  {
    pattern: /\bimport\s+/,
    code: 'JS_IMPORT',
    message: 'import statements are not allowed in imported code',
  },
  {
    pattern: /\bprocess\s*\./,
    code: 'JS_PROCESS',
    message: 'process access is not allowed in imported code',
  },
  { pattern: /\beval\s*\(/, code: 'JS_EVAL', message: 'eval() is not allowed in imported code' },
  {
    pattern: /\bnew\s+Function\s*\(/,
    code: 'JS_NEW_FUNCTION',
    message: 'new Function() is not allowed in imported code',
  },
  {
    pattern: /\bchild_process\b/,
    code: 'JS_CHILD_PROCESS',
    message: 'child_process access is not allowed in imported code',
  },
  {
    pattern: /\bfs\s*\./,
    code: 'JS_FS',
    message: 'filesystem access is not allowed in imported code',
  },
  {
    pattern: /\b__proto__\b|\bconstructor\s*\.\s*constructor\b/,
    code: 'JS_PROTO_ESCAPE',
    message: 'prototype-chain escape patterns are not allowed in imported code',
  },
];

const PYTHON_FORBIDDEN: ForbiddenPattern[] = [
  {
    pattern: /^\s*import\s+/,
    code: 'PY_IMPORT',
    message: 'import statements are not allowed in imported code',
  },
  {
    pattern: /^\s*from\s+\S+\s+import\b/,
    code: 'PY_IMPORT_FROM',
    message: 'import statements are not allowed in imported code',
  },
  {
    pattern: /\bsubprocess\b/,
    code: 'PY_SUBPROCESS',
    message: 'subprocess access is not allowed in imported code',
  },
  { pattern: /\beval\s*\(/, code: 'PY_EVAL', message: 'eval() is not allowed in imported code' },
  { pattern: /\bexec\s*\(/, code: 'PY_EXEC', message: 'exec() is not allowed in imported code' },
  {
    pattern: /\b__import__\s*\(/,
    code: 'PY_DUNDER_IMPORT',
    message: '__import__() is not allowed in imported code',
  },
  {
    pattern: /\bopen\s*\(/,
    code: 'PY_OPEN',
    message: 'open() (filesystem access) is not allowed in imported code',
  },
  {
    pattern: /__[a-zA-Z]+__/,
    code: 'PY_DUNDER',
    message: 'dunder attribute access is not allowed in imported code',
  },
  // str.format()/format_map() resolve "{0.__class__...}" field specs via getattr chains inside
  // a plain string constant, so PY_DUNDER's literal `__x__` scan can miss it when the dunder is
  // itself embedded there — flag the call sites directly (mirrors the runtime AST check added
  // to script-node-runner.service.ts / runner/server.mjs for the same escape).
  {
    pattern: /\.\s*format(?:_map)?\s*\(/,
    code: 'PY_STR_FORMAT',
    message: 'str.format()/format_map() are not allowed in imported code',
  },
];

/**
 * Static pre-flight scan for constructs the sandbox (script-node-runner.service.ts)
 * already blocks at runtime. Catching them here gives the author an immediate,
 * line-numbered explanation instead of a generic sandbox execution failure later.
 * This is defense in *depth*, not a replacement for the runtime sandbox.
 */
@Injectable()
export class SecurityAnalyzerService {
  analyze(language: ImportLanguage, source: string): LineIssue[] {
    const patterns = language === 'PYTHON' ? PYTHON_FORBIDDEN : JS_FORBIDDEN;
    const issues: LineIssue[] = [];
    const lines = source.split('\n');
    lines.forEach((lineText, index) => {
      for (const forbidden of patterns) {
        if (forbidden.pattern.test(lineText)) {
          issues.push({
            source: 'SECURITY',
            severity: 'ERROR',
            line: index + 1,
            message: forbidden.message,
            code: forbidden.code,
          });
        }
      }
    });
    return issues;
  }
}

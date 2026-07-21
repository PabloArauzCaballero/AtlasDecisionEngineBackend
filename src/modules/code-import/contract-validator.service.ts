import { Injectable } from '@nestjs/common';
import type { ContractVariable, ImportLanguage, LineIssue, MetadataContract } from './code-import.types';

const VALID_TYPES = new Set(['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'OBJECT', 'ARRAY']);
const ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/**
 * Validates the extracted contract's shape and cross-checks it against the script
 * body: every declared input/output id should actually be read/written somewhere,
 * and vice versa — a variable the code reads but the contract never declared would
 * otherwise fail silently at runtime with an "undeclared variable" error far removed
 * from its cause.
 */
@Injectable()
export class ContractValidatorService {
  validate(contract: MetadataContract, language: ImportLanguage, scriptBody: string): LineIssue[] {
    const issues: LineIssue[] = [];
    const seen = new Set<string>();

    const allVariables = [...contract.inputs, ...contract.outputs];
    if (!contract.inputs.length && !contract.outputs.length) {
      issues.push(this.issue('CONTRACT_EMPTY', 'The contract declares no inputs and no outputs', 'WARNING'));
    }

    for (const variable of allVariables) {
      this.validateVariableShape(variable, seen, issues);
    }

    if (contract.primaryOutputId && !contract.outputs.some((output) => output.id === contract.primaryOutputId)) {
      issues.push(
        this.issue(
          'CONTRACT_PRIMARY_OUTPUT_UNKNOWN',
          `primaryOutputId "${contract.primaryOutputId}" does not match any declared output id`,
        ),
      );
    }

    for (const input of contract.inputs) {
      if (!this.isReferenced(language, scriptBody, input.id, 'read')) {
        issues.push(
          this.issue(
            'CONTRACT_INPUT_UNUSED',
            `Input "${input.id}" is declared but never read in the code body`,
            'WARNING',
          ),
        );
      }
    }
    for (const output of contract.outputs) {
      if (!this.isReferenced(language, scriptBody, output.id, 'write')) {
        issues.push(
          this.issue(
            'CONTRACT_OUTPUT_UNUSED',
            `Output "${output.id}" is declared but the code body never appears to assign it`,
            'WARNING',
          ),
        );
      }
    }

    return issues;
  }

  private validateVariableShape(variable: ContractVariable, seen: Set<string>, issues: LineIssue[]): void {
    if (!variable.id || !ID_PATTERN.test(variable.id)) {
      issues.push(this.issue('CONTRACT_ID_INVALID', `Variable id "${variable.id}" must match ${ID_PATTERN}`));
      return;
    }
    if (seen.has(variable.id)) {
      issues.push(this.issue('CONTRACT_ID_DUPLICATE', `Variable id "${variable.id}" is declared more than once`));
    }
    seen.add(variable.id);
    if (!variable.name || !variable.name.trim()) {
      issues.push(this.issue('CONTRACT_NAME_MISSING', `Variable "${variable.id}" has no display name`));
    }
    if (!VALID_TYPES.has(variable.type)) {
      issues.push(
        this.issue(
          'CONTRACT_TYPE_INVALID',
          `Variable "${variable.id}" has unsupported type "${variable.type}"; expected one of ${[...VALID_TYPES].join(', ')}`,
        ),
      );
    }
    if (typeof variable.required !== 'boolean') {
      issues.push(this.issue('CONTRACT_REQUIRED_INVALID', `Variable "${variable.id}" must declare "required" as a boolean`));
    }
    if (variable.required && variable.default !== undefined) {
      issues.push(
        this.issue(
          'CONTRACT_DEFAULT_ON_REQUIRED',
          `Variable "${variable.id}" is required and also declares a default; a required input can never use it`,
          'WARNING',
        ),
      );
    }
  }

  /** A deliberately simple heuristic (substring/regex match on the property access
   *  form each language uses), not a full data-flow analysis — good enough to catch
   *  the common "declared but forgot to wire it up" mistake without false-failing
   *  the import over something a real static analyzer would be needed to prove. */
  private isReferenced(language: ImportLanguage, scriptBody: string, id: string, mode: 'read' | 'write'): boolean {
    // Matches the sandbox context the runner actually injects (script-node-runner.service.ts):
    // `variables`/`decision`/`output` — never `inputs`. Reads come from `variables`;
    // writes are the returned object (JS `return {...}`) or `result` (Python).
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (language === 'PYTHON') {
      const readPattern = new RegExp(`variables\\s*\\[\\s*['"]${escaped}['"]\\s*\\]|variables\\.get\\(\\s*['"]${escaped}['"]`);
      const writePattern = new RegExp(`result\\s*\\[\\s*['"]${escaped}['"]\\s*\\]\\s*=|result\\s*=.*['"]${escaped}['"]`);
      return mode === 'read' ? readPattern.test(scriptBody) : writePattern.test(scriptBody);
    }
    const readPattern = new RegExp(`variables\\s*(?:\\.\\s*${escaped}\\b|\\[\\s*['"]${escaped}['"]\\s*\\])`);
    const writePattern = new RegExp(`(?:return\\s*\\{[^}]*\\b${escaped}\\b|result\\s*\\.\\s*${escaped}\\s*=|result\\s*\\[\\s*['"]${escaped}['"]\\s*\\]\\s*=)`, 's');
    return mode === 'read' ? readPattern.test(scriptBody) : writePattern.test(scriptBody);
  }

  private issue(code: string, message: string, severity: 'ERROR' | 'WARNING' = 'ERROR'): LineIssue {
    return { source: 'CONTRACT', severity, line: 1, message, code };
  }
}

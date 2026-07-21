import { Injectable } from '@nestjs/common';
import type { CodeImportIR, GeneratedGraphPreview } from './code-import.types';

const START_KEY = 'START';
const RESULT_KEY = 'CODE_IMPORT_RESULT';

/**
 * Deterministically maps the language-agnostic IR to a minimal two-node graph:
 * START -> RESULT (mode=SCRIPT). This reuses the engine's existing SCRIPT-mode
 * execution path (script-node-runner.service.ts) as-is rather than inventing a new
 * node type or runner — the only new thing is how the graph around that one node
 * gets generated. See docs/code-to-flow-specification.md.
 */
@Injectable()
export class GraphGeneratorService {
  generate(ir: CodeImportIR): GeneratedGraphPreview {
    const contract = ir.contract;
    const primaryOutputId = contract.primaryOutputId ?? contract.outputs[0]?.id;

    const dependencies: GeneratedGraphPreview['dependencies'] = [
      ...contract.inputs.map((variable) => ({
        variableCode: variable.id,
        usageType: 'INPUT' as const,
        dependencyPath: `input.${variable.id}`,
        dataType: variable.type,
        required: variable.required,
      })),
      ...contract.outputs.map((variable) => ({
        variableCode: variable.id,
        usageType: (variable.id === primaryOutputId ? 'OUTPUT_PRIMARY' : 'OUTPUT') as 'OUTPUT_PRIMARY' | 'OUTPUT',
        dependencyPath: `output.${variable.id}`,
        dataType: variable.type,
        required: variable.required,
      })),
    ];

    return {
      dependencies,
      nodes: [
        { key: START_KEY, type: 'START', label: 'Start', config: {} },
        {
          key: RESULT_KEY,
          type: 'RESULT',
          label: 'Imported code',
          config: {
            mode: 'SCRIPT',
            script: { language: ir.language, source: ir.scriptBody },
          },
        },
      ],
      edges: [{ key: 'START_CODE_IMPORT_RESULT', from: START_KEY, to: RESULT_KEY, default: true }],
    };
  }
}

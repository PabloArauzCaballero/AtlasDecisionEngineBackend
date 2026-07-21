import { ContractExtractorService } from '../src/modules/code-import/contract-extractor.service';
import { ContractValidatorService } from '../src/modules/code-import/contract-validator.service';
import { SecurityAnalyzerService } from '../src/modules/code-import/security-analyzer.service';
import { SyntaxAnalyzerService } from '../src/modules/code-import/syntax-analyzer.service';
import { GraphGeneratorService } from '../src/modules/code-import/graph-generator.service';
import type { CodeImportIR } from '../src/modules/code-import/code-import.types';

const JS_SOURCE = `// @atlas-contract
// { "contractVersion": "1",
//   "inputs": [{ "id": "age", "name": "Age", "type": "INTEGER", "required": true }],
//   "outputs": [{ "id": "riskLevel", "name": "Risk Level", "type": "STRING", "required": true }] }
return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };
`;

describe('ContractExtractorService', () => {
  const extractor = new ContractExtractorService();

  it('extracts a well-formed JavaScript contract and strips the header from the body', () => {
    const result = extractor.extract('JAVASCRIPT', JS_SOURCE);
    expect(result.issues).toEqual([]);
    expect(result.contract?.inputs).toHaveLength(1);
    expect(result.contract?.outputs[0].id).toBe('riskLevel');
    expect(result.scriptBody).not.toContain('@atlas-contract');
    expect(result.scriptBody).toContain('return { riskLevel:');
  });

  it('extracts a Python contract using # comments', () => {
    const pySource = `# @atlas-contract
# {"contractVersion": "1", "inputs": [{"id": "age", "name": "Age", "type": "INTEGER", "required": true}], "outputs": [{"id": "riskLevel", "name": "Risk", "type": "STRING", "required": true}]}
result = {"riskLevel": "LOW" if variables["age"] >= 21 else "HIGH"}
`;
    const result = extractor.extract('PYTHON', pySource);
    expect(result.issues).toEqual([]);
    expect(result.contract?.inputs[0].id).toBe('age');
  });

  it('reports a line-numbered error when the header is missing', () => {
    const result = extractor.extract('JAVASCRIPT', 'return { x: 1 };');
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'CONTRACT_MARKER_MISSING', line: 1 }),
    ]);
  });

  it('reports a line-numbered error for invalid JSON in the header', () => {
    const result = extractor.extract('JAVASCRIPT', '// @atlas-contract\n// { not json\nreturn {};');
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'CONTRACT_JSON_INVALID' }),
    ]);
  });
});

describe('ContractValidatorService', () => {
  const validator = new ContractValidatorService();

  it('accepts a well-formed contract that is fully wired up in the body', () => {
    const issues = validator.validate(
      {
        contractVersion: '1',
        inputs: [{ id: 'age', name: 'Age', type: 'INTEGER', required: true }],
        outputs: [{ id: 'riskLevel', name: 'Risk Level', type: 'STRING', required: true }],
      },
      'JAVASCRIPT',
      "return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };",
    );
    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });

  it('rejects an invalid identifier and an unsupported type', () => {
    const issues = validator.validate(
      {
        contractVersion: '1',
        inputs: [{ id: '1bad-id', name: 'Bad', type: 'INTEGER', required: true }],
        outputs: [{ id: 'out', name: 'Out', type: 'CURRENCY' as never, required: true }],
      },
      'JAVASCRIPT',
      'return {};',
    );
    expect(issues.some((issue) => issue.code === 'CONTRACT_ID_INVALID')).toBe(true);
    expect(issues.some((issue) => issue.code === 'CONTRACT_TYPE_INVALID')).toBe(true);
  });

  it('flags a duplicate id and an input the body never reads', () => {
    const issues = validator.validate(
      {
        contractVersion: '1',
        inputs: [
          { id: 'age', name: 'Age', type: 'INTEGER', required: true },
          { id: 'age', name: 'Age Again', type: 'INTEGER', required: true },
        ],
        outputs: [],
      },
      'JAVASCRIPT',
      'return {};',
    );
    expect(issues.some((issue) => issue.code === 'CONTRACT_ID_DUPLICATE')).toBe(true);
    expect(issues.some((issue) => issue.code === 'CONTRACT_INPUT_UNUSED')).toBe(true);
  });
});

describe('SecurityAnalyzerService', () => {
  const security = new SecurityAnalyzerService();

  it('flags require(), eval() and process access in JavaScript, with correct line numbers', () => {
    const issues = security.analyze('JAVASCRIPT', "const fs = require('fs');\nprocess.exit(1);\neval('1');");
    expect(issues.map((issue) => ({ code: issue.code, line: issue.line }))).toEqual([
      { code: 'JS_REQUIRE', line: 1 },
      { code: 'JS_PROCESS', line: 2 },
      { code: 'JS_EVAL', line: 3 },
    ]);
  });

  it('flags import, subprocess and dunder access in Python', () => {
    const issues = security.analyze('PYTHON', 'import os\nsubprocess.run(["ls"])\nx.__class__');
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PY_IMPORT', 'PY_SUBPROCESS', 'PY_DUNDER']),
    );
  });

  it('does not flag clean code', () => {
    expect(security.analyze('JAVASCRIPT', "return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };")).toEqual([]);
  });
});

describe('SyntaxAnalyzerService', () => {
  const syntax = new SyntaxAnalyzerService();

  it('accepts syntactically valid JavaScript', () => {
    expect(syntax.analyze('JAVASCRIPT', "return { a: 1 };")).toEqual([]);
  });

  it('reports a line-numbered JavaScript syntax error', () => {
    const issues = syntax.analyze('JAVASCRIPT', 'const x = ;');
    expect(issues).toEqual([expect.objectContaining({ code: 'JS_SYNTAX_ERROR', line: 1 })]);
  });
});

describe('GraphGeneratorService', () => {
  const generator = new GraphGeneratorService();

  it('builds a START -> RESULT(mode=SCRIPT) graph with one OUTPUT_PRIMARY dependency', () => {
    const ir: CodeImportIR = {
      irVersion: '1',
      language: 'JAVASCRIPT',
      sourceChecksum: 'abc',
      scriptBody: "return { riskLevel: 'LOW' };",
      contract: {
        contractVersion: '1',
        inputs: [{ id: 'age', name: 'Age', type: 'INTEGER', required: true }],
        outputs: [{ id: 'riskLevel', name: 'Risk Level', type: 'STRING', required: true }],
      },
    };
    const graph = generator.generate(ir);
    expect(graph.dependencies).toEqual([
      expect.objectContaining({ variableCode: 'age', usageType: 'INPUT', dependencyPath: 'input.age' }),
      expect.objectContaining({ variableCode: 'riskLevel', usageType: 'OUTPUT_PRIMARY', dependencyPath: 'output.riskLevel' }),
    ]);
    expect(graph.nodes.map((node) => node.type)).toEqual(['START', 'RESULT']);
    const resultNode = graph.nodes[1];
    expect(resultNode.config).toMatchObject({ mode: 'SCRIPT', script: { language: 'JAVASCRIPT' } });
    expect(graph.edges).toEqual([
      expect.objectContaining({ from: 'START', to: resultNode.key, default: true }),
    ]);
  });

  it('marks a non-default output as OUTPUT rather than OUTPUT_PRIMARY when primaryOutputId is set', () => {
    const ir: CodeImportIR = {
      irVersion: '1',
      language: 'JAVASCRIPT',
      sourceChecksum: 'abc',
      scriptBody: 'return {};',
      contract: {
        contractVersion: '1',
        primaryOutputId: 'b',
        inputs: [],
        outputs: [
          { id: 'a', name: 'A', type: 'STRING', required: true },
          { id: 'b', name: 'B', type: 'STRING', required: true },
        ],
      },
    };
    const graph = generator.generate(ir);
    expect(graph.dependencies.find((d) => d.variableCode === 'a')?.usageType).toBe('OUTPUT');
    expect(graph.dependencies.find((d) => d.variableCode === 'b')?.usageType).toBe('OUTPUT_PRIMARY');
  });
});

import { BranchExtractorService } from '../src/modules/code-import/branch-extractor.service';
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
    expect(result.issues).toEqual([expect.objectContaining({ code: 'CONTRACT_JSON_INVALID' })]);
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

  it('reconoce las salidas de un diccionario Python repartido en varias líneas', () => {
    const issues = validator.validate(
      {
        contractVersion: '1',
        inputs: [{ id: 'edad', name: 'Edad', type: 'INTEGER', required: true }],
        outputs: [
          { id: 'decision', name: 'Decisión', type: 'STRING', required: true },
          { id: 'motivo', name: 'Motivo', type: 'STRING', required: true },
        ],
      },
      'PYTHON',
      `edad = variables.get('edad')\nresult = {\n    'decision': 'APROBADO' if edad >= 18 else 'RECHAZADO',\n    'motivo': 'AGE',\n}\n`,
    );
    expect(issues).toEqual([]);
  });
});

describe('SecurityAnalyzerService', () => {
  const security = new SecurityAnalyzerService();

  it('flags require(), eval() and process access in JavaScript, with correct line numbers', () => {
    const issues = security.analyze(
      'JAVASCRIPT',
      "const fs = require('fs');\nprocess.exit(1);\neval('1');",
    );
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
    expect(
      security.analyze('JAVASCRIPT', "return { riskLevel: variables.age >= 21 ? 'LOW' : 'HIGH' };"),
    ).toEqual([]);
  });
});

describe('SyntaxAnalyzerService', () => {
  const syntax = new SyntaxAnalyzerService();

  it('accepts syntactically valid JavaScript', () => {
    expect(syntax.analyze('JAVASCRIPT', 'return { a: 1 };')).toEqual([]);
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
      expect.objectContaining({
        variableCode: 'age',
        usageType: 'INPUT',
        dependencyPath: 'input.age',
      }),
      expect.objectContaining({
        variableCode: 'riskLevel',
        usageType: 'OUTPUT_PRIMARY',
        dependencyPath: 'output.riskLevel',
      }),
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
    expect(graph.dependencies.find((d) => d.variableCode === 'b')?.usageType).toBe(
      'OUTPUT_PRIMARY',
    );
  });
});

describe('BranchExtractorService + GraphGeneratorService (árbol de decisión)', () => {
  const branches = new BranchExtractorService();
  const generator = new GraphGeneratorService();
  const contract = {
    contractVersion: '1',
    inputs: [
      { id: 'ingreso_mensual', name: 'Ingreso', type: 'NUMBER' as const, required: true },
      { id: 'deuda_mensual', name: 'Deuda', type: 'NUMBER' as const, required: true },
      { id: 'score_buro', name: 'Score', type: 'INTEGER' as const, required: true },
      { id: 'edad', name: 'Edad', type: 'INTEGER' as const, required: true },
    ],
    outputs: [
      { id: 'decision', name: 'Decisión', type: 'STRING' as const, required: true },
      { id: 'motivo', name: 'Motivo', type: 'STRING' as const, required: true },
      { id: 'limite', name: 'Límite', type: 'NUMBER' as const, required: true },
    ],
  };

  const PY_SOURCE = `ingreso = variables.get("ingreso_mensual", 0)
deuda = variables.get("deuda_mensual", 0)
score = variables.get("score_buro", 0)
edad = variables.get("edad", 0)
ratio_deuda = deuda / ingreso if ingreso > 0 else 1.0

if edad < 18:
    result = {"decision": "RECHAZADO", "motivo": "AGE_NOT_ELIGIBLE", "limite": 0}
elif ratio_deuda > 0.45:
    result = {"decision": "RECHAZADO", "motivo": "DTI_TOO_HIGH", "limite": 0}
elif score >= 700:
    result = {"decision": "APROBADO", "motivo": "APPROVED_POLICY", "limite": ingreso * 0.35}
else:
    result = {"decision": "REVISION", "motivo": "MANUAL_REVIEW", "limite": 0}

return result
`;

  it('deriva una condición por cada if/elif y un resultado por rama (Python)', () => {
    const extraction = branches.extract('PYTHON', PY_SOURCE, contract);
    expect(extraction.unsupported).toBeUndefined();
    expect(extraction.branches).toHaveLength(4);
    expect(extraction.branches[0].condition).toEqual({
      op: 'lt',
      left: { op: 'coalesce', args: [{ var: 'edad' }, { value: 0 }] },
      right: { value: 18 },
    });
    // La rama por defecto (else) no lleva condición.
    expect(extraction.branches[3].condition).toBeUndefined();

    const graph = generator.generate({
      irVersion: '1',
      language: 'PYTHON',
      sourceChecksum: 'x',
      scriptBody: PY_SOURCE,
      contract,
      branches: extraction.branches,
    });
    expect(graph.nodes.filter((node) => node.type === 'CONDITION')).toHaveLength(3);
    expect(graph.nodes.filter((node) => node.type === 'RESULT')).toHaveLength(4);
    expect(graph.conditions).toHaveLength(3);
    // Cada condición encadena su "no" con la siguiente, y la última con el else.
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'START', to: 'CHECK_1' }),
        expect.objectContaining({ from: 'CHECK_1', to: 'RESULT_1', conditionCode: 'COND_1' }),
        expect.objectContaining({ from: 'CHECK_1', to: 'CHECK_2', default: true }),
        expect.objectContaining({ from: 'CHECK_3', to: 'RESULT_DEFAULT', default: true }),
      ]),
    );
    // Un valor calculado se guarda como expresión, no como literal.
    const approved = graph.nodes.find((node) => node.key === 'RESULT_3');
    expect(approved?.config).toMatchObject({
      mode: 'MAPPING',
      assignments: expect.arrayContaining([
        { outputCode: 'decision', source: 'LITERAL', value: 'APROBADO' },
        expect.objectContaining({ outputCode: 'limite', source: 'EXPRESSION' }),
      ]),
    });
  });

  it('entiende un resultado repartido en varias líneas (Python)', () => {
    // Así es como se escribe un diccionario de verdad. Antes había que meterlo
    // todo en una línea o el árbol no se derivaba.
    const source = `edad = variables.get("edad", 0)
score = variables.get("score_buro", 0)

if edad < 18:
    result = {
        "decision": "RECHAZADO",
        "motivo": "AGE_NOT_ELIGIBLE",
        "limite": 0,
    }
else:
    result = {
        "decision": "APROBADO",
        "motivo": "APPROVED_POLICY",
        "limite": round(min(5000, score * 2), 2),
    }

return result
`;
    const extraction = branches.extract('PYTHON', source, contract);
    expect(extraction.unsupported).toBeUndefined();
    expect(extraction.branches).toHaveLength(2);
    expect(extraction.branches[0].assignments.map((item) => item.outputId)).toEqual([
      'decision',
      'motivo',
      'limite',
    ]);
    expect(extraction.branches[1].assignments[2]).toMatchObject({ isLiteral: false });
  });

  it('deriva el mismo árbol desde JavaScript', () => {
    const source = `const ingreso = variables.ingreso_mensual;
if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE', limite: 0 };
} else if (variables.score_buro >= 700) {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY', limite: ingreso * 0.35 };
} else {
  return { decision: 'REVISION', motivo: 'MANUAL_REVIEW', limite: 0 };
}
`;
    const extraction = branches.extract('JAVASCRIPT', source, contract);
    expect(extraction.unsupported).toBeUndefined();
    expect(extraction.branches.map((branch) => branch.conditionSource)).toEqual([
      'variables.edad < 18',
      'variables.score_buro >= 700',
      undefined,
    ]);
  });

  it('emite los motivos del catálogo como acción EMIT_REASON, no como cadena suelta', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE', limite: 0 };
} else {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY', limite: 1000 };
}
`;
    const withReason = { ...contract, reasonOutputId: 'motivo' };
    const extraction = branches.extract('JAVASCRIPT', source, withReason);
    const ir = {
      irVersion: '1' as const,
      language: 'JAVASCRIPT' as const,
      sourceChecksum: 'x',
      scriptBody: source,
      contract: withReason,
      branches: extraction.branches,
    };

    // Sin catálogo no se inventa nada: el motivo sigue siendo un literal.
    expect(generator.generate(ir).actions).toEqual([]);
    expect(generator.generate(ir).nodes.some((node) => node.type === 'ACTION')).toBe(false);

    const graph = generator.generate(ir, new Set(['AGE_NOT_ELIGIBLE', 'APPROVED_POLICY']));
    expect(graph.actions).toEqual([
      { code: 'EMIT_AGE_NOT_ELIGIBLE', type: 'EMIT_REASON', reasonCode: 'AGE_NOT_ELIGIBLE' },
      { code: 'EMIT_APPROVED_POLICY', type: 'EMIT_REASON', reasonCode: 'APPROVED_POLICY' },
    ]);
    // El motor sólo ejecuta acciones en nodos ACTION: el emisor va DELANTE del
    // resultado, y la condición entra por él.
    const emitter = graph.nodes.find((node) => node.key === 'REASON_1');
    expect(emitter).toMatchObject({
      type: 'ACTION',
      actions: [{ actionCode: 'EMIT_AGE_NOT_ELIGIBLE', order: 1 }],
    });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'CHECK_1', to: 'REASON_1', conditionCode: 'COND_1' }),
        expect.objectContaining({ from: 'REASON_1', to: 'RESULT_1', default: true }),
        expect.objectContaining({ from: 'CHECK_1', to: 'REASON_DEFAULT', default: true }),
        expect.objectContaining({ from: 'REASON_DEFAULT', to: 'RESULT_DEFAULT', default: true }),
      ]),
    );
  });

  it('ignora un literal que no es un motivo declarado', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'INVENTADO', limite: 0 };
} else {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY', limite: 1000 };
}
`;
    const withReason = { ...contract, reasonOutputId: 'motivo' };
    const extraction = branches.extract('JAVASCRIPT', source, withReason);
    const graph = generator.generate(
      {
        irVersion: '1' as const,
        language: 'JAVASCRIPT' as const,
        sourceChecksum: 'x',
        scriptBody: source,
        contract: withReason,
        branches: extraction.branches,
      },
      new Set(['APPROVED_POLICY']),
    );
    expect(graph.actions?.map((action) => action.reasonCode)).toEqual(['APPROVED_POLICY']);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'CHECK_1', to: 'RESULT_1', conditionCode: 'COND_1' }),
      ]),
    );
  });

  it('no traduce a medias: sin `else` avisa y deja el nodo de script', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE', limite: 0 };
}
`;
    const extraction = branches.extract('JAVASCRIPT', source, contract);
    expect(extraction.branches).toEqual([]);
    expect(extraction.unsupported).toEqual(
      expect.objectContaining({ code: 'CODE_IMPORT_TREE_NOT_DERIVABLE', severity: 'WARNING' }),
    );
    const graph = generator.generate({
      irVersion: '1',
      language: 'JAVASCRIPT',
      sourceChecksum: 'x',
      scriptBody: source,
      contract,
      branches: [],
    });
    expect(graph.nodes.map((node) => node.type)).toEqual(['START', 'RESULT']);
    expect(graph.nodes[1].config).toMatchObject({ mode: 'SCRIPT' });
  });

  it('rechaza una rama que escribe una salida no declarada', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', inventada: 1 };
} else {
  return { decision: 'APROBADO' };
}
`;
    const extraction = branches.extract('JAVASCRIPT', source, contract);
    expect(extraction.unsupported?.message).toContain('inventada');
  });

  it('conserva el script cuando una rama omite una salida obligatoria', () => {
    const source = `if (variables.edad < 18) {
  return { decision: 'RECHAZADO', motivo: 'AGE_NOT_ELIGIBLE', limite: 0 };
} else {
  return { decision: 'APROBADO', motivo: 'APPROVED_POLICY' };
}
`;
    const extraction = branches.extract('JAVASCRIPT', source, contract);
    expect(extraction.branches).toEqual([]);
    expect(extraction.unsupported).toEqual(
      expect.objectContaining({
        code: 'CODE_IMPORT_TREE_NOT_DERIVABLE',
        message: expect.stringContaining('limite'),
      }),
    );
  });
});

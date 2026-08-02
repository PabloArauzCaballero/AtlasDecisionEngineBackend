import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { HashService } from '../src/common/crypto/hash.service';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import {
  buildContractDemoCompiled,
  CONTRACT_DEMO_CASES,
  CONTRACT_DEMO_INVALID_CASES,
} from '../src/modules/seeding/data/contract-demo.graph';
import type { ArtifactGraphSnapshot } from '../src/modules/graph/graph.types';

/**
 * §11 exige que las entradas y salidas esperadas del seeder COINCIDAN con la ejecución
 * real. La única forma honesta de garantizarlo es ejecutar el artefacto sembrado con el
 * motor de verdad y comparar. Si alguien retoca el grafo del demo y olvida el caso
 * esperado, esta prueba falla antes de que el seeder mienta en una demo.
 */
const config = new ConfigService({
  MAX_EXECUTION_STEPS: 64,
  SCRIPT_NODES_ENABLED: false,
  AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
});
const engine = new ExecutionEngineService(
  new ExpressionEvaluator(),
  config,
  new ScriptNodeRunnerService(config),
  new MetricsService(),
);
const resolver = new VariableResolutionService(
  config,
  new HashService(config),
  new MetricsService(),
);
const compiled = buildContractDemoCompiled({ id: '1', tenantId: '1' }, { id: '1' }, {});

/**
 * El mismo demo, pero con `CALCULAR_DTI` invocando el campo calculado sembrado en vez de
 * repetir la fórmula. Debe producir EXACTAMENTE los mismos resultados: si no, reutilizar
 * un campo calculado cambiaría la decisión, que es justo lo que no puede pasar.
 */
const compiledWithCalculatedField = buildContractDemoCompiled(
  { id: '1', tenantId: '1' },
  { id: '1' },
  {},
  {
    versionId: '900',
    versionNumber: 1,
    definition: {
      implementationKind: 'OPERATION',
      contract: {
        inputs: [
          {
            id: 'deuda_mensual',
            name: 'Deuda',
            description: '',
            dataType: 'DECIMAL',
            required: true,
            constraints: { min: 0 },
          },
          {
            id: 'ingreso_mensual',
            name: 'Ingreso',
            description: '',
            dataType: 'DECIMAL',
            required: true,
            constraints: { exclusiveMin: 0 },
          },
        ],
        returns: {
          dataType: 'DECIMAL',
          nullable: false,
          precision: 4,
          nullConditions: [],
          divisionByZero: 'FAIL',
          missingData: 'FAIL',
          outOfRange: 'FAIL',
          errorCode: 'DTI_NOT_COMPUTABLE',
        },
      },
      operation: {
        operation: 'DIVIDE',
        args: [{ input: 'deuda_mensual' }, { input: 'ingreso_mensual' }],
      },
      libraryPackages: [],
    },
  },
);

const inputContracts = compiled.variables.filter(
  (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
);
const resolve = (input: Record<string, unknown>) =>
  resolver.resolve(inputContracts, input, {
    tenantId: 1n,
    artifactCode: compiled.artifact.code,
    requestId: 'seed-check',
    allowExternal: false,
  });

describe('demo de contratos sembrado', () => {
  it('el grafo sembrado pasa la validación completa', () => {
    const snapshot: ArtifactGraphSnapshot = {
      artifact: compiled.artifact,
      version: compiled.version,
      variables: compiled.variables,
      intermediates: compiled.intermediates,
      outputContract: compiled.outputContract,
      conditions: Object.values(compiled.conditions),
      actions: Object.values(compiled.actions),
      nodes: Object.values(compiled.nodes),
      edges: Object.values(compiled.edgesByNode).flat(),
    };
    const report = new GraphValidatorService(
      new ExpressionEvaluator(),
      new HashService(config),
    ).validate(snapshot);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it.each(CONTRACT_DEMO_CASES)('$name', async ({ input, expectedOutput }) => {
    const resolution = await resolve(input);
    expect(resolution.valid).toBe(true);

    const result = await engine.execute(compiled, resolution.values);
    expect(result.status).toBe('SUCCEEDED');
    for (const [code, expected] of Object.entries(expectedOutput)) {
      if (typeof expected === 'number') {
        expect(result.output[code]).toBeCloseTo(expected, 6);
      } else {
        expect(result.output[code]).toBe(expected);
      }
    }
  });

  it.each(CONTRACT_DEMO_INVALID_CASES)(
    '$name es rechazado por el contrato',
    async ({ input, expectedError }) => {
      const resolution = await resolve(input);
      expect(resolution.valid).toBe(false);
      expect(resolution.errors[0].code).toBe(expectedError);
    },
  );

  it('las variables intermedias nunca salen en la respuesta pública', async () => {
    const resolution = await resolve(CONTRACT_DEMO_CASES[0].input);
    const result = await engine.execute(compiled, resolution.values);
    expect(Object.keys(result.output)).not.toContain('dti');
    expect(Object.keys(result.output)).not.toContain('carga_cuota');
  });

  it('un nodo no autorizado no ve la intermedia restringida', async () => {
    const resolution = await resolve(CONTRACT_DEMO_CASES[0].input);
    const result = await engine.execute(compiled, resolution.values);
    // CALCULAR_CARGA no está en consumerNodeKeys de `dti`.
    const carga = result.trace.find((step) => step.nodeKey === 'CALCULAR_CARGA');
    const dtiEntry = carga?.variableState?.intermediatesAfter.find((entry) => entry.code === 'dti');
    expect(dtiEntry?.consumedByNodeKeys).not.toContain('CALCULAR_CARGA');
  });

  it.each(CONTRACT_DEMO_CASES)(
    'invocando el campo calculado reutilizable: $name',
    async ({ input, expectedOutput }) => {
      const resolution = await resolve(input);
      const result = await engine.execute(compiledWithCalculatedField, resolution.values);
      for (const [code, expected] of Object.entries(expectedOutput)) {
        if (typeof expected === 'number') {
          expect(result.output[code]).toBeCloseTo(expected, 6);
        } else {
          expect(result.output[code]).toBe(expected);
        }
      }
      // Y la invocación queda trazada, con su versión fijada.
      expect(result.calculatedFieldCalls).toEqual([
        expect.objectContaining({
          fieldCode: 'debt_to_income',
          versionNumber: 1,
          target: 'intermediate.dti',
          outcome: 'VALID',
        }),
      ]);
    },
  );

  it('el grafo que invoca el campo calculado también pasa la validación', () => {
    const snapshot: ArtifactGraphSnapshot = {
      artifact: compiledWithCalculatedField.artifact,
      version: compiledWithCalculatedField.version,
      variables: compiledWithCalculatedField.variables,
      intermediates: compiledWithCalculatedField.intermediates,
      outputContract: compiledWithCalculatedField.outputContract,
      conditions: Object.values(compiledWithCalculatedField.conditions),
      actions: Object.values(compiledWithCalculatedField.actions),
      nodes: Object.values(compiledWithCalculatedField.nodes),
      edges: Object.values(compiledWithCalculatedField.edgesByNode).flat(),
    };
    const report = new GraphValidatorService(
      new ExpressionEvaluator(),
      new HashService(config),
    ).validate(snapshot);
    expect(report.errors).toEqual([]);
  });

  it('cada campo del contrato de salida se produce en todos los caminos terminales', async () => {
    for (const testCase of CONTRACT_DEMO_CASES) {
      const resolution = await resolve(testCase.input);
      const result = await engine.execute(compiled, resolution.values);
      for (const field of compiled.outputContract) {
        expect(result.output[field.code]).toBeDefined();
      }
    }
  });
});

import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import {
  ATLAS_UNDERWRITING_CASES,
  ATLAS_UNDERWRITING_PRIMARY_OUTPUT,
  buildAtlasUnderwritingCompiled,
} from '../src/modules/seeding/data/atlas-underwriting.graph';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { ArtifactGraphSnapshot } from '../src/modules/graph/graph.types';

/**
 * La política que AtlasBackend invoca de verdad, ejecutada con el motor de verdad.
 *
 * Un seeder escribe en la base los resultados que su autor CREE que produce el grafo. Si esa
 * creencia es falsa, la base queda con una suite «en verde» que nadie ejecutó y con una decisión de
 * crédito que no coincide con la política aprobada. Aquí se ejecuta cada caso sembrado y se compara
 * con lo que el motor devuelve.
 *
 * El caso `DECLINE_NO_AMOUNT` es el que más importa de todos: comprueba que una solicitud sin
 * importe sale como DECLINE por la primera arista y no como aprobación por la arista por defecto.
 * Aprobar un crédito por un dato que nunca llegó es el fallo que ninguna auditoría perdona.
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

const compiled = buildAtlasUnderwritingCompiled({ id: '1', tenantId: '1' }, { id: '1' }, {});

const inputContracts = compiled.variables.filter(
  (variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'),
);

describe('politica BNPL de Atlas sembrada', () => {
  it('el grafo sembrado pasa la validacion completa', () => {
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

  it('declara exactamente el contrato que emite AtlasBackend', () => {
    // Si esta lista crece, el backend deja de poder decidir: el motor exigiria un dato que nadie
    // le manda y responderia 422, que el cliente del backend lee como rechazo de credito.
    expect(inputContracts.map((variable) => variable.code).sort()).toEqual([
      'currency_code',
      'product_code',
      'purpose_code',
      'requested_amount',
      'requested_term_months',
    ]);
  });

  it.each(ATLAS_UNDERWRITING_CASES)('$caseCode · $name', async ({ input, expectedOutcome }) => {
    const resolution = await resolver.resolve(inputContracts, input, {
      tenantId: 1n,
      artifactCode: compiled.artifact.code,
      requestId: 'seed-check',
      allowExternal: false,
    });
    expect(resolution.valid).toBe(true);

    const result = await engine.execute(compiled, resolution.values);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.output[ATLAS_UNDERWRITING_PRIMARY_OUTPUT]).toBe(expectedOutcome);
  });
});

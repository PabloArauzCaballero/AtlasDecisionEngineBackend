import { ConfigService } from '@nestjs/config';
import { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

const principal = { id: 'user-1', tenantId: 1n, roles: [], audience: 'management', requestId: 'r1', authMethod: 'jwt' } as unknown as AuthenticatedPrincipal;

function baseReference(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1n,
    childArtifactVersionId: 99n,
    timeoutMs: 50,
    onErrorPolicy: 'FAIL',
    fallbackOutputJson: null,
    inputMappingJson: [{ childVariableCode: 'age', source: 'VARIABLE', path: 'age' }],
    outputMappingJson: [{ childOutputCode: 'level' }],
    ...overrides,
  };
}

function setup(referenceOverrides: Partial<Record<string, unknown>> = {}, engineResult?: unknown) {
  const prisma = {
    decisionArtifactReference: { findFirst: jest.fn().mockResolvedValue(baseReference(referenceOverrides)) },
    decisionCompiledArtifact: {
      findFirst: jest.fn().mockResolvedValue({ compiledPayloadJson: { startNodeKey: 'START' } }),
    },
  };
  const engine = {
    execute: jest.fn().mockResolvedValue(
      engineResult ?? { output: { level: 'HIGH' }, nestedExecutions: [] },
    ),
  };
  const config = new ConfigService({ NESTED_TREE_MAX_DEPTH: 5 });
  const service = new NestedTreeExecutionService(
    prisma as unknown as PrismaService,
    config,
    engine as unknown as ExecutionEngineService,
    new ExpressionEvaluator(),
  );
  return { service, prisma, engine };
}

describe('NestedTreeExecutionService', () => {
  it('maps child output back to the parent context on success', async () => {
    const { service, engine } = setup();
    const resolver = service.bind(1n, principal);
    const cursor = { sequence: { value: 0 }, parentSequence: null, depth: 1 };

    const result = await resolver.resolve('10', 'NESTED_CHECK', { age: 30 }, cursor);

    expect(engine.execute).toHaveBeenCalledWith(
      { startNodeKey: 'START' },
      { age: 30 },
      expect.any(Object),
      { sequence: cursor.sequence, parentSequence: 1, depth: 2 },
    );
    expect(result.output).toEqual({ level: 'HIGH' });
    expect(result.trace).toEqual([
      expect.objectContaining({ sequence: 1, parentSequence: null, depth: 1, status: 'SUCCEEDED' }),
    ]);
  });

  it('fails closed (default onErrorPolicy=FAIL) when the child execution throws', async () => {
    const { service, engine } = setup();
    engine.execute.mockRejectedValue(new Error('boom'));
    const resolver = service.bind(1n, principal);

    await expect(
      resolver.resolve('10', 'NESTED_CHECK', {}, { sequence: { value: 0 }, parentSequence: null, depth: 1 }),
    ).rejects.toThrow('boom');
  });

  it('falls back to fallbackOutputJson when onErrorPolicy=FALLBACK', async () => {
    const { service, engine } = setup({ onErrorPolicy: 'FALLBACK', fallbackOutputJson: { riskLevel: 'UNKNOWN' } });
    engine.execute.mockRejectedValue(new Error('boom'));
    const resolver = service.bind(1n, principal);

    const result = await resolver.resolve('10', 'NESTED_CHECK', {}, { sequence: { value: 0 }, parentSequence: null, depth: 1 });

    expect(result.output).toEqual({ riskLevel: 'UNKNOWN' });
    expect(result.trace[0]).toMatchObject({ status: 'FALLBACK', childArtifactVersionId: null });
  });

  it('returns an empty output when onErrorPolicy=SKIP', async () => {
    const { service, engine } = setup({ onErrorPolicy: 'SKIP' });
    engine.execute.mockRejectedValue(new Error('boom'));
    const resolver = service.bind(1n, principal);

    const result = await resolver.resolve('10', 'NESTED_CHECK', {}, { sequence: { value: 0 }, parentSequence: null, depth: 1 });

    expect(result.output).toEqual({});
    expect(result.trace[0]).toMatchObject({ status: 'SKIPPED' });
  });

  it('times out slow child executions instead of hanging', async () => {
    const { service, engine } = setup({ timeoutMs: 20 });
    engine.execute.mockImplementation(() => new Promise(() => {}));
    const resolver = service.bind(1n, principal);

    await expect(
      resolver.resolve('10', 'NESTED_CHECK', {}, { sequence: { value: 0 }, parentSequence: null, depth: 1 }),
    ).rejects.toMatchObject({ code: 'NESTED_EXECUTION_TIMEOUT' });
  });

  it('rejects when the configured max nesting depth is exceeded', async () => {
    const { service } = setup();
    const resolver = service.bind(1n, principal);

    await expect(
      resolver.resolve('10', 'NESTED_CHECK', {}, { sequence: { value: 0 }, parentSequence: null, depth: 6 }),
    ).rejects.toMatchObject({ code: 'NESTED_TREE_MAX_DEPTH_EXCEEDED' });
  });

  it('rejects when no reference is configured for the node', async () => {
    const { service, prisma } = setup();
    prisma.decisionArtifactReference.findFirst.mockResolvedValue(null);
    const resolver = service.bind(1n, principal);

    await expect(
      resolver.resolve('10', 'MISSING_NODE', {}, { sequence: { value: 0 }, parentSequence: null, depth: 1 }),
    ).rejects.toMatchObject({ code: 'REFERENCE_NOT_FOUND' });
  });
});

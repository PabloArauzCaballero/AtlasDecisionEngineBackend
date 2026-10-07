import { TestCaseExecutorService } from '../src/modules/testing/test-case-executor.service';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';

/**
 * Contrato del resultado de un caso de prueba. Los casos sembrados (y los que
 * escribe cualquier persona en la UI) asertan `$.reasonCodes`, que es como se
 * llama el campo en el runtime y en la simulación; el ejecutor emitía sólo
 * `reasons`, así que TODA aserción sobre motivos daba `actual: null` y la corrida
 * salía FAILED aunque el motor hubiera decidido exactamente lo esperado.
 */
describe('TestCaseExecutorService', () => {
  const engineResult = {
    output: { decision_outcome: 'APPROVED' },
    outcome: 'APPROVED',
    primaryResult: { code: 'decision_outcome', value: 'APPROVED' },
    reasons: [{ code: 'APPROVED_POLICY' }],
    visitedNodeKeys: ['START', 'APPROVE'],
    traversedEdgeKeys: ['E_START_APPROVE'],
    terminalNodeKey: 'APPROVE',
    status: 'DECIDED',
  };
  const build = (valid = true) =>
    new TestCaseExecutorService(
      { execute: jest.fn().mockResolvedValue(engineResult) } as never,
      {
        resolve: jest
          .fn()
          .mockResolvedValue(
            valid
              ? { valid: true, values: {}, errors: [] }
              : { valid: false, values: {}, errors: [{ variableCode: 'age', code: 'MISSING' }] },
          ),
      } as never,
      { bind: jest.fn() } as never,
      { bind: jest.fn() } as never,
    );
  const payload = { variables: [] } as unknown as CompiledDecisionArtifact;

  it('expone los motivos como `reasonCodes` (y mantiene `reasons` como alias)', async () => {
    const result = await build().execute({
      tenantId: 1n,
      artifactCode: 'DEMO',
      runId: 1n,
      payload,
      testCase: {
        id: 1n,
        caseCode: 'APPROVE',
        inputJson: { variables: {} },
        expectedResultJson: { outcome: 'APPROVED', reasonCodes: ['APPROVED_POLICY'] },
      },
    });

    expect(result.resultStatus).toBe('PASS');
    expect(result.actual).toMatchObject({
      reasonCodes: ['APPROVED_POLICY'],
      reasons: ['APPROVED_POLICY'],
    });
    expect(result.assertions.find((assertion) => assertion.path === '$.reasonCodes')).toEqual({
      path: '$.reasonCodes',
      expected: ['APPROVED_POLICY'],
      actual: ['APPROVED_POLICY'],
      passed: true,
    });
  });

  it('un NO_DECISION también nombra su motivo', async () => {
    const result = await build(false).execute({
      tenantId: 1n,
      artifactCode: 'DEMO',
      runId: 1n,
      payload,
      testCase: {
        id: 1n,
        caseCode: 'MISSING',
        inputJson: { variables: {} },
        expectedResultJson: { outcome: 'NO_DECISION' },
      },
    });

    expect(result.actual).toMatchObject({
      outcome: 'NO_DECISION',
      reasonCodes: ['VARIABLE_MISSING_OR_INVALID'],
    });
  });

  it('un caso que no espera nada FALLA: sin aserciones no se comprueba nada', async () => {
    // Antes pasaba siempre y además sumaba cobertura: una suite de casos vacíos dejaba la corrida
    // en verde con el 100 % de los nodos sin haber verificado un solo desenlace.
    const result = await build().execute({
      tenantId: 1n,
      artifactCode: 'DEMO',
      runId: 1n,
      payload,
      testCase: { id: 1n, caseCode: 'VACIO', inputJson: { variables: {} }, expectedResultJson: {} },
    });

    expect(result.resultStatus).toBe('FAIL');
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]).toMatchObject({ path: '$', passed: false });
    // La cobertura observada no se pierde: el generador la necesita para buscar.
    expect(result.visitedNodeKeys).toEqual(['START', 'APPROVE']);
  });

  it('los dobles de worker del caso responden por sus nodos en vez del servicio real', async () => {
    const engine = { execute: jest.fn().mockResolvedValue(engineResult) };
    const real = { invoke: jest.fn() };
    const executor = new TestCaseExecutorService(
      engine as never,
      { resolve: jest.fn().mockResolvedValue({ valid: true, values: {}, errors: [] }) } as never,
      { bind: jest.fn() } as never,
      { bind: jest.fn().mockReturnValue(real) } as never,
    );

    await executor.execute({
      tenantId: 1n,
      artifactCode: 'DEMO',
      runId: 1n,
      payload,
      testCase: {
        id: 1n,
        caseCode: 'CON_DOBLE',
        inputJson: {
          variables: {},
          workerDoubles: { VERIFICAR: { result: { decision: 'VERIFIED' } } },
        },
        expectedResultJson: { outcome: 'APPROVED' },
      },
    });

    const invoker = engine.execute.mock.calls[0][5] as {
      invoke: (request: unknown) => Promise<unknown>;
    };
    await expect(
      invoker.invoke({
        nodeKey: 'VERIFICAR',
        service: 'identity',
        operation: 'verify',
        arguments: {},
      }),
    ).resolves.toMatchObject({
      result: { decision: 'VERIFIED' },
    });
    expect(real.invoke).not.toHaveBeenCalled();
  });
});

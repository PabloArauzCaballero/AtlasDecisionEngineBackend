import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import type { VariableContractSnapshot } from '../src/modules/graph/graph.types';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';

function contract(overrides: Partial<VariableContractSnapshot> = {}): VariableContractSnapshot {
  return {
    variableVersionId: '1',
    code: 'monthly_income',
    version: 1,
    dataType: 'NUMBER',
    nullable: false,
    validationSchema: { exclusiveMinimum: 0 },
    validationRules: [],
    sources: [],
    required: true,
    fallbackPolicy: 'FAIL_CLOSED',
    sensitive: true,
    ...overrides,
  };
}

describe('VariableResolutionService', () => {
  const config = new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters' });
  const service = new VariableResolutionService(config, new HashService(config));

  it('rejects an exclusive lower bound', async () => {
    const result = await service.resolve([contract()], { monthly_income: 0 }, {
      tenantId: 1n,
      artifactCode: 'TEST',
      requestId: 'r1',
      allowExternal: false,
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('greater than 0');
  });

  it('does not persist raw values for sensitive variables', async () => {
    const result = await service.resolve([contract()], { monthly_income: 4500 }, {
      tenantId: 1n,
      artifactCode: 'TEST',
      requestId: 'r2',
      allowExternal: false,
    });
    expect(result.valid).toBe(true);
    expect(result.snapshots[0].storedValue).toBeNull();
    expect(result.snapshots[0].valueHash).toHaveLength(64);
  });
  it('discards undeclared input variables before execution', async () => {
    const result = await service.resolve(
      [contract()],
      { monthly_income: 4500, hidden_override: 'APPROVED' },
      {
        tenantId: 1n,
        artifactCode: 'TEST',
        requestId: 'r3',
        allowExternal: false,
      },
    );
    expect(result.valid).toBe(true);
    expect(result.values).toEqual({ monthly_income: 4500 });
    expect(result.values).not.toHaveProperty('hidden_override');
  });

});

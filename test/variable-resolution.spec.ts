import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
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
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
  });
  const service = new VariableResolutionService(
    config,
    new HashService(config),
    new MetricsService(),
  );

  it('rejects an exclusive lower bound', async () => {
    const result = await service.resolve(
      [contract()],
      { monthly_income: 0 },
      {
        tenantId: 1n,
        artifactCode: 'TEST',
        requestId: 'r1',
        allowExternal: false,
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('greater than 0');
  });

  it('does not persist raw values for sensitive variables', async () => {
    const result = await service.resolve(
      [contract()],
      { monthly_income: 4500 },
      {
        tenantId: 1n,
        artifactCode: 'TEST',
        requestId: 'r2',
        allowExternal: false,
      },
    );
    expect(result.valid).toBe(true);
    expect(result.snapshots[0].storedValue).toBeNull();
    expect(result.snapshots[0].valueHash).toHaveLength(64);
  });

  it('hashes a sensitive value with a keyed HMAC, not a reversible plain SHA-256 (D-7)', async () => {
    const hashes = new HashService(config);
    const material = { code: 'monthly_income', value: 4500 };
    const result = await service.resolve(
      [contract({ sensitive: true })],
      { monthly_income: 4500 },
      {
        tenantId: 1n,
        artifactCode: 'TEST',
        requestId: 'r-pii',
        allowExternal: false,
      },
    );
    const hash = result.snapshots[0].valueHash;
    // Keyed: matches the HMAC, and is NOT the bare SHA-256 an attacker could precompute.
    expect(hash).toBe(hashes.hmac(material));
    expect(hash).not.toBe(hashes.sha256(material));
  });

  it('keeps a plain SHA-256 for a non-sensitive value', async () => {
    const hashes = new HashService(config);
    const material = { code: 'monthly_income', value: 4500 };
    const result = await service.resolve(
      [contract({ sensitive: false })],
      { monthly_income: 4500 },
      {
        tenantId: 1n,
        artifactCode: 'TEST',
        requestId: 'r-plain',
        allowExternal: false,
      },
    );
    expect(result.snapshots[0].valueHash).toBe(hashes.sha256(material));
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

  /**
   * El mismo principio que arriba, por la otra puerta. La respuesta del proveedor externo se
   * fusionaba tal cual con `Object.assign`, así que un backend comprometido o simplemente
   * mal implementado podía introducir códigos que el artefacto no declara —que entraban al
   * contexto del motor— y sobrescribir un valor que el cliente sí había enviado. Solo se
   * pregunta por lo que falta: devolver otra cosa nunca es legítimo.
   */
  describe('respuesta del backend externo de variables', () => {
    const externalConfig = new ConfigService({
      AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
      VARIABLE_BACKEND_URL: 'http://variables.internal',
    });
    const externalService = new VariableResolutionService(
      externalConfig,
      new HashService(externalConfig),
      new MetricsService(),
    );
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    function respondWith(values: unknown) {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ values }),
      }) as unknown as typeof fetch;
    }

    const resolveWithExternal = (input: Record<string, unknown>) =>
      externalService.resolve(
        [contract({ sensitive: false }), contract({ code: 'age', dataType: 'NUMBER' })],
        input,
        { tenantId: 1n, artifactCode: 'TEST', requestId: 'r-ext', allowExternal: true },
      );

    it('acepta el valor que sí se pidió', async () => {
      respondWith({ age: 33 });
      const result = await resolveWithExternal({ monthly_income: 4500 });
      expect(result.values.age).toBe(33);
      expect(result.valid).toBe(true);
    });

    it('descarta códigos que no se pidieron', async () => {
      respondWith({ age: 33, hidden_override: 'APPROVED' });
      const result = await resolveWithExternal({ monthly_income: 4500 });
      expect(result.values).not.toHaveProperty('hidden_override');
    });

    it('no deja que el proveedor sobrescriba un valor enviado por el cliente', async () => {
      respondWith({ age: 33, monthly_income: 999_999 });
      const result = await resolveWithExternal({ monthly_income: 4500 });
      expect(result.values.monthly_income).toBe(4500);
    });

    it('ignora una respuesta con forma inesperada', async () => {
      respondWith([{ age: 33 }]);
      const result = await resolveWithExternal({ monthly_income: 4500 });
      expect(result.values).not.toHaveProperty('0');
      expect(result.valid).toBe(false);
    });
  });
});

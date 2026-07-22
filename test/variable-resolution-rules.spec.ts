import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import type { VariableContractSnapshot } from '../src/modules/graph/graph.types';
import { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';

/**
 * Validation, defaulting and external-resolution coverage for the variable resolver — the
 * gate every decision input passes through. A type or bound that fails open here lets an
 * out-of-contract value reach the engine, so the type matrix, the schema/rule checks, the
 * default policy and the provider failure modes are all pinned.
 */
describe('VariableResolutionService rules', () => {
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
  });
  const service = new VariableResolutionService(
    config,
    new HashService(config),
    new MetricsService(),
  );

  function contract(overrides: Partial<VariableContractSnapshot> = {}): VariableContractSnapshot {
    return {
      variableVersionId: '1',
      code: 'v',
      version: 1,
      dataType: 'NUMBER',
      nullable: false,
      validationSchema: {},
      validationRules: [],
      sources: [],
      required: true,
      fallbackPolicy: 'FAIL_CLOSED',
      sensitive: false,
      ...overrides,
    };
  }

  const baseOpts = { tenantId: 1n, artifactCode: 'T', requestId: 'r', allowExternal: false };
  const resolve = (
    contracts: VariableContractSnapshot[],
    input: Record<string, unknown>,
    opts: Partial<typeof baseOpts> = {},
    svc: VariableResolutionService = service,
  ) => svc.resolve(contracts, input, { ...baseOpts, ...opts });

  const messages = (result: Awaited<ReturnType<typeof resolve>>) =>
    result.errors.map((e) => e.message).join(' | ');

  describe('defaulting and requiredness', () => {
    it('applies a default and marks the source when the value is absent', async () => {
      const result = await resolve([contract({ defaultValue: 42, required: false })], {});
      expect(result.valid).toBe(true);
      expect(result.values.v).toBe(42);
      expect(result.snapshots[0].wasDefaulted).toBe(true);
      expect(result.snapshots[0].sourceCode).toBe('DEFAULT');
    });

    it('does not default when the fallback policy is FAIL', async () => {
      const result = await resolve([contract({ defaultValue: 42, fallbackPolicy: 'FAIL' })], {});
      expect(result.valid).toBe(false);
      expect(messages(result)).toContain('is missing');
    });

    it('rejects a required non-nullable value that is absent', async () => {
      const result = await resolve([contract()], {});
      expect(result.errors[0].code).toBe('VARIABLE_MISSING_OR_INVALID');
      // A required-missing contract short-circuits before emitting a snapshot.
      expect(result.snapshots).toHaveLength(0);
    });

    it('allows an optional value to be absent and records it as unresolved', async () => {
      const result = await resolve([contract({ required: false, nullable: true })], {});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.snapshots[0].sourceCode).toBe('UNRESOLVED');
    });
  });

  describe('type matrix', () => {
    const cases: Array<{ type: string; good: unknown; bad: unknown }> = [
      { type: 'STRING', good: 'x', bad: 5 },
      { type: 'INTEGER', good: 5, bad: 5.5 },
      { type: 'NUMBER', good: 5.5, bad: 'x' },
      { type: 'BOOLEAN', good: true, bad: 'x' },
      { type: 'ARRAY', good: [1], bad: { a: 1 } },
      { type: 'OBJECT', good: { a: 1 }, bad: [1] },
    ];

    it.each(cases)('accepts a valid $type and rejects a mismatch', async ({ type, good, bad }) => {
      const ok = await resolve([contract({ dataType: type })], { v: good });
      expect(ok.valid).toBe(true);

      const nok = await resolve([contract({ dataType: type })], { v: bad });
      expect(nok.valid).toBe(false);
      expect(messages(nok)).toContain(`must be of type ${type}`);
    });
  });

  describe('validationSchema bounds', () => {
    it('enforces numeric minimum/maximum/exclusiveMaximum', async () => {
      expect(
        messages(await resolve([contract({ validationSchema: { minimum: 10 } })], { v: 5 })),
      ).toContain('below minimum');
      expect(
        messages(await resolve([contract({ validationSchema: { maximum: 10 } })], { v: 20 })),
      ).toContain('above maximum');
      expect(
        messages(
          await resolve([contract({ validationSchema: { exclusiveMaximum: 10 } })], { v: 10 }),
        ),
      ).toContain('lower than 10');
    });

    it('enforces string length, pattern and enum', async () => {
      expect(
        messages(
          await resolve([contract({ dataType: 'STRING', validationSchema: { minLength: 3 } })], {
            v: 'ab',
          }),
        ),
      ).toContain('shorter than 3');
      expect(
        messages(
          await resolve([contract({ dataType: 'STRING', validationSchema: { maxLength: 2 } })], {
            v: 'abc',
          }),
        ),
      ).toContain('longer than 2');
      expect(
        messages(
          await resolve(
            [contract({ dataType: 'STRING', validationSchema: { pattern: '^\\d+$' } })],
            { v: 'abc' },
          ),
        ),
      ).toContain('does not match');
      expect(
        messages(
          await resolve(
            [contract({ dataType: 'STRING', validationSchema: { enum: ['A', 'B'] } })],
            { v: 'C' },
          ),
        ),
      ).toContain('outside the allowed enum');
    });
  });

  describe('validationRules', () => {
    const rule = (
      ruleType: string,
      config: Record<string, unknown>,
      errorCode: string,
    ): VariableContractSnapshot['validationRules'][number] => ({
      ruleType,
      config,
      severity: 'HIGH',
      errorCode,
    });

    it('applies MIN, MAX, REGEX and ENUM rules', async () => {
      expect(
        messages(
          await resolve([contract({ validationRules: [rule('MIN', { value: 10 }, 'E_MIN')] })], {
            v: 5,
          }),
        ),
      ).toContain('E_MIN');
      expect(
        messages(
          await resolve([contract({ validationRules: [rule('MAX', { value: 10 }, 'E_MAX')] })], {
            v: 20,
          }),
        ),
      ).toContain('E_MAX');
      expect(
        messages(
          await resolve(
            [
              contract({
                dataType: 'STRING',
                validationRules: [rule('REGEX', { pattern: '^\\d+$' }, 'E_RX')],
              }),
            ],
            { v: 'abc' },
          ),
        ),
      ).toContain('E_RX');
      expect(
        messages(
          await resolve(
            [
              contract({
                dataType: 'STRING',
                validationRules: [rule('ENUM', { values: ['A'] }, 'E_EN')],
              }),
            ],
            { v: 'B' },
          ),
        ),
      ).toContain('E_EN');
    });
  });

  describe('external resolution', () => {
    const withBackend = new VariableResolutionService(
      new ConfigService({
        AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
        VARIABLE_BACKEND_URL: 'http://backend',
      }),
      new HashService(config),
      { recordProviderFailure: jest.fn() } as unknown as MetricsService,
    );
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(globalThis, 'fetch');
    });
    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('returns nothing and stays missing when no backend URL is configured', async () => {
      const result = await resolve([contract()], {}, { allowExternal: true });
      expect(result.valid).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('merges values fetched from the backend', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ values: { v: 99 } }),
      } as Response);
      const result = await resolve([contract()], {}, { allowExternal: true }, withBackend);
      expect(result.valid).toBe(true);
      expect(result.values.v).toBe(99);
    });

    it('records a provider failure on a non-OK response', async () => {
      const metrics = { recordProviderFailure: jest.fn() };
      const svc = new VariableResolutionService(
        new ConfigService({
          AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
          VARIABLE_BACKEND_URL: 'http://backend',
        }),
        new HashService(config),
        metrics as unknown as MetricsService,
      );
      fetchSpy.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
      const result = await svc.resolve([contract()], {}, { ...baseOpts, allowExternal: true });
      expect(result.valid).toBe(false);
      expect(metrics.recordProviderFailure).toHaveBeenCalledWith('variable_backend', 'http_503');
    });

    it('classifies an aborted fetch as a timeout and a network error as unreachable', async () => {
      const metrics = { recordProviderFailure: jest.fn() };
      const svc = new VariableResolutionService(
        new ConfigService({
          AUDIT_HASH_SECRET: 'test-secret-with-at-least-24-characters',
          VARIABLE_BACKEND_URL: 'http://backend',
        }),
        new HashService(config),
        metrics as unknown as MetricsService,
      );

      fetchSpy.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      await svc.resolve([contract()], {}, { ...baseOpts, allowExternal: true });
      expect(metrics.recordProviderFailure).toHaveBeenLastCalledWith('variable_backend', 'timeout');

      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await svc.resolve([contract()], {}, { ...baseOpts, allowExternal: true });
      expect(metrics.recordProviderFailure).toHaveBeenLastCalledWith(
        'variable_backend',
        'unreachable',
      );
    });
  });
});

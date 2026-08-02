import { TestExecutionService } from '../src/modules/testing/test-execution.service';

describe('TestExecutionService', () => {
  it('rejects baseline comparison instead of silently producing incomplete evidence', async () => {
    const service = new TestExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.enqueueSuite(1n, 1n, { baselineCompiledArtifactId: '2' }, { id: 'tester' } as never),
    ).rejects.toMatchObject({
      code: 'BASELINE_COMPARISON_NOT_SUPPORTED',
      status: 422,
    });
  });
});

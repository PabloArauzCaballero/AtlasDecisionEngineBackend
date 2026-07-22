import { ConfigService } from '@nestjs/config';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';

/**
 * Plan §3.8: the in-process script runner is not an OS security boundary, so it must refuse
 * to run in production at runtime — not only via env-schema validation, which a bad deploy
 * could bypass.
 */
describe('ScriptNodeRunnerService production guard', () => {
  it('refuses IN_PROCESS execution in production even when scripts are enabled', async () => {
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        NODE_ENV: 'production',
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_RUNNER_MODE: 'IN_PROCESS',
      }),
    );
    await expect(
      runner.execute('JAVASCRIPT', 'return { scoring: 700 };', {}),
    ).rejects.toMatchObject({
      code: 'SCRIPT_RUNNER_INSECURE_IN_PRODUCTION',
    });
  });

  it('does not raise the insecure-in-production error outside production', async () => {
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        NODE_ENV: 'development',
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_NODE_TIMEOUT_MS: 3000,
      }),
    );
    // It runs (returns a value); the point is it does not throw the production guard error.
    await expect(runner.execute('JAVASCRIPT', 'return { scoring: 700 };', {})).resolves.toEqual({
      scoring: 700,
    });
  });
});

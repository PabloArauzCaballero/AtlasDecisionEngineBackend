import { ConfigService } from '@nestjs/config';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';

/**
 * Regression guard for the classic node:vm sandbox escape: any object/function reference
 * that crosses from the outer (unsandboxed) realm into the vm context carries a path back
 * out via `.constructor.constructor` — V8's `codeGeneration.strings: false` only restricts
 * code generation native to the sandboxed context, not outer-realm functions reached by
 * reference. Confirmed exploitable before the fix (proved `process` was reachable from
 * inside a RESULT node script); this asserts it stays closed.
 */
describe('ScriptNodeRunnerService sandbox escape (IN_PROCESS)', () => {
  // Generous timeout on purpose: these cases assert that constructor access is *blocked*,
  // not how fast the sandbox runs. At 1000ms a loaded full-suite run made the two cases that
  // expect a returned value time out instead, so the runner threw before the assertion could
  // observe `escaped: 'undefined'`. A wide budget removes that false negative without
  // weakening the escape assertions at all.
  const runner = new ScriptNodeRunnerService(
    new ConfigService({
      SCRIPT_NODES_ENABLED: true,
      SCRIPT_NODE_TIMEOUT_MS: 5000,
    }),
  );

  it('cannot reach the outer Function constructor through the injected variables object', async () => {
    const escapePayload =
      'const outerFn = variables.constructor.constructor;' +
      'return { escaped: outerFn("return process")() };';
    await expect(
      runner.execute('JAVASCRIPT', escapePayload, {
        variables: { anything: 1 },
        decision: {},
        output: {},
      }),
    ).rejects.toThrow();
  });

  it('cannot reach the outer Function constructor through decision or output', async () => {
    const escapePayload = 'return { escaped: typeof decision.constructor };';
    const result = await runner.execute('JAVASCRIPT', escapePayload, {
      variables: {},
      decision: { foo: 'bar' },
      output: {},
    });
    expect(result).toEqual({ escaped: 'undefined' });
  });

  it('cannot reach the outer Function constructor through nested arrays/objects', async () => {
    const escapePayload = 'return { escaped: typeof variables.items[0].constructor };';
    const result = await runner.execute('JAVASCRIPT', escapePayload, {
      variables: { items: [{ nested: true }] },
      decision: {},
      output: {},
    });
    expect(result).toEqual({ escaped: 'undefined' });
  });
});

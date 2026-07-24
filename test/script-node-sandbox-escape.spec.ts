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

/**
 * Regression guard for the Python restricted-builtins sandbox escape: str.format()/
 * format_map() resolve "{0.__class__...}"-style field specs at runtime via getattr chains
 * inside a plain string constant, so the AST-level dunder-attribute check never sees a real
 * ast.Attribute node — the classic bypass (class introspection -> __subclasses__ -> the real
 * __builtins__ -> full code execution), reachable with no import/exec/eval token in source.
 * Confirmed exploitable before the fix; this asserts the call sites are rejected outright while
 * ordinary str usage keeps working.
 */
describe('ScriptNodeRunnerService Python sandbox escape (IN_PROCESS)', () => {
  const runner = new ScriptNodeRunnerService(
    new ConfigService({ SCRIPT_NODES_ENABLED: true, SCRIPT_NODE_TIMEOUT_MS: 5000 }),
  );

  it('rejects str.format() attribute-traversal payloads', async () => {
    const payload =
      "result = {'escaped': '{0.__class__.__bases__[0].__subclasses__()}'.format(variables)}";
    await expect(runner.execute('PYTHON', payload, { variables: {}, decision: {}, output: {} })).rejects.toThrow();
  });

  it('rejects str.format_map() the same way', async () => {
    const payload = "result = {'escaped': '{x.__class__}'.format_map({'x': variables})}";
    await expect(runner.execute('PYTHON', payload, { variables: {}, decision: {}, output: {} })).rejects.toThrow();
  });

  it('still allows ordinary str() and string concatenation', async () => {
    const payload = "result = {'value': str(variables['amount']) + '-ok'}";
    const result = await runner.execute('PYTHON', payload, {
      variables: { amount: 42 },
      decision: {},
      output: {},
    });
    expect(result).toEqual({ value: '42-ok' });
  });
});

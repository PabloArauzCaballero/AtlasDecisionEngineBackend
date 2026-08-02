import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The SIDECAR runner is the one that executes untrusted RESULT-node scripts in production
 * (SCRIPT_RUNNER_MODE=SIDECAR is mandatory there, see .claude/rules/30-security.md), yet its
 * vm wrapper had drifted from the hardened in-process one: it handed the sandbox
 * `Object.freeze(context.variables)` (frozen but WITH its outer-realm prototype) and
 * `Object.create(Math)` (the outer realm's Math as a prototype). Both expose
 * `.constructor.constructor` — the outer Function constructor — and `process` was reachable
 * through either. The gVisor container is still the outer boundary, but the vm boundary must
 * hold on its own.
 *
 * These cases run the sidecar's real wrapper, extracted from runner/server.mjs, so the guard
 * cannot pass against a copy that no longer matches what ships.
 */
const RUNNER_PATH = join(__dirname, '..', 'runner', 'server.mjs');
const RUNNER_SOURCE = readFileSync(RUNNER_PATH, 'utf8');

function wrapperOf(name: 'JS_WRAPPER' | 'PYTHON_WRAPPER'): string {
  const match = RUNNER_SOURCE.match(new RegExp(`const ${name} = String\\.raw\`([\\s\\S]*?)\`;`));
  if (!match) throw new Error(`${name} not found in runner/server.mjs`);
  return match[1];
}

function runInSidecarWrapper(source: string, variables: Record<string, unknown> = { a: 1 }) {
  const execution = spawnSync(process.execPath, ['-e', wrapperOf('JS_WRAPPER')], {
    input: JSON.stringify({
      source,
      context: { variables, decision: { foo: 'bar' }, output: {} },
      timeoutMs: 5_000,
    }),
    encoding: 'utf8',
    timeout: 20_000,
  });
  return {
    status: execution.status,
    value: execution.stdout ? (JSON.parse(execution.stdout) as Record<string, unknown>) : undefined,
  };
}

describe('runner sidecar JavaScript sandbox escape', () => {
  it('strips the prototype of injected context objects, so no constructor is reachable', () => {
    const { value } = runInSidecarWrapper(
      'return { variables: typeof variables.constructor, decision: typeof decision.constructor,' +
        ' nested: typeof variables.items[0].constructor };',
      { items: [{ nested: true }] },
    );
    expect(value).toEqual({
      variables: 'undefined',
      decision: 'undefined',
      nested: 'undefined',
    });
  });

  it('cannot reach the outer realm through Math', () => {
    const { value } = runInSidecarWrapper(
      'const f = Math.constructor && Math.constructor.constructor;' +
        "if (typeof f !== 'function') return { escaped: 'no-ctor' };" +
        "try { return { escaped: typeof f('return process')().pid }; }" +
        "catch { return { escaped: 'blocked' }; }",
    );
    expect(['no-ctor', 'blocked']).toContain(value?.escaped);
  });

  it('blocks Math.random but keeps the rest of Math usable', () => {
    const { value } = runInSidecarWrapper(
      'let blocked = false;' +
        'try { Math.random(); } catch { blocked = true; }' +
        'return { blocked, floor: Math.floor(2.7) };',
    );
    expect(value).toEqual({ blocked: true, floor: 2 });
  });

  it('keeps the sidecar wrappers in sync with the hardened in-process ones', () => {
    // The escape existed because the two copies drifted. They cannot be shared (the runner is
    // deliberately dependency-free and cannot import from src/), so pin the security-relevant
    // parts instead: a change to one must be mirrored, or this fails.
    const inProcess = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'graph', 'script-node-runner.service.ts'),
      'utf8',
    );
    for (const invariant of [
      'function toNullProto(value)',
      'sandbox.variables = toNullProto(payload.context.variables || {})',
      'sandbox.decision = toNullProto(payload.context.decision || {})',
      'sandbox.output = toNullProto(payload.context.output || {})',
      'Object.defineProperty(Math, "random"',
    ]) {
      expect(wrapperOf('JS_WRAPPER')).toContain(invariant);
      expect(inProcess).toContain(invariant);
    }
    // The Python AST guard is the other half of the sandbox and must not drift either.
    expect(wrapperOf('PYTHON_WRAPPER').replace(/\s+/g, ' ')).toContain(
      "node.func.attr in ('format', 'format_map')",
    );
    expect(inProcess.replace(/\s+/g, ' ')).toContain("node.func.attr in ('format', 'format_map')");
  });

  /**
   * §9.3 pide una cota de memoria. El runner de JS siempre tuvo `--max-old-space-size`, pero
   * el de Python no tenía ninguna: un script podía reservar hasta el límite del CONTENEDOR y,
   * desde que el sidecar atiende varias ejecuciones a la vez, llevarse por delante las de
   * otros tenants. Medido con el wrapper real en Linux, sobre `list(range(60_000_000))` (solo
   * builtins permitidos): con la cota muere con `MemoryError` y falla únicamente ese script;
   * sin ella el kernel responde `Killed` tras agotar el contenedor entero.
   */
  it('acota la memoria del proceso de Python en ambos runners', () => {
    const inProcess = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'graph', 'script-node-runner.service.ts'),
      'utf8',
    );
    for (const invariant of [
      'resource.setrlimit(resource.RLIMIT_AS, (_max_bytes, _max_bytes))',
      "_max_bytes = int(payload.get('maxMemoryBytes') or 0)",
      // Windows no tiene `resource`; sin este except el runner en desarrollo dejaría de
      // ejecutar Python en absoluto.
      'except (ImportError, ValueError, OSError):',
    ]) {
      expect(wrapperOf('PYTHON_WRAPPER')).toContain(invariant);
      expect(inProcess).toContain(invariant);
    }
    // Y la cota tiene que llegar al wrapper: el guard no sirve si nadie manda el valor.
    expect(RUNNER_SOURCE).toContain('maxMemoryBytes');
    expect(inProcess).toContain('maxMemoryBytes: this.maxMemoryBytes');
  });
});

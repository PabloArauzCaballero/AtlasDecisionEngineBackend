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
  /*
   * La garantía cambió de forma, no de fondo. Antes se arrancaba el prototipo
   * (`setPrototypeOf(copy, null)`), y entonces NINGÚN constructor era alcanzable.
   * Eso cerraba la fuga pero también dejaba a los arrays sin `.map`, `.reduce` ni
   * `.sort`: cualquier variable de tipo LISTA era inservible y moría con
   * SCRIPT_EXECUTION_FAILED sin decir por qué.
   *
   * Ahora los datos se parsean DENTRO del contexto, así que su constructor sí
   * existe — pero es el del PROPIO sandbox, cuyo `codeGeneration.strings` está
   * desactivado. El escape clásico `.constructor.constructor("return process")`
   * muere en EvalError en vez de devolver el `process` del realm exterior.
   */
  it('el constructor alcanzable es el del sandbox, no el del realm exterior', () => {
    const { value } = runInSidecarWrapper(
      'let escaped = null;' +
        'try { escaped = variables.items[0].constructor.constructor("return process")().pid; }' +
        'catch (error) { escaped = "blocked:" + error.name; }' +
        'return { escaped };',
      { items: [{ nested: true }] },
    );
    expect(String(value?.escaped)).toContain('blocked:');
  });

  it('el mismo escape por un ARRAY tampoco alcanza el realm exterior', () => {
    const { value } = runInSidecarWrapper(
      'let escaped = null;' +
        'try { escaped = variables.lista.constructor.constructor("return process")().pid; }' +
        'catch (error) { escaped = "blocked:" + error.name; }' +
        'return { escaped };',
      { lista: [1, 2, 3] },
    );
    expect(String(value?.escaped)).toContain('blocked:');
  });

  it('una variable de tipo LISTA conserva sus métodos y se puede recorrer', () => {
    // Es el defecto que motivó el cambio: con el prototipo arrancado, esto moría.
    const { value } = runInSidecarWrapper(
      'return {' +
        ' suma: variables.lista.reduce(function (a, b) { return a + b; }, 0),' +
        ' doble: variables.lista.map(function (x) { return x * 2; }),' +
        ' orden: [3, 1, 2].sort(),' +
        ' largo: variables.lista.length };',
      { lista: [1, 2, 3] },
    );
    expect(value).toEqual({ suma: 6, doble: [2, 4, 6], orden: [1, 2, 3], largo: 3 });
  });

  it('las entradas siguen congeladas: el script no puede alterarlas', () => {
    const { value } = runInSidecarWrapper(
      'let blocked = false;' +
        'try { variables.lista.push(9); } catch { blocked = true; }' +
        'return { blocked, largo: variables.lista.length };',
      { lista: [1, 2, 3] },
    );
    expect(value).toEqual({ blocked: true, largo: 3 });
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

  /*
   * El código del autor se inserta como texto dentro del cuerpo de `function (variables, ...) { "use
   * strict"; <preámbulo> <código> }`. Un texto que cierra esa función y abre otra saltaba el modo
   * estricto y el preámbulo —con lo que `Math.random` volvía a funcionar y la decisión dejaba de ser
   * reproducible—. Se prueba con el wrapper real que ahora ni siquiera llega a ejecutarse.
   */
  it('rechaza un script que cierra el cuerpo de la función del wrapper', () => {
    const { status, value } = runInSidecarWrapper(
      'return { cerrada: true }; }), (function () { return { r: Math.random() >= 0 }; ',
    );
    expect(status).not.toBe(0);
    expect(value).toBeUndefined();
  });

  it('rechaza un cierre disfrazado de comentario o de cadena que no cierra nada', () => {
    const { status } = runInSidecarWrapper(
      'return { x: 1 }; /* */ }) //\n, (function () { return { y: 1 }; ',
    );
    expect(status).not.toBe(0);
  });

  it('sigue ejecutando un cuerpo legítimo con funciones, llaves y comentarios', () => {
    const { status, value } = runInSidecarWrapper(
      '// suma de una lista\nconst f = function (xs) { return xs.reduce((a, b) => a + b, 0); };\n' +
        'return { total: f([1, 2, 3]), objeto: { a: { b: 1 } } };',
    );
    expect(status).toBe(0);
    expect(value).toEqual({ total: 6, objeto: { a: { b: 1 } } });
  });

  /*
   * `Date` ya no existe en el contexto, pero `new Intl.DateTimeFormat().format()` sin argumento
   * formatea el instante actual: era otra puerta al reloj. Se retira esa clase; el resto de `Intl`
   * (números, listas, comparación) no lee el reloj y se conserva.
   */
  it('no deja leer el reloj por Intl.DateTimeFormat y conserva el resto de Intl', () => {
    const { value } = runInSidecarWrapper(
      'return { dtf: typeof Intl.DateTimeFormat, nf: new Intl.NumberFormat("en-US").format(1234.5) };',
    );
    expect(value).toEqual({ dtf: 'undefined', nf: '1,234.5' });
  });

  it('keeps the sidecar wrappers in sync with the hardened in-process ones', () => {
    // The escape existed because the two copies drifted. They cannot be shared (the runner is
    // deliberately dependency-free and cannot import from src/), so pin the security-relevant
    // parts instead: a change to one must be mirrored, or this fails.
    const inProcess = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'graph', 'script-wrappers.ts'),
      'utf8',
    );
    for (const invariant of [
      'sandbox.__atlasVariables = JSON.stringify(payload.context.variables || {})',
      'sandbox.__atlasDecision = JSON.stringify(payload.context.decision || {})',
      'sandbox.__atlasOutput = JSON.stringify(payload.context.output || {})',
      '__atlasFreeze(JSON.parse(__atlasVariables))',
      'Object.defineProperty(Math, "random"',
      'delete Intl.DateTimeFormat;',
      "vm.compileFunction('\"use strict\";\\n' + payload.source, ['variables', 'decision', 'output'])",
    ]) {
      expect(wrapperOf('JS_WRAPPER')).toContain(invariant);
      expect(inProcess).toContain(invariant);
    }
    // The Python AST guard is the other half of the sandbox and must not drift either.
    expect(wrapperOf('PYTHON_WRAPPER').replace(/\s+/g, ' ')).toContain(
      "node.func.attr in ('format', 'format_map')",
    );
    expect(inProcess.replace(/\s+/g, ' ')).toContain("node.func.attr in ('format', 'format_map')");
    // El atributo `format` se rechaza también sin llamada (`f = '{0.__class__}'.format`).
    const formatComoValor =
      "isinstance(node, ast.Attribute) and node.attr in ('format', 'format_map')";
    expect(wrapperOf('PYTHON_WRAPPER').replace(/\s+/g, ' ')).toContain(formatComoValor);
    expect(inProcess.replace(/\s+/g, ' ')).toContain(formatComoValor);
    // Y el rechazo de los atributos de introspección de frames, que no empiezan por '__'.
    const frames = "node.attr.startswith(('f_', 'gi_', 'cr_', 'ag_', 'tb_', 'co_'))";
    expect(wrapperOf('PYTHON_WRAPPER').replace(/\s+/g, ' ')).toContain(frames);
    expect(inProcess.replace(/\s+/g, ' ')).toContain(frames);
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
    // Los envoltorios viven en `script-wrappers.ts` y el parámetro de memoria se pasa en el servicio.
    const inProcess = ['script-wrappers.ts', 'script-node-runner.service.ts']
      .map((file) => readFileSync(join(__dirname, '..', 'src', 'modules', 'graph', file), 'utf8'))
      .join('\n');
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

/**
 * La guardia de Python rechazaba `'…'.format(x)` solo cuando el atributo era el `func` de una
 * llamada. Obtener el método sin llamarlo (`f = '{0.__class__.__mro__}'.format`, `g = str.format`)
 * y llamarlo después por su nombre no produce ese patrón, y las cadenas de formato recorren
 * `__class__`, `__mro__` y `__globals__` sin que exista un `ast.Attribute` dunder. Se prueba con el
 * wrapper real del sidecar.
 */
describe('runner sidecar Python: str.format como valor', () => {
  function runPython(source: string) {
    const execution = spawnSync('python3', ['-I', '-S', '-B', '-c', wrapperOf('PYTHON_WRAPPER')], {
      input: JSON.stringify({
        source,
        context: { variables: { a: 1 }, decision: {}, output: {} },
        timeoutMs: 5_000,
        maxMemoryBytes: 256 * 1024 * 1024,
      }),
      encoding: 'utf8',
      timeout: 20_000,
    });
    return { status: execution.status, stdout: execution.stdout };
  }

  it.each([
    ['alias del método', "f = '{0.__class__.__mro__}'.format\nresult = {'x': f(1)}"],
    ['método de la clase str', "f = str.format\nresult = {'x': f('{0.__class__}', 1)}"],
    ['format_map como valor', "f = '{x.__class__}'.format_map\nresult = {'x': f({'x': 1})}"],
    ['pasado a map()', "result = {'x': list(map('{0.__class__}'.format, [1]))}"],
  ])('rechaza %s', (_nombre, source) => {
    const { status, stdout } = runPython(source);
    expect(status).not.toBe(0);
    expect(stdout).toBe('');
  });

  it('sigue permitiendo str(), concatenación y atributos corrientes', () => {
    const { status, stdout } = runPython(
      "result = {'x': str(variables['a']) + '-ok', 'n': len(str(variables))}",
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ x: '1-ok', n: 8 });
  });
});

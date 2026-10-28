export const JS_WRAPPER = String.raw`
const vm = require('node:vm');

// Any object or function reference that crosses from this (outer) realm into the
// sandbox carries a path back out via '.constructor.constructor' — the classic vm
// escape (V8's codeGeneration.strings restriction only covers code generation APIs
// native to the sandboxed context, not outer-realm functions reached by reference).
//
// Se cierra parseando los datos DENTRO del contexto (ver la llamada al final): asi
// nacen con los prototipos del propio sandbox y su cadena no lleva a ninguna parte
// del realm exterior. Antes se hacia con setPrototypeOf(copy, null), que servia
// para objetos pero sobre un ARRAY le arrancaba Array.prototype: el script recibia
// algo sin .map, .reduce ni .sort, de modo que cualquier variable de tipo LISTA era
// inservible y moria con SCRIPT_EXECUTION_FAILED sin explicar la causa.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  const sandbox = Object.create(null);
  // Viajan como JSON y se parsean dentro del contexto, nunca fuera.
  sandbox.__atlasVariables = JSON.stringify(payload.context.variables || {});
  sandbox.__atlasDecision = JSON.stringify(payload.context.decision || {});
  sandbox.__atlasOutput = JSON.stringify(payload.context.output || {});
  // A bare vm context has no Node-specific globals (setTimeout/setInterval are Node
  // additions, not V8/ECMAScript ones) — assigning undefined primitives here, before
  // context creation, shadows Date and defines otherwise-absent setTimeout/setInterval
  // as no-ops without exposing any outer-realm reference.
  sandbox.Date = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  // Runs inside the sandboxed context, so this mutates the context's own native Math —
  // never an outer-realm object — leaving no reference for the script to escape through.
  // Math's other static members stay intact (Math.random is the only non-deterministic one);
  // its property descriptor is {writable:true, configurable:true} per spec, so this succeeds.
  //
  // Intl.DateTimeFormat se retira por la misma razon que Date: "new Intl.DateTimeFormat().format()"
  // sin argumento formatea el instante ACTUAL, asi que dejaba al script leer el reloj y hacia la
  // decision irreproducible. El resto de Intl no lee el reloj y se conserva.
  const preamble =
    'Object.defineProperty(Math, "random", { value: () => { throw new Error("Math.random is not allowed"); } });\n' +
    'delete Intl.DateTimeFormat;\n';
  // El congelado tambien ocurre dentro: el script no debe poder alterar sus entradas,
  // y congelar aqui usa el Object del propio contexto, no el del realm exterior.
  const freeze =
    'const __atlasFreeze = (o) => { if (o && typeof o === "object") { ' +
    'Object.keys(o).forEach(function (k) { __atlasFreeze(o[k]); }); Object.freeze(o); } return o; };\n';
  const args =
    '(__atlasFreeze(JSON.parse(__atlasVariables)), ' +
    '__atlasFreeze(JSON.parse(__atlasDecision)), ' +
    '__atlasFreeze(JSON.parse(__atlasOutput)))';
  // El codigo del autor se pega TEXTUALMENTE dentro del cuerpo de la funcion. Un texto como
  // "}), (function () { ... " cerraba esa funcion, descartaba "use strict" y el preambulo (con
  // Math.random vuelto a funcionar) y ejecutaba el resto como otra funcion. Compilarlo antes como
  // CUERPO de funcion, sin ejecutarlo, lo rechaza: el analizador solo acepta un cuerpo balanceado.
  vm.compileFunction('"use strict";\n' + payload.source, ['variables', 'decision', 'output']);
  const wrapped =
    freeze +
    '(function (variables, decision, output) { "use strict";\n' +
    preamble +
    payload.source +
    '\n})' +
    args;
  const result = new vm.Script(wrapped, { filename: 'atlas-result-node.js' })
    .runInContext(context, { timeout: payload.timeoutMs });
  process.stdout.write(JSON.stringify(result));
});
`;

export const PYTHON_WRAPPER = String.raw`
import ast, json, sys
payload = json.load(sys.stdin)
# Cota de memoria por proceso (§9.3). El runner de JS ya recibe --max-old-space-size; Python
# no tenia ninguna, asi que un script desbocado podia crecer hasta el limite del CONTENEDOR y
# llevarse por delante las ejecuciones vecinas — mas probable desde que el sidecar atiende
# varias a la vez. Medido: a 32 MiB un script normal corre igual y una fuga muere a los ~18 MiB.
# RLIMIT_AS solo existe en POSIX; en Windows (solo desarrollo) no hay nada que aplicar.
try:
    import resource
    _max_bytes = int(payload.get('maxMemoryBytes') or 0)
    if _max_bytes > 0:
        resource.setrlimit(resource.RLIMIT_AS, (_max_bytes, _max_bytes))
except (ImportError, ValueError, OSError):
    pass
tree = ast.parse(payload['source'], filename='atlas-result-node.py', mode='exec')
blocked = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.ClassDef, ast.With, ast.AsyncWith, ast.Try, ast.Raise)
# str.format()/format_map() resolve "{0.__class__.__bases__[0]...}"-style field specs at
# runtime via getattr chains inside a plain string constant — no ast.Attribute node is ever
# produced, so the dunder-attribute check below never sees it. This is the classic Python
# restricted-builtins sandbox escape (class introspection -> __subclasses__ -> real
# __builtins__ -> exec). Blocking the call sites closes it without dropping str() itself.
for node in ast.walk(tree):
    if isinstance(node, blocked):
        raise ValueError('Unsupported Python statement in RESULT node')
    # Los atributos de introspeccion de frames/generadores/corrutinas/traceback/codigo NO empiezan
    # por '__' (gi_frame, f_back, f_builtins...) y llegan a los builtins REALES del frame del
    # wrapper: se rechazan por prefijo, no por lista, para no depender de acordarse de cada uno.
    if isinstance(node, ast.Attribute) and (node.attr.startswith('__') or node.attr.startswith(('f_', 'gi_', 'cr_', 'ag_', 'tb_', 'co_'))):
        raise ValueError('Dunder and frame-introspection attributes are not allowed')
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('format', 'format_map'):
        raise ValueError('String formatting methods are not allowed')
    # Tampoco como valor: "f = '{0.__class__}'.format; f(x)" y "g = str.format" no son una llamada con
    # atributo, esquivaban la comprobacion de arriba y recorrian __class__/__mro__/__globals__ por la
    # cadena de formato. Se rechaza el atributo donde aparezca, llamado o no.
    if isinstance(node, ast.Attribute) and node.attr in ('format', 'format_map'):
        raise ValueError('String formatting methods are not allowed')
safe_builtins = {
    'abs': abs, 'bool': bool, 'dict': dict, 'enumerate': enumerate, 'float': float,
    'int': int, 'len': len, 'list': list, 'max': max, 'min': min, 'range': range,
    'round': round, 'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip, 'sorted': sorted,
}
scope = {
    'variables': payload['context'].get('variables', {}),
    'decision': payload['context'].get('decision', {}),
    'output': payload['context'].get('output', {}),
}
# Un único diccionario como globals Y locals: con globals y locals separados, una
# función definida por el script queda en locals y su cuerpo no la ve al ejecutarse
# (busca en globals), así que cualquier helper que llame a otro helper falla con
# NameError. Los builtins restringidos siguen siendo los mismos.
scope['__builtins__'] = safe_builtins
exec(compile(tree, 'atlas-result-node.py', 'exec'), scope)
sys.stdout.write(json.dumps(scope.get('result')))
`;

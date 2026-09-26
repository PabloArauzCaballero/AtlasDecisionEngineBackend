/**
 * Import dinámico que sobrevive a la compilación a CommonJS.
 *
 * El motor de extractos venía de un paquete `NodeNext`, donde
 * `await import("pdfjs-dist/legacy/build/pdf.mjs")` es un import ESM de verdad.
 * El motor de decisión compila a **CommonJS**, y ahí TypeScript degrada ese
 * `await import(...)` a un `require()`. `pdf.mjs` es ESM puro: `require()` lo
 * rechaza con `ERR_REQUIRE_ESM`, y el fallo aparece en tiempo de ejecución —al
 * leer el primer PDF—, no al compilar.
 *
 * `new Function` construye la expresión `import()` fuera del alcance del
 * compilador, así que llega intacta al runtime de Node, que sí sabe cargar ESM
 * desde CommonJS. Es la vía recomendada mientras el proyecto sea CJS; cuando
 * migre a ESM, esta función se puede sustituir por un `import()` normal sin
 * tocar a quien la llama.
 *
 * Se aísla en su propio archivo para que la explicación no se pierda y para que
 * cualquier otro adaptador que necesite cargar ESM la reutilice en vez de
 * repetir el truco.
 */
/**
 * Se construye EN CADA LLAMADA, no una vez al cargar el módulo.
 *
 * La función que devuelve `new Function` queda ligada al contexto donde se creó, y ahí está
 * registrado el callback que resuelve `import()`. Bajo Jest cada suite corre en su propia
 * máquina virtual, y al terminar se destruye: una función cacheada a nivel de módulo
 * sobrevivía a su contexto y la siguiente suite que leyera un PDF fallaba con
 * «A dynamic import callback was invoked without --experimental-vm-modules», un mensaje que
 * señala al flag —que sí estaba puesto— en vez de al contexto muerto. Aparecía o no según el
 * orden en que Jest repartiera las suites, que es la peor clase de fallo intermitente.
 *
 * En producción el coste es una construcción por PDF leído, irrelevante frente a analizarlo.
 */
function dynamicImport(specifier: string): Promise<unknown> {
  // El constructor `Function` es aquí el mecanismo, no un descuido: es lo único que TypeScript
  // no reescribe a `require()` al compilar a CommonJS, que es justo lo que hay que evitar para
  // poder cargar un módulo ESM. El cuerpo es una constante literal, no entra nada de fuera.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const load = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<unknown>;
  return load(specifier);
}

/** Carga un módulo ESM desde código compilado a CommonJS. */
export async function importEsm<T>(specifier: string): Promise<T> {
  return (await dynamicImport(specifier)) as T;
}

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
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

/** Carga un módulo ESM desde código compilado a CommonJS. */
export async function importEsm<T>(specifier: string): Promise<T> {
  return (await dynamicImport(specifier)) as T;
}

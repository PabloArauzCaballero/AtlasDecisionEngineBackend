/**
 * Cuenta las páginas de un PDF sin abrir una biblioteca de PDF.
 *
 * El motor de impresión no informa de cuántas hojas produjo, y ese número importa: es lo que
 * distingue «el informe cabe» de «el informe se ha desbordado a nueve páginas», y es el dato
 * que hace útil la métrica de tamaño. Cargar un lector de PDF completo para leer un entero
 * añadiría megabytes de dependencia al camino de generación.
 *
 * Se lee el catálogo: el nodo raíz `/Type /Pages` declara `/Count N`. Si esa lectura no
 * encuentra nada —un PDF con flujos de objetos comprimidos, por ejemplo— se cuentan los
 * objetos `/Type /Page`, y si tampoco, se devuelve `undefined`. Devolver `1` por defecto sería
 * peor que no saberlo: un número inventado se grafica igual que uno medido.
 */
const PAGES_COUNT = /\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/;
const PAGE_OBJECT = /\/Type\s*\/Page[^s]/g;

export function countPdfPages(content: Uint8Array): number | undefined {
  // `latin1` y no `utf8`: un PDF es binario y `utf8` sustituye bytes inválidos por U+FFFD, lo
  // que puede partir justo la cadena que se busca.
  const text = Buffer.from(content).toString('latin1');

  const declared = PAGES_COUNT.exec(text);
  if (declared) {
    const count = Number.parseInt(declared[1], 10);
    if (Number.isInteger(count) && count > 0) return count;
  }

  const matches = text.match(PAGE_OBJECT);
  return matches && matches.length > 0 ? matches.length : undefined;
}

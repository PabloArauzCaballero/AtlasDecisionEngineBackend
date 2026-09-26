/**
 * Generador mínimo de PDF con texto posicionado.
 *
 * Los escenarios de prueba del worker de extractos necesitan PDF de verdad: el
 * motor lee posiciones de texto para deducir columnas, así que un `Buffer` con
 * cualquier contenido no ejercita nada. Había tres formas de conseguirlos:
 *
 * 1. Guardar extractos bancarios reales en el repositorio — descartado: son
 *    datos personales y financieros de alguien.
 * 2. Añadir `pdfkit`, que es lo que hace el paquete original en sus pruebas —
 *    descartado: una dependencia más, en tiempo de ejecución y no de pruebas,
 *    para escribir cuatro objetos PDF.
 * 3. Escribir el PDF a mano. Es lo que hace este archivo.
 *
 * El formato admite mucho más de lo que se usa aquí: un catálogo, una página,
 * una fuente estándar y un flujo de contenido con `Td`/`Tj`. Eso basta para que
 * `pdfjs-dist` extraiga cada cadena con su coordenada, que es exactamente lo
 * que el motor consume.
 *
 * Es determinista: el mismo escenario produce siempre el mismo archivo, y por
 * tanto la misma huella SHA-256. Esa estabilidad es la que hace que la
 * idempotencia se pueda probar.
 */

/** Una celda: texto y su posición en la página, en puntos PDF. */
export interface PdfCell {
  readonly text: string;
  readonly x: number;
  readonly y: number;
}

const PAGE_WIDTH = 800;
const PAGE_HEIGHT = 1_100;
const FONT_SIZE = 9;

/**
 * Escapa lo que no puede ir literal dentro de una cadena PDF `( … )`.
 *
 * Sin esto, un paréntesis en una glosa —«PAGO (CUOTA 3)» es de lo más normal en
 * un extracto— cerraría la cadena antes de tiempo y produciría un archivo
 * corrupto que el lector rechaza. Los tres caracteres son los únicos con
 * significado dentro de una cadena literal.
 */
function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Sustituye lo que no sea ASCII imprimible.
 *
 * Las fuentes estándar de PDF usan una codificación de un byte, así que una
 * tilde o un símbolo de moneda saldrían como un carácter distinto del escrito.
 * Un fixture cuyo contenido no es el que dice ser confunde más que ayuda, así
 * que se transliteran los acentos y se descarta el resto.
 */
function toLatin(value: string): string {
  return (
    value
      .normalize('NFD')
      // U+0300–U+036F: las marcas diacríticas que `NFD` acaba de separar de su
      // letra base. Escrito con escapes y no con los caracteres literales, que en
      // el fuente son invisibles y hacen la regla imposible de revisar.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ')
  );
}

/**
 * Metadatos del contenedor, para los escenarios que los necesitan.
 *
 * Existe por la compuerta de autenticidad: sin poder escribir un `/Producer`, no
 * hay forma de construir un escenario que demuestre que un extracto compuesto en
 * un editor se rechaza — y un control que no tiene escenario es un control que
 * nadie sabe si sigue funcionando.
 */
export interface PdfMetadata {
  readonly producer?: string;
  readonly creator?: string;
  /** `AAAAMMDDHHMMSS`. */
  readonly creationDate?: string;
  readonly modificationDate?: string;
}

/**
 * Construye un PDF de una página con las celdas indicadas.
 *
 * Las coordenadas son las del PDF: el origen está abajo a la izquierda, así que
 * una `y` mayor está más arriba en la página.
 */
export function buildSyntheticPdf(cells: readonly PdfCell[], metadata: PdfMetadata = {}): Buffer {
  const content =
    'BT\n/F1 ' +
    FONT_SIZE +
    ' Tf\n' +
    cells
      .map((cell) => `1 0 0 1 ${cell.x} ${cell.y} Tm (${escapePdfText(toLatin(cell.text))}) Tj`)
      .join('\n') +
    '\nET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  const info = infoDictionary(metadata);
  if (info) objects.push(info);

  // La tabla de referencias cruzadas guarda el desplazamiento EXACTO en bytes de
  // cada objeto. Por eso el archivo se arma midiendo mientras se escribe, en vez
  // de concatenar y calcular después: un desplazamiento equivocado produce un
  // PDF que muchos lectores abren igual, y `pdfjs` no.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R` +
    (info ? ` /Info ${objects.length} 0 R` : '') +
    ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** El diccionario `/Info`, o nada si el escenario no declara metadatos. */
function infoDictionary(metadata: PdfMetadata): string | null {
  const entries: string[] = [];
  if (metadata.producer) entries.push(`/Producer (${escapePdfText(toLatin(metadata.producer))})`);
  if (metadata.creator) entries.push(`/Creator (${escapePdfText(toLatin(metadata.creator))})`);
  if (metadata.creationDate) entries.push(`/CreationDate (D:${metadata.creationDate})`);
  if (metadata.modificationDate) entries.push(`/ModDate (D:${metadata.modificationDate})`);
  return entries.length > 0 ? `<< ${entries.join(' ')} >>` : null;
}

/** Altura de línea usada por los escenarios, en puntos. */
export const LINE_HEIGHT = 16;

/** Convierte un número de renglón (0 arriba) en coordenada `y` del PDF. */
export function lineY(row: number): number {
  return PAGE_HEIGHT - 60 - row * LINE_HEIGHT;
}

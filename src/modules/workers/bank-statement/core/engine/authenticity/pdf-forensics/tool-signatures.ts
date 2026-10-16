/**
 * Programas con los que **nadie** produce un extracto bancario.
 *
 * La lista es de herramientas de AUTORÍA y de EDICIÓN, no de impresión: lo que
 * las une es que su usuario compone el documento página a página. Un banco emite
 * sus extractos desde un generador de informes o desde su propia web; ninguno de
 * los dos deja aquí su nombre.
 *
 * `Quartz PDFContext` merece una nota porque es el que más se cuela: es lo que
 * escribe la Vista Previa de macOS al **volver a guardar** un PDF. Un extracto
 * descargado del banco y abierto no cambia; uno que pasó por Vista Previa y se
 * guardó es, por definición, un archivo distinto del que emitió el banco.
 */
export const AUTHORING_TOOLS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /photoshop/i, label: 'Adobe Photoshop' },
  { pattern: /illustrator/i, label: 'Adobe Illustrator' },
  { pattern: /indesign/i, label: 'Adobe InDesign' },
  { pattern: /\bcanva\b/i, label: 'Canva' },
  { pattern: /microsoft[®\s]*(word|excel|powerpoint)/i, label: 'Microsoft Office' },
  { pattern: /\bword\b.*\bmicrosoft\b|\bmicrosoft\b.*\bword\b/i, label: 'Microsoft Word' },
  { pattern: /libreoffice|openoffice/i, label: 'LibreOffice' },
  { pattern: /google\s*docs|skia\/pdf.*google\s*docs/i, label: 'Google Docs' },
  { pattern: /\bpages\b.*apple|apple.*\bpages\b/i, label: 'Apple Pages' },
  { pattern: /quartz\s*pdfcontext/i, label: 'Vista Previa de macOS' },
  { pattern: /\bgimp\b/i, label: 'GIMP' },
  { pattern: /inkscape/i, label: 'Inkscape' },
  { pattern: /ilovepdf/i, label: 'iLovePDF' },
  { pattern: /smallpdf/i, label: 'Smallpdf' },
  { pattern: /\bsejda\b/i, label: 'Sejda' },
  { pattern: /pdfescape/i, label: 'PDFescape' },
  { pattern: /pdf24/i, label: 'PDF24' },
  { pattern: /foxit\s*(phantom|editor|pdf\s*editor)/i, label: 'Foxit PDF Editor' },
  { pattern: /nitro\s*(pro|pdf)/i, label: 'Nitro PDF' },
  { pattern: /pdf-xchange\s*editor/i, label: 'PDF-XChange Editor' },
  { pattern: /master\s*pdf\s*editor/i, label: 'Master PDF Editor' },
  { pattern: /\bpdfelement\b|wondershare/i, label: 'Wondershare PDFelement' },
  { pattern: /\bsoda\s*pdf\b/i, label: 'Soda PDF' },
  { pattern: /adobe\s*acrobat\s*pro/i, label: 'Adobe Acrobat Pro' },
];

/**
 * Generadores compatibles con un emisor institucional.
 *
 * No otorgan autenticidad —cualquiera puede instalar iText— pero sí retiran la
 * sospecha de «esto lo compuso una persona a mano», que es lo que la lista de
 * arriba mide. Sirven para no penalizar al banco que usa el motor de informes de
 * toda la vida.
 */
export const REPORTING_TOOLS: readonly RegExp[] = [
  /\bitext\b/i,
  /jasper\s*reports?/i,
  /crystal\s*reports?/i,
  /\bbirt\b/i,
  /report\s*lab/i,
  /\bfop\b|apache\s*fop/i,
  /oracle\s*(reports|bi\s*publisher)/i,
  /sap\s*crystal/i,
  /\bpdfbox\b/i,
  /\bprince(xml)?\b/i,
  /wkhtmltopdf/i,
  /\bdompdf\b|\btcpdf\b|\bfpdf\b|\bmpdf\b/i,
  /microsoft.*report\s*viewer/i,
  /\bjsreport\b|\bpuppeteer\b/i,
];

/**
 * Impresión desde el navegador: el «Guardar como PDF» del cliente.
 *
 * Es el caso más frecuente en la banca por internet boliviana y por eso tiene
 * categoría propia. NO es una señal de manipulación —el contenido lo pintó el
 * banco— pero sí retira una garantía: el archivo no es el que emitió el banco,
 * es una foto que el navegador tomó de su pantalla. Aporta poco peso por sí
 * solo, y agrava a las demás.
 */
export const BROWSER_PRINT: readonly RegExp[] = [/skia\/pdf/i, /chromium|chrome/i, /\bwebkit\b/i];

/** Anotaciones que se superponen al contenido: el equivalente a una tachadura. */
export const OVERLAY_ANNOTATIONS = new Set([
  'FreeText',
  'Square',
  'Circle',
  'Line',
  'Ink',
  'Stamp',
  'Polygon',
  'PolyLine',
  'Redact',
  'Caret',
  'StrikeOut',
]);

/** Cuánto puede separarse la fecha de modificación de la de creación sin decir nada. */
export const MOD_DATE_GRACE_MS = 120_000;

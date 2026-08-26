/**
 * Lo que el ARCHIVO dice de sí mismo, leído de sus bytes y no de su contenido.
 *
 * Las otras dos compuertas del worker preguntan por el contenido —«¿esto es un
 * estado de cuenta?», «¿quién lo emitió?»— y las dos se responden con el texto
 * que el PDF imprime. Ese texto lo escribe quien fabrica el archivo, así que las
 * dos se pueden satisfacer copiando la carátula de un banco en un documento de
 * Word: el clasificador suma 1.00, el detector de entidad atribuye el documento
 * al banco cuyo nombre se copió, y el motor convierte en movimientos una tabla
 * que escribió el solicitante.
 *
 * Esta compuerta pregunta otra cosa: **con qué se fabricó el archivo y si se
 * tocó después**. Es la única de las tres que no se puede contestar escribiendo
 * el texto correcto, porque no mira el texto. Mira el diccionario `/Info`, el
 * número de revisiones incrementales, las anotaciones superpuestas, el contenido
 * activo y la incrustación de fuentes — todo ello estructura del contenedor, que
 * el generador deja como rastro y que un editor de escritorio no puede borrar
 * sin reescribir el archivo entero (lo cual, a su vez, deja SU rastro).
 *
 * ## Qué NO es
 *
 * No es una verificación de firma digital. Un extracto boliviano no viene
 * firmado criptográficamente —ni ASFI lo exige ni los bancos lo emiten así—, de
 * modo que exigir una firma rechazaría el 100 % de los documentos legítimos. Lo
 * que hay aquí es evidencia circunstancial, ponderada y explicada, del mismo
 * tipo que usa un perito documental cuando no hay sello: quién dice el papel que
 * lo imprimió, si tiene tachaduras, si le añadieron una hoja después.
 *
 * ## Por qué la evidencia va PONDERADA y no en una lista de prohibiciones
 *
 * Porque las señales no valen lo mismo y varias son ambiguas por separado. Que
 * un PDF lo haya producido Chrome es normalísimo —media Bolivia imprime su banca
 * por internet con «Guardar como PDF»— y sería un rechazo absurdo; que lo haya
 * producido Photoshop no lo es en ningún escenario. Que un archivo tenga una
 * revisión incremental puede ser el propio banco añadiendo una página; que la
 * tenga ADEMÁS de haber pasado por un editor es otra cosa. Con una lista de
 * prohibiciones habría que elegir entre rechazar a los primeros o dejar pasar a
 * los últimos.
 */

/** Cada hallazgo, con su peso y su explicación. Es lo que queda en la traza. */
export interface ForensicSignal {
  readonly code: string;
  /** 0..100. Cuánta sospecha aporta por sí solo. */
  readonly weight: number;
  /** `CRITICAL` cierra el documento por sí sola, sin sumar con nada. */
  readonly severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly detail: string;
}

/** Lo que se pudo leer de la estructura del contenedor. */
export interface PdfProvenance {
  readonly producer: string | null;
  readonly creator: string | null;
  readonly creationDate: Date | null;
  readonly modificationDate: Date | null;
  /** Cuántas veces se ha reescrito el archivo por encima de su versión original. */
  readonly incrementalUpdates: number;
  readonly hasAcroForm: boolean;
  readonly annotationSubtypes: readonly string[];
  readonly hasActiveContent: boolean;
  readonly embeddedFileCount: number;
  /** Fuentes declaradas y cuántas de ellas viajan incrustadas en el archivo. */
  readonly fontsDeclared: number;
  readonly fontsEmbedded: number;
  /**
   * Fuentes declaradas que NO son de las catorce estándar del formato.
   *
   * La distinción es la que hace útil la señal. Helvetica, Times y Courier no se
   * incrustan nunca —el visor las tiene— así que su ausencia no dice nada; una
   * Calibri o una Arial Narrow declarada y no incrustada sí, porque es lo que
   * ocurre cuando el documento se compuso en un equipo que las tenía instaladas.
   */
  readonly nonStandardFonts: number;
  readonly pdfVersion: string | null;
}

export interface ForensicReport {
  readonly provenance: PdfProvenance;
  readonly signals: readonly ForensicSignal[];
  /** 0..100. La suma acotada de los pesos; 100 cuando hay una señal crítica. */
  readonly suspicionScore: number;
}

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
const AUTHORING_TOOLS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
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
const REPORTING_TOOLS: readonly RegExp[] = [
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
const BROWSER_PRINT: readonly RegExp[] = [/skia\/pdf/i, /chromium|chrome/i, /\bwebkit\b/i];

/** Anotaciones que se superponen al contenido: el equivalente a una tachadura. */
const OVERLAY_ANNOTATIONS = new Set([
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
const MOD_DATE_GRACE_MS = 120_000;

/**
 * Lee la estructura del contenedor y devuelve lo que encuentra.
 *
 * Trabaja sobre los bytes en `latin1` y con expresiones regulares, **no**
 * interpretando el PDF. Es deliberado y es la misma decisión que toma
 * `pdf-text.util` en el core: el archivo lo sube un desconocido, y un analizador
 * completo de PDF trae intérpretes de fuentes, de imágenes y de JavaScript
 * incrustado — superficie de ataque entera para lo único que hace falta aquí,
 * que es contar marcas. Una expresión regular no ejecuta nada de lo que lee.
 *
 * Que un objeto viva dentro de un flujo comprimido (`/ObjStm`) hace que algunas
 * marcas no se vean en claro. Eso NO se compensa adivinando: lo que no se ve, no
 * se cuenta. Esta compuerta acusa por lo que encuentra, nunca por lo que le
 * falta.
 */
export function readPdfProvenance(buffer: Buffer): PdfProvenance {
  const raw = buffer.toString('latin1');

  const info = readInfoDictionary(raw);
  const trailerPrevs = countMatches(raw, /\/Prev\s+\d+/g);
  const eofMarkers = countMatches(raw, /%%EOF/g);
  /*
   * Dos formas de contar lo mismo, y se toma la MENOR.
   *
   * `%%EOF` sobra en archivos que lo repiten por higiene del generador, y
   * `/Prev` sobra en los que usan tablas de referencias cruzadas encadenadas sin
   * que haya habido edición. Contar por lo bajo es lo correcto cuando la señal
   * va a pesar en un rechazo: se prefiere no ver una edición real a inventar
   * una que no hubo.
   */
  const incrementalUpdates = Math.max(0, Math.min(trailerPrevs, eofMarkers - 1));

  const annotationSubtypes = [
    ...new Set(
      [...raw.matchAll(/\/Subtype\s*\/([A-Za-z]+)/g)]
        .map((match) => match[1] ?? '')
        .filter((subtype) => OVERLAY_ANNOTATIONS.has(subtype)),
    ),
  ];

  const hasActiveContent =
    /\/JavaScript\b/.test(raw) || /\/JS\b/.test(raw) || /\/Launch\b/.test(raw);

  const baseFonts = [...raw.matchAll(/\/BaseFont\s*\/([#A-Za-z0-9+,._-]+)/g)].map(
    (match) => match[1] ?? '',
  );

  return {
    producer: info.Producer ?? null,
    creator: info.Creator ?? null,
    creationDate: parsePdfDate(info.CreationDate),
    modificationDate: parsePdfDate(info.ModDate),
    incrementalUpdates,
    hasAcroForm: /\/AcroForm\b/.test(raw),
    annotationSubtypes,
    hasActiveContent,
    embeddedFileCount: countMatches(raw, /\/EmbeddedFile\b/g),
    fontsDeclared: baseFonts.length,
    fontsEmbedded: countMatches(raw, /\/FontFile[23]?\b/g),
    nonStandardFonts: baseFonts.filter((font) => !isStandardFont(font)).length,
    pdfVersion: /%PDF-(\d\.\d)/.exec(raw)?.[1] ?? null,
  };
}

/**
 * Pondera lo encontrado y devuelve las señales con su puntaje.
 *
 * @param textPageRatio Proporción de páginas con capa de texto. Se pasa desde
 * fuera —lo sabe la extracción, no los bytes— porque un documento SIN texto
 * cambia el significado de casi todo lo demás: en una imagen no hay fuentes que
 * incrustar ni anotaciones que superponer, así que las ausencias dejan de ser
 * información y penalizarlas sería castigar dos veces al escaneado.
 */
export function assessProvenance(provenance: PdfProvenance, textPageRatio: number): ForensicReport {
  const signals: ForensicSignal[] = [];
  const toolText = `${provenance.producer ?? ''} ${provenance.creator ?? ''}`.trim();

  if (provenance.hasActiveContent) {
    signals.push({
      code: 'CONTENIDO_ACTIVO',
      weight: 100,
      severity: 'CRITICAL',
      detail:
        'El PDF lleva JavaScript o una acción de lanzamiento incrustada. Un extracto bancario no ejecuta nada.',
    });
  }

  if (provenance.embeddedFileCount > 0) {
    signals.push({
      code: 'ARCHIVOS_INCRUSTADOS',
      weight: 100,
      severity: 'CRITICAL',
      detail: `El PDF transporta ${String(provenance.embeddedFileCount)} archivo(s) incrustado(s).`,
    });
  }

  const authoring = AUTHORING_TOOLS.find((tool) => tool.pattern.test(toolText));
  if (authoring) {
    signals.push({
      code: 'HERRAMIENTA_DE_AUTORIA',
      weight: 85,
      severity: 'CRITICAL',
      detail: `El archivo declara haber sido producido con ${authoring.label}, que es una herramienta de composición y edición, no un emisor de extractos.`,
    });
  }

  if (provenance.annotationSubtypes.length > 0) {
    signals.push({
      code: 'ANOTACIONES_SUPERPUESTAS',
      weight: 70,
      severity: 'HIGH',
      detail: `Hay contenido superpuesto al documento (${provenance.annotationSubtypes.join(', ')}). Es el equivalente digital de una tachadura sobre el papel.`,
    });
  }

  if (provenance.incrementalUpdates > 0) {
    /*
     * Una revisión puede ser del propio emisor; tres ya es un archivo que se
     * abrió y se guardó varias veces. El peso sube con el número en vez de ser
     * fijo, porque lo que distingue los dos casos es la cantidad.
     */
    const weight = provenance.incrementalUpdates >= 2 ? 55 : 30;
    signals.push({
      code: 'REVISIONES_INCREMENTALES',
      weight,
      severity: provenance.incrementalUpdates >= 2 ? 'HIGH' : 'MEDIUM',
      detail: `El archivo se reescribió ${String(provenance.incrementalUpdates)} vez/veces por encima de su versión original.`,
    });
  }

  if (provenance.hasAcroForm) {
    signals.push({
      code: 'FORMULARIO_EDITABLE',
      weight: 35,
      severity: 'MEDIUM',
      detail:
        'El PDF contiene campos de formulario rellenables. Un extracto emitido no se rellena.',
    });
  }

  const created = provenance.creationDate?.getTime();
  const modified = provenance.modificationDate?.getTime();
  if (created !== undefined && modified !== undefined && modified - created > MOD_DATE_GRACE_MS) {
    const days = Math.round((modified - created) / 86_400_000);
    signals.push({
      code: 'MODIFICADO_TRAS_LA_EMISION',
      weight: days >= 1 ? 45 : 25,
      severity: days >= 1 ? 'HIGH' : 'MEDIUM',
      detail: `El archivo se modificó ${days >= 1 ? `${String(days)} día(s)` : 'minutos'} después de haberse creado.`,
    });
  }

  if (!provenance.producer && !provenance.creator) {
    /*
     * Peso bajo a propósito. La ausencia del diccionario `/Info` es lo que hace
     * un limpiador de metadatos —señal de que alguien quiso borrar el rastro—
     * pero también lo que hacen algunos generadores minimalistas y lo que ocurre
     * cuando el diccionario viaja dentro de un flujo comprimido que aquí no se
     * lee. Acusar por una ausencia es exactamente lo que este módulo no hace.
     */
    signals.push({
      code: 'SIN_METADATOS_DE_ORIGEN',
      weight: 20,
      severity: 'LOW',
      detail:
        'El archivo no declara con qué se produjo. Puede ser un generador parco o un borrado de metadatos.',
    });
  }

  const isBrowserPrint = BROWSER_PRINT.some((pattern) => pattern.test(toolText));
  if (isBrowserPrint) {
    signals.push({
      code: 'IMPRESION_DESDE_NAVEGADOR',
      weight: 15,
      severity: 'LOW',
      detail:
        'El PDF lo generó un navegador al imprimir. El contenido lo pintó el banco, pero el archivo no es el que el banco emitió.',
    });
  }

  /*
   * Fuentes sin incrustar: sólo se mira cuando el documento TIENE texto, y sólo
   * cuando declara fuentes. Un PDF cuyo texto se pinta con las fuentes del
   * sistema del lector es lo que produce un editor de escritorio que reusa las
   * que tiene instaladas; un generador de informes incrusta las suyas para que
   * el documento se vea igual en cualquier equipo, que es justamente lo que un
   * banco necesita.
   */
  if (textPageRatio > 0 && provenance.nonStandardFonts > 0 && provenance.fontsEmbedded === 0) {
    signals.push({
      code: 'FUENTES_SIN_INCRUSTAR',
      weight: 25,
      severity: 'MEDIUM',
      detail:
        `El documento declara ${String(provenance.nonStandardFonts)} fuente(s) no estándar sin incrustarlas; ` +
        'el texto se pinta con las del equipo que lo abra, que es lo que ocurre al componerlo en un editor.',
    });
  }

  if (!authoring && REPORTING_TOOLS.some((pattern) => pattern.test(toolText))) {
    /*
     * No es una señal: es la retirada de una. Se representa con peso NEGATIVO
     * para que aparezca en la traza —quien audita un documento aceptado quiere
     * ver por qué se aceptó, no sólo la ausencia de motivos— y para que compense
     * las señales débiles que un generador institucional dispara por su forma de
     * escribir el archivo.
     */
    signals.push({
      code: 'GENERADOR_INSTITUCIONAL',
      weight: -25,
      severity: 'LOW',
      detail: `El archivo lo produjo un motor de informes (${toolText.trim()}), compatible con una emisión institucional.`,
    });
  }

  const critical = signals.some((signal) => signal.severity === 'CRITICAL');
  const additive = signals.reduce((total, signal) => total + signal.weight, 0);
  const suspicionScore = critical ? 100 : Math.max(0, Math.min(100, additive));

  return { provenance, signals, suspicionScore };
}

/** Lee el diccionario `/Info`, que es donde el generador deja su nombre. */
function readInfoDictionary(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['Producer', 'Creator', 'CreationDate', 'ModDate', 'Title', 'Author']) {
    const literal = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\()])*)\\)`).exec(raw);
    if (literal?.[1] !== undefined) {
      out[key] = decodePdfText(literal[1]);
      continue;
    }
    const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`).exec(raw);
    if (hex?.[1] !== undefined) out[key] = decodeHex(hex[1]);
  }
  return out;
}

function decodePdfText(value: string): string {
  const unescaped = value
    .replace(/\\([0-7]{1,3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)))
    .replace(/\\(.)/g, '$1');
  // UTF-16BE con marca de orden: lo escriben Word y varios editores.
  if (unescaped.charCodeAt(0) === 0xfe && unescaped.charCodeAt(1) === 0xff) {
    let out = '';
    for (let index = 2; index + 1 < unescaped.length; index += 2) {
      out += String.fromCharCode(
        (unescaped.charCodeAt(index) << 8) | unescaped.charCodeAt(index + 1),
      );
    }
    return out.trim();
  }
  return unescaped.trim();
}

function decodeHex(value: string): string {
  const digits = value.replace(/\s+/g, '');
  let out = '';
  for (let index = 0; index + 1 < digits.length; index += 2) {
    const code = parseInt(digits.slice(index, index + 2), 16);
    if (Number.isFinite(code) && code >= 32) out += String.fromCharCode(code);
  }
  return out.trim();
}

/** `D:20260415103000-04'00'` → `Date`. Devuelve `null` ante cualquier duda. */
function parsePdfDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match =
    /D?:?\s*(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+-Z])(\d{2})'?(\d{2})?)?/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const iso =
    `${year}-${month ?? '01'}-${day ?? '01'}T${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}` +
    (sign && sign !== 'Z'
      ? `${sign}${offsetHours ?? '00'}:${offsetMinutes ?? '00'}`
      : sign === 'Z'
        ? 'Z'
        : 'Z');
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countMatches(raw: string, pattern: RegExp): number {
  return [...raw.matchAll(pattern)].length;
}

/**
 * Las catorce fuentes estándar del formato, que ningún generador incrusta.
 *
 * El nombre puede venir con un prefijo de subconjunto (`ABCDEF+Helvetica`) y con
 * sufijos de estilo (`Helvetica-Bold`), así que se compara por la raíz.
 */
const STANDARD_FONTS = ['helvetica', 'times', 'courier', 'symbol', 'zapfdingbats', 'arial'];

function isStandardFont(baseFont: string): boolean {
  const root = baseFont
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[-,].*$/, '');
  return STANDARD_FONTS.some((standard) => root.startsWith(standard));
}

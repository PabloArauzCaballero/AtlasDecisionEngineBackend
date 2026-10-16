import { countMatches, isStandardFont, parsePdfDate, readInfoDictionary } from './pdf-parsing';
import { OVERLAY_ANNOTATIONS } from './tool-signatures';
import { PdfProvenance } from './types';

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

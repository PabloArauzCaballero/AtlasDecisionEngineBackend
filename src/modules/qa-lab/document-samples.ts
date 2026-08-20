import { BANK_STATEMENT_FIXTURES } from '../workers/bank-statement/fixtures/bank-statement-fixtures';

/**
 * Valores de ejemplo para las variables que llevan un DOCUMENTO.
 *
 * El generador de contrato sabe de tipos, y un documento viaja como `STRING`:
 * para él, `extracto_pdf_base64` es una cadena cualquiera y le asigna letras al
 * azar. El resultado es un caso que **no se puede ejecutar**: el worker recibe
 * «frocuzfzj», no consigue leer un PDF y la simulación termina en error sin que
 * se haya probado nada de la política. Eso es lo que hacía que los valores
 * generados parecieran basura, y lo eran para este uso.
 *
 * Aquí se rellena con un extracto sintético REAL —el mismo que usan los
 * escenarios del worker— para que el caso recorra el algoritmo de punta a punta.
 *
 * ## Por qué se reconoce por el nombre de la variable
 *
 * El catálogo de tipos no tiene `FILE` ni `DOCUMENT`: un PDF se declara como
 * texto en base64. Así que «esta variable lleva un documento» no se puede leer
 * del `dataType`. El criterio es estrecho a propósito —`pdf` o `base64` como
 * palabra del código, y tipo textual— para no confundir un `pdf_paginas`
 * entero, que es un recuento. El día que el contrato declare un tipo para
 * documentos, esto se sustituye por esa comprobación y nada más cambia.
 *
 * El frontend aplica el mismo criterio en `features/simulator/document-input.ts`
 * para decidir cuándo ofrecer «subir PDF»; que coincidan no es casualidad, es la
 * misma pregunta hecha desde los dos lados.
 */

const DOCUMENT_CODE = /(^|_)(pdf|base64)(_|$)/i;
const FILE_NAME_CODE = /(^|_)(nombre_archivo|filename|file_name|archivo)(_|$)/i;
const TEXTUAL = new Set(['STRING', 'LONG_TEXT', 'TEXT', 'CODE', 'IDENTIFIER']);

/**
 * Extracto sintético que se entrega como documento de ejemplo.
 *
 * El «mínimo»: una institución reconocida y dos movimientos que cuadran. Es el
 * camino feliz, que es lo que se quiere de un valor VÁLIDO; los escenarios que
 * fallan a propósito ya se piden por su nombre en la vista del worker.
 *
 * Se construye una sola vez: el PDF es determinista y volver a armarlo por cada
 * caso de un lote de veinte no cambiaría el resultado.
 */
let cachedPdf: string | null = null;

function samplePdfBase64(): string {
  if (cachedPdf === null) {
    const fixture =
      BANK_STATEMENT_FIXTURES.find((entry) => entry.code === 'valid-basic') ??
      BANK_STATEMENT_FIXTURES[0];
    cachedPdf = fixture.build().toString('base64');
  }
  return cachedPdf;
}

function sampleFileName(): string {
  const fixture =
    BANK_STATEMENT_FIXTURES.find((entry) => entry.code === 'valid-basic') ??
    BANK_STATEMENT_FIXTURES[0];
  return fixture.fileName;
}

function isTextual(dataType: string): boolean {
  return TEXTUAL.has(dataType.trim().toUpperCase());
}

/**
 * Valor de ejemplo para una variable documental, o `null` si no lo es.
 *
 * Devolver `null` es lo que deja intacto al generador por contrato para todo lo
 * demás: esto no sustituye su criterio, sólo cubre el hueco que el tipo de dato
 * no alcanza a describir.
 */
export function documentSampleValue(code: string, dataType: string): string | null {
  if (!isTextual(dataType)) return null;
  if (DOCUMENT_CODE.test(code)) return samplePdfBase64();
  if (FILE_NAME_CODE.test(code)) return sampleFileName();
  return null;
}

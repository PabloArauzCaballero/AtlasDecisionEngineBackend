/**
 * MIDE la detección de fraude documental sobre un escenario del catálogo.
 *
 * ## Para qué existe
 *
 * Los umbrales de `core/forensics/` no son opiniones: son cortes, y un corte sin una medición
 * detrás es una superstición. Este comando es el instrumento con el que se toman esas medidas, y
 * está aquí —y no en una prueba— porque su salida es un NÚMERO que hay que leer, no una aserción
 * que hay que satisfacer. La misma distinción que ya hacían `medir-resolucion-identidad.ts` y
 * `calibrar-identidad.mjs`.
 *
 * Es lo que hay que correr antes de mover cualquiera de estos valores:
 *
 *   IDENTITY_FRAUD_TEMPLATE_COVERAGE_MIN
 *   IDENTITY_FRAUD_REVIEW_RISK
 *   IDENTITY_FRAUD_SUSPICION_RISK
 *   IDENTITY_FRAUD_SEMANTIC_FLOOR / _MARGIN
 *
 * ## Cómo se usa
 *
 *   yarn ts-node scripts/medir-fraude-identidad.ts [escenario]
 *
 * Sin argumento recorre TODOS los escenarios del catálogo, que es la forma útil de usarlo: lo que
 * interesa no es el número de un caso sino la SEPARACIÓN entre los casos buenos y los malos. Un
 * umbral se pone donde esa separación es más ancha, y para verla hacen falta los dos lados.
 *
 * ## Lo que NO mide
 *
 * Fotos reales de cédulas reales. Este repositorio no debe guardarlas —una cédula de verdad es el
 * dato con el que se suplanta a una persona— así que lo que hay aquí son ejemplares sintéticos
 * dibujados contra la especificación del catálogo. Sirven para comprobar que el análisis no acusa a
 * un documento bien formado, y NO sirven para calibrar el análisis de píxeles: una tarjeta que
 * dibujamos no pasó por ningún sensor. Para eso hace falta un corpus real, medido fuera.
 */

import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import {
  IDENTITY_FIXTURES,
  buildIdentityFixtureImages,
  findIdentityFixture,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import { parseMrzTd1 } from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';
import { analizarPlantilla } from '../src/modules/workers/identity-verification/core/forensics/template-conformance';
import { analizarManipulacion } from '../src/modules/workers/identity-verification/core/forensics/image-tamper.analyzer';
import { evaluarFraude } from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';

async function medir(code: string, ocr: TesseractOcrAdapter, images: SharpImageAdapter) {
  const fixture = findIdentityFixture(code);
  if (!fixture) throw new Error(`escenario inexistente: ${code}`);

  const imagenes = await buildIdentityFixtureImages(fixture);
  const documento = await images.normalize(imagenes.document);
  const reverso = imagenes.documentBack ? (await images.normalize(imagenes.documentBack)).buffer : null;
  const encuadre = await images.frame(documento.buffer);

  const anverso = await ocr.extract({ image: encuadre.buffer, correlationId: 'medicion' });
  const dorso = reverso ? await ocr.extract({ image: reverso, correlationId: 'medicion' }) : null;

  const parser = new BoliviaCiDocumentParser();
  const analizado = await parser.parse({
    ocr: dorso
      ? { ...anverso, rawText: `${anverso.rawText}\n${dorso.rawText}`, lines: [...anverso.lines, ...dorso.lines] }
      : anverso,
    context: { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' },
  });

  const plantilla = analizarPlantilla({
    textoAnverso: anverso.rawText,
    textoReverso: dorso?.rawText ?? '',
    campos: analizado.fields,
    mrz: parseMrzTd1(`${anverso.rawText}\n${dorso?.rawText ?? ''}`),
    ahora: new Date(),
  });

  const manipulacion = await analizarManipulacion(documento.buffer);

  /*
   * El codificador se declara AUSENTE a propósito.
   *
   * Este comando corre en local y no debe exigir un servidor de embeddings levantado: lo que mide
   * son las dos familias deterministas, que son las que se calibran contra los escenarios. La
   * conformidad semántica se calibra contra el MODELO, con `scripts/semantic-calibration.mjs`, que
   * es otro instrumento y otra población.
   */
  const evaluacion = evaluarFraude({
    plantilla,
    semantica: {
      disponible: false,
      conformidad: null,
      mejorPositiva: null,
      mejorNegativa: null,
      margen: null,
      contradicho: false,
      modelo: null,
      indisponibilidad: 'NOT_MEASURED_HERE',
    },
    manipulacion,
    // Los escenarios del catálogo SON entradas fabricadas, y decirlo aquí es lo que hace que la
    // medición se lea igual que en producción sobre un escenario.
    entradaGenerada: true,
    umbrales: {
      coberturaMinima: IDENTITY_DEFAULTS.fraudTemplateCoverageMin,
      riesgoDeRevision: IDENTITY_DEFAULTS.fraudReviewRisk,
      riesgoDeSospecha: IDENTITY_DEFAULTS.fraudSuspicionRisk,
      estricto: false,
    },
  });

  return {
    escenario: code,
    generacion: plantilla.mejor.generacion,
    cobertura: plantilla.mejor.cobertura,
    obligatoriosAusentes: plantilla.mejor.obligatoriosAusentes,
    incoherencias: plantilla.incoherencias.map((fallo) => fallo.codigo),
    marcas: plantilla.marcasDeFalsificacion,
    pixeles: manipulacion.medidas,
    senalesDePixeles: manipulacion.senales.map((senal) => senal.codigo),
    riesgo: evaluacion.riesgo,
    veredicto: evaluacion.veredicto,
  };
}

async function main(): Promise<void> {
  const ocr = new TesseractOcrAdapter();
  const images = new SharpImageAdapter(IDENTITY_DEFAULTS);
  const pedido = process.argv[2];
  const codigos = pedido ? [pedido] : IDENTITY_FIXTURES.map((fixture) => fixture.code);

  const filas: Array<Record<string, unknown>> = [];
  for (const code of codigos) {
    try {
      filas.push(await medir(code, ocr, images));
    } catch (error) {
      // Un escenario que no se puede medir NO detiene la tanda: la tabla es lo que se lee, y una
      // fila menos con su motivo es mejor que ninguna tabla.
      filas.push({ escenario: code, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(filas, null, 2));
  await ocr.onModuleDestroy();
}

void main();

/**
 * DIAGNOSTICA un directorio de carnets reales, carpeta por carpeta.
 *
 *   yarn ts-node scripts/diagnosticar-carnets.ts ~/Desktop/carnets
 *
 * Cada subdirectorio es una PERSONA con sus dos caras. Empareja por contenido y
 * no por nombre de archivo —las fotos llegan de WhatsApp con nombres que no
 * dicen qué cara son— y publica, para cada una, lo que el pipeline sacaría.
 *
 * No copia, no mueve y no escribe NADA dentro del directorio de entrada, y no
 * deja rastro en el repositorio. Sólo lee.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { HeuristicDocumentClassifierAdapter } from '../src/modules/workers/identity-verification/core/adapters/local-providers.adapter';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import { reconocerCedulaBoliviana } from '../src/modules/workers/identity-verification/core/catalog/bolivia-ci.recognizer';
import { medirEvidenciaDeIdentidad } from '../src/modules/workers/identity-verification/core/engine/identity-evidence';
import { parseMrzTd1 } from '../src/modules/workers/identity-verification/core/parsers/mrz-td1';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import { analizarPlantilla } from '../src/modules/workers/identity-verification/core/forensics/template-conformance';
import { analizarManipulacion } from '../src/modules/workers/identity-verification/core/forensics/image-tamper.analyzer';
import { evaluarFraude } from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';
import { UMBRALES_DE_FRAUDE_POR_DEFECTO } from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';
import type { DocumentOcrResult } from '../src/modules/workers/identity-verification/core/ports/identity.ports';

const IMAGENES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

const imagenes = new SharpImageAdapter(IDENTITY_DEFAULTS);
const ocr = new TesseractOcrAdapter();
const clasificador = new HeuristicDocumentClassifierAdapter();
const parser = new BoliviaCiDocumentParser();

/** Sin servidor de embeddings: la prueba no se ejecuta y se declara ausente. */
const SIN_SEMANTICA = {
  disponible: false as const,
  conformidad: null,
  mejorPositiva: null,
  mejorNegativa: null,
  margen: null,
  contradicho: false,
  modelo: null,
  indisponibilidad: 'SIN_CODIFICADOR',
};

async function leer(buffer: Buffer, lado: number): Promise<DocumentOcrResult> {
  const reducida = await imagenes.downscale(buffer, lado);
  return ocr.extract({ image: reducida, correlationId: 'diagnostico' });
}

function cobertura(anverso: string, reverso: string): number {
  return reconocerCedulaBoliviana({ textoAnverso: anverso, textoReverso: reverso }).mejor.cobertura;
}

async function main(): Promise<void> {
  const raiz = resolve(process.argv[2] ?? '');
  if (!raiz || !statSync(raiz).isDirectory()) {
    console.error('Uso: yarn ts-node scripts/diagnosticar-carnets.ts <directorio>');
    process.exit(1);
  }

  const personas = readdirSync(raiz)
    .filter((n) => !n.startsWith('.'))
    .map((n) => join(raiz, n))
    .filter((r) => statSync(r).isDirectory());

  for (const carpeta of personas) {
    const archivos = readdirSync(carpeta)
      .filter((n) => !n.startsWith('.') && IMAGENES.has(extname(n).toLowerCase()))
      .map((n) => join(carpeta, n))
      .sort();

    console.log(`\n${'='.repeat(78)}\n${basename(carpeta)}  (${archivos.length} imágenes)\n${'='.repeat(78)}`);

    // Qué cara es cada archivo: gana la que más plantilla de ANVERSO reconozca.
    const caras: Array<{ ruta: string; buffer: Buffer; texto: string; anversoScore: number }> = [];
    for (const ruta of archivos) {
      const original = readFileSync(ruta);
      const norm = await imagenes.normalize(original);
      const enc = await imagenes.frame(norm.buffer);
      const fina = await leer(enc.buffer, IDENTITY_DEFAULTS.ocrFineLongEdge);
      caras.push({
        ruta,
        buffer: original,
        texto: fina.rawText,
        anversoScore: cobertura(fina.rawText, ''),
      });
      console.log(
        `  ${basename(ruta).padEnd(46)} ${String(norm.quality.width).padStart(5)}x${String(norm.quality.height).padEnd(5)}` +
          ` recortado=${String(enc.recortado).padEnd(5)} área=${enc.areaConservada.toFixed(3)}` +
          ` cobertura=${cobertura(fina.rawText, '').toFixed(3)}`,
      );
    }

    caras.sort((a, b) => b.anversoScore - a.anversoScore);
    const anverso = caras[0];
    const reverso = caras[1] ?? null;

    const norm = await imagenes.normalize(anverso.buffer);
    const enc = await imagenes.frame(norm.buffer);
    const front = await leer(enc.buffer, IDENTITY_DEFAULTS.ocrFineLongEdge);
    let back: DocumentOcrResult | null = null;
    if (reverso) {
      const nb = await imagenes.normalize(reverso.buffer);
      back = await leer(nb.buffer, IDENTITY_DEFAULTS.ocrFineLongEdge);
    }

    const combinado: DocumentOcrResult = {
      rawText: `${front.rawText}\n${back?.rawText ?? ''}`,
      lines: [...front.lines, ...(back?.lines ?? [])],
      provider: 'tesseract',
    };

    const clas = await clasificador.classify({
      rawText: combinado.rawText,
      frontText: front.rawText,
      backText: back?.rawText ?? '',
      documentCountry: 'BO',
    });
    const rec = reconocerCedulaBoliviana({
      textoAnverso: front.rawText,
      textoReverso: back?.rawText ?? '',
    });
    const ev = medirEvidenciaDeIdentidad({
      texto: combinado.rawText,
      anchoLargo: Math.max(norm.quality.width, norm.quality.height),
      ladoCorto: Math.min(norm.quality.width, norm.quality.height),
    });
    const mrz = parseMrzTd1(combinado.rawText);
    const parsed = await parser.parse({
      ocr: combinado,
      context: { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' },
    });

    console.log(`\n  anverso: ${basename(anverso.ruta)}${reverso ? `   reverso: ${basename(reverso.ruta)}` : '   (sin reverso)'}`);
    console.log(`  clasificación : ${clas.type}  conf=${clas.confidence.toFixed(3)}  señales=[${clas.signals.join(', ')}]`);
    console.log(`  generación    : ${rec.mejor.generacion}  cobertura=${rec.mejor.cobertura.toFixed(3)}`);
    console.log(`  evidencia     : ${ev.confidence.toFixed(3)}  contra=${ev.contraindicator ?? '—'}`);
    console.log(`  MRZ           : ${mrz ? `sí  checks=${JSON.stringify(mrz.checks)}` : 'no'}`);
    const f = parsed.fields;
    const campo = (n: string, v: { value: string | null; source?: string } | undefined) =>
      `    ${n.padEnd(16)} ${String(v?.value ?? '—').padEnd(40)} [${v?.source ?? '—'}]`;
    console.log('  CAMPOS:');
    console.log(campo('documentNumber', f.documentNumber));
    console.log(campo('fullName', f.fullName));
    console.log(campo('firstNames', f.firstNames));
    console.log(campo('lastNames', f.lastNames));
    console.log(campo('dateOfBirth', f.dateOfBirth));
    console.log(campo('issueDate', f.issueDate));
    console.log(campo('expirationDate', f.expirationDate));
    console.log(campo('placeOfBirth', f.placeOfBirth));
    console.log(`  AVISOS: ${parsed.warnings.length ? parsed.warnings.join(', ') : '—'}`);

    const plantilla = analizarPlantilla({
      textoAnverso: front.rawText,
      textoReverso: back?.rawText ?? '',
      campos: parsed.fields,
      mrz,
      ahora: new Date(),
    });
    const manipulacion = await analizarManipulacion(enc.buffer);
    const fraude = evaluarFraude({
      plantilla,
      semantica: SIN_SEMANTICA,
      manipulacion,
      umbrales: UMBRALES_DE_FRAUDE_POR_DEFECTO,
    });
    console.log(
      `  FRAUDE        : ${fraude.veredicto}  riesgo=${fraude.riesgo.toFixed(3)}` +
        `  motivos=[${fraude.motivos.join(', ') || '—'}]`,
    );
    console.log(
      `  incoherencias : ${plantilla.incoherencias.map((i) => `${i.codigo}(${i.peso})`).join(', ') || '—'}`,
    );
    console.log(
      `  pixeles       : ${manipulacion.senales.map((s) => s.codigo).join(', ') || '—'}` +
        `  ${JSON.stringify(manipulacion.medidas)}`,
    );
    console.log('\n  --- texto ANVERSO -------------------------------------------------------');
    console.log(front.rawText.split('\n').filter((l) => l.trim()).map((l) => `  | ${l}`).join('\n'));
    if (back) {
      console.log('  --- texto REVERSO -------------------------------------------------------');
      console.log(back.rawText.split('\n').filter((l) => l.trim()).map((l) => `  | ${l}`).join('\n'));
    }
  }

  await ocr.onModuleDestroy();
}

void main();

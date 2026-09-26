/* eslint-disable no-console */
/**
 * ¿A partir de qué resolución deja de poderse leer un documento — de verdad?
 *
 * Existe porque el gate de calidad rechazaba fotos de cédula legibles con
 * `IDENTITY_DOCUMENT_BLURRY`, y el umbral que las rechazaba —un puntaje mezclado,
 * con la resolución medida contra un megapíxel— no salía de ninguna medición:
 * salía de una fórmula.
 *
 * Baja la misma cédula sintética a una escalera de anchos y ejecuta el pipeline
 * ENTERO sobre cada peldaño, **con el gate apagado**, que es la única forma de
 * saber dónde está el límite real: con el gate puesto, lo único que se mide es
 * dónde está el gate.
 *
 *   npx ts-node -P tsconfig.json -T scripts/medir-resolucion-identidad.ts
 */
import sharp from 'sharp';
import { HeuristicDocumentClassifierAdapter } from '../src/modules/workers/identity-verification/core/adapters/local-providers.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanFaceMatchAdapter,
  HumanLivenessAdapter,
} from '../src/modules/workers/identity-verification/core/adapters/human-face.adapter';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { IdentityDomainError } from '../src/modules/workers/identity-verification/core/domain/identity-domain.error';
import { ImageQualityAssessmentService } from '../src/modules/workers/identity-verification/core/image-quality-assessment.service';
import {
  IDENTITY_DEFAULTS,
  type IdentityOptions,
} from '../src/modules/workers/identity-verification/core/identity-options';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import {
  GenericDocumentParser,
  PassportDocumentParser,
} from '../src/modules/workers/identity-verification/core/parsers/document-parser';
import { DocumentParserRegistry } from '../src/modules/workers/identity-verification/core/parsers/document-parser.registry';
import {
  buildIdentityFixtureImages,
  findIdentityFixture,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { IdentityPipelineService } from '../src/modules/workers/identity-verification/identity-pipeline.service';

const CALIBRADO = {
  matchThreshold: 0.8824,
  reviewThreshold: 0.7789,
  thresholdProfileVersion: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
};

/** Sin gate: lo que se quiere medir es la LECTURA, no el umbral. */
const SIN_GATE: IdentityOptions = {
  ...IDENTITY_DEFAULTS,
  ...CALIBRADO,
  minDocumentQuality: 0,
  minSelfieQuality: 0,
  minFaceAreaRatio: 0,
};

const ocr = new TesseractOcrAdapter();

function build(options: IdentityOptions): IdentityPipelineService {
  return new IdentityPipelineService(
    options,
    new SharpImageAdapter(options),
    ocr,
    new HeuristicDocumentClassifierAdapter(),
    new HumanFaceDetectorAdapter(options),
    new HumanFaceMatchAdapter(options),
    new HumanLivenessAdapter(options),
    new DocumentParserRegistry(
      new BoliviaCiDocumentParser(),
      new PassportDocumentParser(),
      new GenericDocumentParser(),
    ),
    new ImageQualityAssessmentService(options),
  );
}

/** Reduce a un ancho dado, sin ampliar nunca. Es lo que hace un mensajero. */
async function aAncho(imagen: Buffer, ancho: number): Promise<Buffer> {
  return sharp(imagen).resize({ width: ancho, withoutEnlargement: true }).png().toBuffer();
}

interface Fila {
  etiqueta: string;
  puntaje: number;
  avisos: string;
  desenlace: string;
  numero: string;
  nombre: string;
  parecido: string;
}

function imprimir(titulo: string, filas: Fila[]): void {
  console.log(`\n### ${titulo}`);
  console.log(
    ['tamaño', 'puntaje', 'avisos', 'desenlace', 'nº doc', 'nombre', 'parecido'].join(' | '),
  );
  for (const f of filas) {
    console.log(
      [
        f.etiqueta,
        f.puntaje.toFixed(3),
        f.avisos,
        f.desenlace,
        f.numero,
        f.nombre,
        f.parecido,
      ].join(' | '),
    );
  }
}

async function main(): Promise<void> {
  const fixture = findIdentityFixture('identidad-aprobada');
  if (!fixture) throw new Error('falta el escenario limpio');
  const nativo = await buildIdentityFixtureImages(fixture);
  const meta = await sharp(nativo.document).metadata();
  const metaSelfie = await sharp(nativo.selfie).metadata();
  console.log(
    `cédula nativa: ${meta.width}x${meta.height} · selfie nativa: ${metaSelfie.width}x${metaSelfie.height}`,
  );

  const pipeline = build(SIN_GATE);
  const medidor = new SharpImageAdapter(SIN_GATE);

  // --- Escalera del DOCUMENTO, con la selfie siempre nativa ---------------
  const docFilas: Fila[] = [];
  for (const ancho of [1800, 1400, 1100, 900, 700, 560, 450, 360, 280, 220, 160]) {
    const documento = await aAncho(nativo.document, ancho);
    const reverso = nativo.documentBack ? await aAncho(nativo.documentBack, ancho) : null;
    const d = await sharp(documento).metadata();
    const medida = await medidor.assess(documento);
    const fila: Fila = {
      etiqueta: `${d.width}x${d.height}`,
      puntaje: medida.score,
      avisos: medida.warnings.join(',') || '—',
      desenlace: '',
      numero: '',
      nombre: '',
      parecido: '',
    };
    try {
      const outcome = await pipeline.run({
        documentImage: documento,
        documentBackImage: reverso,
        selfieImage: nativo.selfie,
        documentCountry: 'BO',
        correlationId: `doc-${ancho}`,
        entradaGenerada: true,
      });
      fila.desenlace = `${outcome.decision}${outcome.reasonCodes.length ? ` (${outcome.reasonCodes.join(',')})` : ''}`;
      fila.numero = outcome.fields.documentNumber?.value ?? '—';
      fila.nombre = outcome.fields.fullName?.value ?? '—';
      fila.parecido = outcome.faceMatch ? outcome.faceMatch.similarityScore.toFixed(4) : '—';
    } catch (error) {
      fila.desenlace =
        error instanceof IdentityDomainError
          ? `✗ ${error.code}`
          : `✗ ${(error as Error).message.slice(0, 70)}`;
    }
    docFilas.push(fila);
  }
  imprimir('DOCUMENTO (selfie nativa, gate apagado)', docFilas);

  // --- Escalera de la SELFIE, con el documento siempre nativo --------------
  const selfieFilas: Fila[] = [];
  for (const ancho of [720, 480, 360, 240, 160, 122, 96]) {
    const selfie = await aAncho(nativo.selfie, ancho);
    const s = await sharp(selfie).metadata();
    const medida = await medidor.assess(selfie);
    const fila: Fila = {
      etiqueta: `${s.width}x${s.height}`,
      puntaje: medida.score,
      avisos: medida.warnings.join(',') || '—',
      desenlace: '',
      numero: '',
      nombre: '',
      parecido: '',
    };
    try {
      const outcome = await pipeline.run({
        documentImage: nativo.document,
        documentBackImage: nativo.documentBack,
        selfieImage: selfie,
        documentCountry: 'BO',
        correlationId: `selfie-${ancho}`,
        entradaGenerada: true,
      });
      fila.desenlace = `${outcome.decision}${outcome.reasonCodes.length ? ` (${outcome.reasonCodes.join(',')})` : ''}`;
      fila.numero = outcome.fields.documentNumber?.value ?? '—';
      fila.nombre = outcome.fields.fullName?.value ?? '—';
      fila.parecido = outcome.faceMatch ? outcome.faceMatch.similarityScore.toFixed(4) : '—';
    } catch (error) {
      fila.desenlace =
        error instanceof IdentityDomainError
          ? `✗ ${error.code}`
          : `✗ ${(error as Error).message.slice(0, 70)}`;
    }
    selfieFilas.push(fila);
  }
  imprimir('SELFIE (documento nativo, gate apagado)', selfieFilas);

  await ocr.onModuleDestroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

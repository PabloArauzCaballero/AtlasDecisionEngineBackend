/* eslint-disable no-console */
/**
 * El caso que se reportó, reproducido con los ajustes DE PRODUCCIÓN.
 *
 * Alguien subió a la consola tres imágenes de las que devuelve un buscador —el
 * anverso y el reverso de una cédula a ~445×282 y una selfie recortada a
 * 122×146, todas JPEG ya recomprimido— y el motor contestó
 * `IDENTITY_DOCUMENT_BLURRY`: «la imagen es demasiado pequeña para leer el
 * documento». No lo era; simplemente nunca se intentó leerla.
 *
 * Esto rehace esa entrada tan de cerca como se puede sin guardar la foto de
 * nadie: la cédula sintética bajada a ese tamaño y vuelta a comprimir en JPEG de
 * calidad 60, que es lo que añade una miniatura de la web frente a un
 * remuestreo limpio. Corre con `IDENTITY_DEFAULTS`, sin apagar ningún gate: lo
 * que sale de aquí es lo que sacaría el despliegue.
 *
 *   npx ts-node -P tsconfig.json -T scripts/verificar-miniaturas-identidad.ts
 */
import { readFileSync } from 'node:fs';
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

/** Los ajustes de un despliegue calibrado. Ningún gate apagado. */
const OPTIONS: IdentityOptions = {
  ...IDENTITY_DEFAULTS,
  matchThreshold: 0.8824,
  reviewThreshold: 0.7789,
  thresholdProfileVersion: 'sintetico-60x3-fmr1e-3-fnmr1e-2',
};

const ocr = new TesseractOcrAdapter();

function build(): IdentityPipelineService {
  return new IdentityPipelineService(
    OPTIONS,
    new SharpImageAdapter(OPTIONS),
    ocr,
    new HeuristicDocumentClassifierAdapter(),
    new HumanFaceDetectorAdapter(OPTIONS),
    new HumanFaceMatchAdapter(OPTIONS),
    new HumanLivenessAdapter(OPTIONS),
    new DocumentParserRegistry(
      new BoliviaCiDocumentParser(),
      new PassportDocumentParser(),
      new GenericDocumentParser(),
    ),
    new ImageQualityAssessmentService(OPTIONS),
  );
}

/**
 * Miniatura como la de un buscador: se baja POR ANCHO —conservando la
 * proporción, que es lo que hace cualquier miniaturizador— y se recomprime.
 */
async function miniatura(imagen: Buffer, ancho: number): Promise<Buffer> {
  return sharp(imagen).resize({ width: ancho }).jpeg({ quality: 60 }).toBuffer();
}

/**
 * El mismo caso, pero SUBIENDO los archivos al motor que está corriendo.
 *
 * Con `--motor`. El pipeline en proceso demuestra que la lógica lee la
 * miniatura; esto demuestra que lo hace el binario que está desplegado, por el
 * camino que recorre una persona: `multipart/form-data`, cola, worker y
 * veredicto consultable. Son dos afirmaciones distintas y la segunda es la que
 * le importa a quien abre el portal.
 */
async function contraElMotor(
  documento: Buffer,
  reverso: Buffer | null,
  selfie: Buffer,
): Promise<void> {
  for (const linea of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
  const apiKey = process.env.MANAGEMENT_API_KEY;
  if (!apiKey) throw new Error('falta MANAGEMENT_API_KEY');
  const headers = { 'x-api-key': apiKey, 'x-tenant-id': process.env.BOOTSTRAP_TENANT_ID ?? '1' };

  const form = new FormData();
  form.append('document', new Blob([documento], { type: 'image/jpeg' }), 'anverso.jpg');
  if (reverso)
    form.append('documentBack', new Blob([reverso], { type: 'image/jpeg' }), 'reverso.jpg');
  form.append('selfie', new Blob([selfie], { type: 'image/jpeg' }), 'selfie.jpg');
  // Sin esto, reenviar las mismas fotos devuelve la ejecución anterior — que es
  // lo correcto por omisión y aquí taparía justo lo que se quiere comprobar.
  form.append('idempotencyKey', `miniaturas-${process.pid}-${process.hrtime.bigint()}`);

  console.log(`\nSubiendo al motor en ${base} …\n`);
  const creada = await fetch(`${base}/v1/workers/identity-verification/runs`, {
    method: 'POST',
    headers,
    body: form,
  });
  const creado = (await creada.json()) as { requestId?: string; message?: string };
  if (!creada.ok)
    throw new Error(`el motor rechazó la subida (${creada.status}): ${JSON.stringify(creado)}`);
  console.log(`ejecución encolada: ${creado.requestId}`);

  for (let intento = 0; intento < 120; intento += 1) {
    await new Promise((r) => setTimeout(r, 2_000));
    const res = await fetch(`${base}/v1/workers/identity-verification/runs/${creado.requestId}`, {
      headers,
    });
    const run = (await res.json()) as {
      status?: string;
      errorCode?: string;
      errorMessage?: string;
      result?: Record<string, unknown>;
    };
    // Los CUATRO estados terminales. Esperar sólo `SUCCEEDED` deja la espera
    // corriendo sobre una ejecución que ya terminó: la primera versión de esto
    // agotó cuatro minutos sobre un veredicto que estuvo listo en ocho segundos,
    // porque un resultado con avisos se marca `SUCCEEDED_WITH_WARNINGS`.
    if (
      ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'].includes(run.status ?? '')
    ) {
      console.log(`estado    : ${run.status}`);
      if (run.errorCode) console.log(`error     : ${run.errorCode} — ${run.errorMessage}`);
      if (run.result) console.log(`veredicto :\n${JSON.stringify(run.result, null, 2)}`);
      if (run.status === 'FAILED') process.exitCode = 1;
      return;
    }
  }
  throw new Error('la ejecución no terminó en 4 minutos');
}

async function main(): Promise<void> {
  const fixture = findIdentityFixture('identidad-aprobada');
  if (!fixture) throw new Error('falta el escenario limpio');
  const nativo = await buildIdentityFixtureImages(fixture);

  // Los tamaños del caso reportado: anverso 439 px, reverso 450 px, selfie 122.
  const documento = await miniatura(nativo.document, 439);
  const reverso = nativo.documentBack ? await miniatura(nativo.documentBack, 450) : null;
  const selfie = await miniatura(nativo.selfie, 122);

  for (const [nombre, buffer] of [
    ['anverso', documento],
    ['reverso', reverso],
    ['selfie', selfie],
  ] as const) {
    if (!buffer) continue;
    const m = await sharp(buffer).metadata();
    console.log(
      `${nombre}: ${m.width}x${m.height} JPEG q60, ${(buffer.length / 1024).toFixed(1)} KiB`,
    );
  }

  if (process.argv.includes('--motor')) {
    await contraElMotor(documento, reverso, selfie);
    await ocr.onModuleDestroy();
    return;
  }

  console.log('\nEjecutando con IDENTITY_DEFAULTS (ningún gate apagado)…\n');
  try {
    const outcome = await build().run({
      documentImage: documento,
      documentBackImage: reverso,
      selfieImage: selfie,
      documentCountry: 'BO',
      correlationId: 'reproduccion-miniaturas',
      entradaGenerada: true,
    });
    console.log(`veredicto           : ${outcome.decision}`);
    console.log(`motivos             : ${outcome.reasonCodes.join(', ') || '(ninguno)'}`);
    console.log(`tipo de documento   : ${outcome.documentType}`);
    console.log(`número              : ${outcome.fields.documentNumber?.value ?? '—'}`);
    console.log(`nombre              : ${outcome.fields.fullName?.value ?? '—'}`);
    console.log(`nacimiento          : ${outcome.fields.dateOfBirth?.value ?? '—'}`);
    console.log(`caducidad           : ${outcome.fields.expirationDate?.value ?? '—'}`);
    console.log(
      `parecido            : ${outcome.faceMatch?.similarityScore?.toFixed(4) ?? '—'} (comparable: ${outcome.faceMatch?.comparable})`,
    );
    console.log(
      `calidad documento   : ${outcome.quality.document.score.toFixed(3)} [${outcome.quality.document.warnings.join(', ') || '—'}]`,
    );
    console.log(
      `calidad selfie      : ${outcome.quality.selfie.score.toFixed(3)} [${outcome.quality.selfie.warnings.join(', ') || '—'}]`,
    );
    console.log(`marcas de riesgo    : ${outcome.riskFlags.join(', ') || '(ninguna)'}`);
  } catch (error) {
    if (error instanceof IdentityDomainError) {
      console.log(`RECHAZADO: ${error.code}\n${error.message}`);
    } else {
      console.log(`ERROR: ${(error as Error).message}`);
    }
    process.exitCode = 1;
  }

  await ocr.onModuleDestroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

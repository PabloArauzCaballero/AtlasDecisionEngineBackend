#!/usr/bin/env node
/**
 * Busca la persona cuyo parecido con el titular caiga ENTRE los dos umbrales,
 * midiéndolo por el mismo camino que recorre una verificación.
 *
 * Existe por una consecuencia directa de que la biometría sea real: el escenario
 * «parecido ambiguo» ya no puede declarar un 0,78 y que el comparador obedezca.
 * El parecido se mide, así que para enseñar la franja que va a revisión humana
 * hay que ENCONTRAR una pareja que caiga en ella.
 *
 * Y se mide DONDE importa. Comparar los dos retratos sueltos daba 0,805 y el
 * escenario terminaba en 0,724: entre una cosa y otra está el retrato impreso a
 * 290×360 dentro de la tarjeta, el remuestreo de la foto entera y el recorte con
 * margen. Ocho centésimas, suficientes para sacar la pareja de la franja para la
 * que se eligió. Así que aquí se arma la cédula, se detecta el rostro sobre ella
 * y se recorta igual que en la etapa 4 del pipeline.
 *
 * Hay que volver a correrlo cada vez que se recalibren los umbrales.
 *
 *   yarn build && node scripts/buscar-pareja-ambigua.mjs 0.7789 0.8824
 */

import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compilado = path.join(raiz, 'dist', 'modules', 'workers', 'identity-verification');
const mod = (...p) => import(pathToFileURL(path.join(compilado, ...p)).href);

const REVISION = Number(process.argv[2] ?? 0.7789);
const APROBACION = Number(process.argv[3] ?? 0.8824);
const CANDIDATAS = Number(process.env.CANDIDATAS ?? 60);
/** El titular de los escenarios: la pareja se busca CONTRA él. */
const TITULAR = Number(process.env.TITULAR ?? 7);
/**
 * Qué TOMA de la candidata se compara. Tiene que ser la misma que dibuje el
 * escenario (`varianteDe` en `identity-fixtures.ts`): cada toma tiene su giro,
 * su luz y su compresión, y con ellos su propio parecido.
 */
const VARIANTE = Number(process.env.VARIANTE ?? 2);

const DATOS = {
  numero: '7654321',
  serie: '21333',
  seccion: '11222',
  nombres: 'MARIA RENEE',
  apellidos: 'RODRIGUEZ GONZALEZ',
  nacimiento: '05/04/2003',
  nacimientoIso: '2003-04-05',
  emision: '01/11/2023',
  expiracion: '01/11/2028',
  expiracionIso: '2028-11-01',
  sexo: 'F',
  lugarNacimiento: 'SANTA CRUZ',
  domicilio: 'C. SANCHEZ LIMA NO.2520',
  profesion: 'ESTUDIANTE',
  estadoCivil: 'SOLTERA',
  grupoSanguineo: 'A RH +',
  rostro: TITULAR,
};

async function main() {
  const { SharpImageAdapter } = await mod('core', 'adapters', 'sharp-image.adapter.js');
  const { HumanFaceDetectorAdapter, HumanFaceMatchAdapter } = await mod(
    'core',
    'adapters',
    'human-face.adapter.js',
  );
  const { IDENTITY_DEFAULTS } = await mod('core', 'identity-options.js');
  const { renderCedula, renderSelfie } = await mod('fixtures', 'identity-card.js');

  const opciones = {
    ...IDENTITY_DEFAULTS,
    matchThreshold: APROBACION,
    reviewThreshold: REVISION,
  };
  const imagenes = new SharpImageAdapter(opciones);
  const detector = new HumanFaceDetectorAdapter(opciones);
  const comparador = new HumanFaceMatchAdapter(opciones);

  // El retrato del documento, una sola vez: es el mismo para todas las
  // candidatas y armarlo cuesta más que compararlo.
  const tarjeta = await imagenes.normalize(await renderCedula(DATOS));
  const halladas = await detector.detectFaces({
    image: tarjeta.buffer,
    correlationId: 'busqueda',
  });
  if (halladas.faces.length === 0) throw new Error('no se detectó el retrato en la cédula');
  const retratoDelDocumento = await imagenes.crop(tarjeta.buffer, halladas.faces[0].box);

  const dentro = [];
  for (let i = 1; i <= CANDIDATAS; i += 1) {
    if (i === TITULAR) continue;
    const selfie = await imagenes.normalize(await renderSelfie(i, VARIANTE));
    const { similarityScore } = await comparador.compare({
      documentFace: retratoDelDocumento,
      selfieFace: selfie.buffer,
      correlationId: 'busqueda',
    });
    if (similarityScore !== null && similarityScore >= REVISION && similarityScore < APROBACION) {
      dentro.push({ i, parecido: similarityScore });
    }
    process.stdout.write(`\r${i}/${CANDIDATAS}`);
  }

  console.log(`\n\nfranja ambigua: [${REVISION}, ${APROBACION})`);
  if (dentro.length === 0) {
    console.error(
      'Ninguna candidata cae en la franja. Sube CANDIDATAS, o cambia TITULAR: con estos ' +
        'umbrales puede que este titular no tenga a nadie lo bastante parecido.',
    );
    process.exit(1);
  }
  // La del MEDIO de la franja, no la primera: una pareja pegada a un borde se
  // saldría al recalibrar por poco que se muevan los cortes.
  const centro = (REVISION + APROBACION) / 2;
  dentro.sort((a, b) => Math.abs(a.parecido - centro) - Math.abs(b.parecido - centro));
  for (const { i, parecido } of dentro.slice(0, 8)) {
    console.log(`  persona ${String(i).padStart(3)} · parecido ${parecido.toFixed(4)}`);
  }
  console.log(`\nla más centrada: PARECIDA = ${dentro[0].i} (${dentro[0].parecido.toFixed(4)})`);
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});

/**
 * MIDE el parecido entre un documento y una selfie CONCRETOS, y dice por qué.
 *
 * ## Para qué existe
 *
 * Cuando una verificación no aprueba, el resultado dice el veredicto pero no
 * deja mirar la cifra que lo produjo ni las dos caras que se compararon: el
 * motor borra las imágenes al cerrar la ejecución, que es lo correcto y también
 * lo que hace imposible depurar un caso después. Sin esto, la única forma de
 * saber si el problema es el umbral, el recorte o la orientación era volver a
 * correr la verificación con las fotos en la mano — y para entonces ya no están.
 *
 * Este comando hace exactamente lo que hace el pipeline —normalizar, enderezar
 * si hace falta, detectar, recortar las DOS caras igual, describir y comparar—
 * y publica cada paso con su número:
 *
 *   yarn ts-node scripts/medir-parecido-identidad.ts <documento> <selfie>
 *
 * ## Lo que NO es
 *
 * No es una calibración. Un umbral es una promesa sobre dos tasas de error y
 * ésas no se miden con un par de fotos: para eso está
 * `scripts/calibrar-identidad.mjs`, que necesita un corpus con varias personas y
 * varias tomas de cada una. Esto contesta la pregunta anterior y mucho más
 * frecuente: «¿por qué ESTE caso no pasó?».
 *
 * ## Privacidad
 *
 * No escribe nada en disco y no versiona nada. Las rutas se pasan por argumento
 * y las imágenes se quedan en memoria; el repositorio no guarda —ni debe
 * guardar— la cédula ni el rostro de nadie.
 */

import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import {
  HumanFaceDetectorAdapter,
  HumanLivenessAdapter,
} from '../src/modules/workers/identity-verification/core/adapters/human-face.adapter';
import {
  detectarRostros,
  parecidoCoseno,
} from '../src/modules/workers/identity-verification/core/adapters/human-runtime';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import type { FaceBoundingBox } from '../src/modules/workers/identity-verification/core/ports/identity.ports';

const GIROS = [90, 270, 180] as const;

/** Los umbrales del entorno, si están puestos; si no, los del compose de laboratorio. */
const UMBRAL_APROBACION = Number(process.env.IDENTITY_MATCH_THRESHOLD ?? 0.8824);
const UMBRAL_REVISION = Number(process.env.IDENTITY_REVIEW_THRESHOLD ?? 0.7789);
const PERFIL = process.env.IDENTITY_THRESHOLD_PROFILE_VERSION ?? 'sintetico-60x3-fmr1e-3-fnmr1e-2';

async function main(): Promise<void> {
  const [rutaDocumento, rutaSelfie] = process.argv.slice(2);
  if (!rutaDocumento || !rutaSelfie) {
    console.error('Uso: yarn ts-node scripts/medir-parecido-identidad.ts <documento> <selfie>');
    process.exit(2);
  }

  const images = new SharpImageAdapter(IDENTITY_DEFAULTS);
  const detector = new HumanFaceDetectorAdapter(IDENTITY_DEFAULTS);
  const liveness = new HumanLivenessAdapter(IDENTITY_DEFAULTS);

  /** Normaliza y, si no aparece ningún rostro, prueba los tres giros. */
  const enderezar = async (
    original: Buffer,
    etiqueta: string,
  ): Promise<{ imagen: Buffer; caja: FaceBoundingBox; giro: number; rostros: number } | null> => {
    for (const giro of [0, ...GIROS] as const) {
      const base = giro === 0 ? original : await images.rotate(original, giro);
      const normalizada = await images.normalize(base);
      const deteccion = await detector.detectFaces({
        image: normalizada.buffer,
        correlationId: etiqueta,
      });
      if (deteccion.faces.length === 0) continue;
      const primera = deteccion.faces[0];
      if (!primera) continue;
      return {
        imagen: normalizada.buffer,
        caja: primera.box,
        giro,
        rostros: deteccion.faces.length,
      };
    }
    return null;
  };

  const documento = await enderezar(readFileSync(rutaDocumento), 'documento');
  const selfie = await enderezar(readFileSync(rutaSelfie), 'selfie');

  for (const [nombre, hallazgo] of [
    ['documento', documento],
    ['selfie', selfie],
  ] as const) {
    if (!hallazgo) {
      console.log(`${nombre}: NINGÚN ROSTRO en las cuatro orientaciones.`);
      continue;
    }
    const meta = await sharp(hallazgo.imagen).metadata();
    const anchoPx = Math.round(hallazgo.caja.width * (meta.width ?? 0));
    const altoPx = Math.round(hallazgo.caja.height * (meta.height ?? 0));
    console.log(
      `${nombre}: ${String(meta.width)}x${String(meta.height)} · giro ${hallazgo.giro}° · ` +
        `${hallazgo.rostros} rostro(s) · rostro ${anchoPx}x${altoPx} px ` +
        `(${(hallazgo.caja.width * 100).toFixed(0)} % del ancho)`,
    );
  }

  if (!documento || !selfie) {
    console.log('\nSin rostro en las dos caras no hay comparación posible.');
    process.exit(1);
  }

  // Las dos caras por el MISMO camino, que es lo que hace el pipeline desde que
  // la asimetría de preprocesado resultó costar 0,08 de parecido.
  const recorteDocumento = await images.crop(documento.imagen, documento.caja);
  const recorteSelfie = await images
    .crop(selfie.imagen, selfie.caja)
    .catch(() => selfie.imagen);

  const describir = async (imagen: Buffer): Promise<number[] | null> => {
    const rostros = await detectarRostros(imagen);
    if (rostros.length === 0) return null;
    const mayor = rostros.reduce((m, r) =>
      r.box.width * r.box.height > m.box.width * m.box.height ? r : m,
    );
    return mayor.embedding?.length ? mayor.embedding : null;
  };

  const [eDocumento, eSelfie] = await Promise.all([
    describir(recorteDocumento),
    describir(recorteSelfie),
  ]);
  if (!eDocumento || !eSelfie) {
    console.log(
      `\nNo hay descriptor ${eDocumento ? 'de la selfie' : 'del documento'}: hay caja pero no ` +
        'rasgos describibles. El motor lo declara NO COMPARABLE, nunca «otra persona».',
    );
    process.exit(1);
  }

  const vida = await liveness.verify({ selfie: selfie.imagen, correlationId: 'medicion' });
  const parecido = parecidoCoseno(eDocumento, eSelfie);

  const veredicto =
    parecido >= UMBRAL_APROBACION
      ? 'APRUEBA'
      : parecido < UMBRAL_REVISION
        ? 'RECHAZA (FACE_NO_MATCH)'
        : 'REVISIÓN (AMBIGUOUS_MATCH)';

  console.log(`\nprueba de vida: ${vida.outcome}${vida.score ? ` (${vida.score.toFixed(3)})` : ''}`);
  console.log(`PARECIDO: ${parecido.toFixed(4)}`);
  console.log(`umbrales: aprueba ≥ ${UMBRAL_APROBACION} · rechaza < ${UMBRAL_REVISION}`);
  console.log(`perfil:   ${PERFIL}`);
  console.log(`VEREDICTO BIOMÉTRICO: ${veredicto}`);

  if (/^sintetico/i.test(PERFIL)) {
    console.log(
      '\nAVISO: ese perfil se calibró contra ROSTROS DIBUJADOS, no contra personas. No\n' +
        'predice ninguna tasa de error sobre caras reales y el esquema de entorno lo prohíbe\n' +
        'en producción. Para un umbral que signifique algo hace falta un corpus:\n' +
        '  node scripts/calibrar-identidad.mjs <carpeta-con-una-subcarpeta-por-persona>',
    );
  }
}

void main();

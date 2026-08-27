/**
 * MIDE lo que tarda el worker de identidad en RECHAZAR lo que no es un documento.
 *
 * ## Para qué existe
 *
 * Que el rechazo sea CORRECTO no basta: también tiene que llegar pronto. Quien sube una foto
 * equivocada no puede esperar lo mismo que quien sube una cédula buena, porque su respuesta —«eso
 * no es un documento»— es justo la que le desbloquea. Y el coste no está donde parece: no lo pone
 * la decisión, que es aritmética, sino las PASADAS del reconocedor que se gastan antes de tomarla.
 *
 * Este comando las cuenta y las cronometra. Está aquí y no en una prueba por lo mismo que
 * `medir-fraude-identidad.ts`: su salida es un número que hay que leer, no una aserción que
 * satisfacer. Es lo que hay que correr antes de tocar `ORIENTATION_PROBE_LONG_EDGE`.
 *
 *   yarn ts-node scripts/medir-rechazo-identidad.ts
 *
 * ## Lo que NO mide
 *
 * Fotos reales. La foto «cualquiera» de aquí es ruido de 12 MP, que es el PEOR caso para
 * Tesseract: sobre ruido encuentra candidatos a texto por todas partes. Una foto de un gato es más
 * suave y sale más barata. El número de abajo es un techo, no una media.
 */
import sharp from 'sharp';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import {
  IDENTITY_FIXTURES,
  buildIdentityFixtureImages,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { medirEvidenciaDeIdentidad } from '../src/modules/workers/identity-verification/core/engine/identity-evidence';

/** El mismo valor que usa el pipeline para sus sondas de orientación. */
const SONDA = 600;

/** Ruido de 12 MP: una foto de móvil que no es un documento, en su peor versión. */
async function fotoCualquiera(): Promise<Buffer> {
  const w = 3024;
  const h = 4032;
  const px = Buffer.alloc(w * h * 3);
  let s = 12345;
  for (let i = 0; i < px.length; i += 3) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 40 + (s % 180);
    px[i] = v;
    px[i + 1] = (v * 3) % 255;
    px[i + 2] = (v * 7) % 255;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

async function main() {
  const ocr = new TesseractOcrAdapter();
  const images = new SharpImageAdapter(IDENTITY_DEFAULTS);
  let pasadas = 0;

  const leer = async (buffer: Buffer) => {
    const t = Date.now();
    const r = await ocr.extract({ image: buffer, correlationId: 'medicion' });
    pasadas += 1;
    return { ms: Date.now() - t, texto: r.rawText };
  };

  /** El camino real del pipeline: lectura, reintento sin recorte, sondas de orientación. */
  const recorrer = async (etiqueta: string, entrada: Buffer, conSonda: boolean) => {
    pasadas = 0;
    const t0 = Date.now();
    const doc = await images.normalize(entrada);
    const enc = await images.frame(doc.buffer);
    const p1 = await leer(await images.downscale(enc.buffer, IDENTITY_DEFAULTS.ocrMaxLongEdge));
    console.log(`── ${etiqueta}`);
    console.log(`   pasada 1 (recortada): ${p1.ms}ms`);
    if (enc.recortado)
      console.log(
        `   pasada 2 (sin recorte): ${(await leer(await images.downscale(doc.buffer, IDENTITY_DEFAULTS.ocrMaxLongEdge))).ms}ms`,
      );
    /*
     * Los dos caminos que se comparan, y la diferencia NO es sólo el tamaño de
     * la imagen que lee el reconocedor: es también lo que cuesta PREPARAR cada
     * giro. Por eso el reloj de aquí abarca `sharp` y no sólo el OCR.
     */
    const baseSonda = conSonda ? await images.downscale(enc.buffer, SONDA) : null;
    for (const grados of [90, 180, 270] as const) {
      const tPrep = Date.now();
      const buf =
        baseSonda === null
          ? (await images.frame((await images.normalize(await images.rotate(entrada, grados))).buffer))
              .buffer
          : await images.rotate(baseSonda, grados);
      const prep = Date.now() - tPrep;
      const r = await leer(buf);
      console.log(
        `   giro ${grados}° ${conSonda ? `sonda ${SONDA}px` : 'tamaño completo'}: preparar ${prep}ms + leer ${r.ms}ms`,
      );
    }
    const ev = medirEvidenciaDeIdentidad({
      texto: p1.texto,
      anchoLargo: Math.max(doc.quality.width, doc.quality.height),
      ladoCorto: Math.min(doc.quality.width, doc.quality.height),
    });
    console.log(`   evidencia: ${ev.confidence.toFixed(2)} · [${ev.signals.join(', ')}]`);
    console.log(`   TOTAL ${Date.now() - t0}ms · ${pasadas} pasadas de OCR\n`);
  };

  const foto = await fotoCualquiera();
  console.log('=== Lo que NO es un documento: hasta dónde se llega antes de rechazarlo ===\n');
  await recorrer('ANTES (todos los giros a tamaño completo)', foto, false);
  await recorrer('AHORA (giros con sonda)', foto, true);

  console.log('=== Y lo que SÍ lo es: la cédula tumbada tiene que seguir rescatándose ===\n');
  const fx = IDENTITY_FIXTURES.find((f) => f.code === 'identidad-aprobada')!;
  const imgs = await buildIdentityFixtureImages(fx);
  for (const grados of [90, 180, 270] as const) {
    const tumbada = await images.rotate(imgs.document, grados);
    const doc = await images.normalize(await images.rotate(tumbada, ((360 - grados) % 360 || 90) as 90 | 180 | 270));
    const enc = await images.frame(doc.buffer);
    const sonda = await leer(await images.downscale(enc.buffer, SONDA));
    const ev = medirEvidenciaDeIdentidad({ texto: sonda.texto, anchoLargo: 856, ladoCorto: 540 });
    const rotulo = /CEDULA|IDENTIDAD|PLURINACIONAL/u.test(
      sonda.texto
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, ''),
    );
    console.log(
      `cédula tumbada ${grados}°, sonda de ${SONDA}px al enderezarla: ${sonda.ms}ms · rótulo legible=${String(rotulo)} · evidencia ${ev.confidence.toFixed(2)}`,
    );
  }

  await ocr.onModuleDestroy?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

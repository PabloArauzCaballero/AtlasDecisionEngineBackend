/**
 * MIDE qué se pierde al reducir la imagen que se le da al reconocedor.
 *
 * ## Para qué existe
 *
 * El coste del reconocedor crece con los píxeles, y ese coste lo paga entera la persona que sube
 * una foto EQUIVOCADA: su respuesta —«esto no es un documento»— llega detrás de todas las lecturas
 * que se intentaron para rescatarla. Bajar la resolución de entrada es la palanca grande que
 * queda, y es también la peligrosa: en este worker ya hubo una vez un corte por resolución que
 * rechazaba imágenes que el propio motor leía enteras.
 *
 * Así que la pregunta no es «¿clasifica?» —eso ya se sabe que sobrevive— sino **¿siguen saliendo
 * los CAMPOS?**: número, nombre, nacimiento, caducidad y la MRZ del reverso. Un tope que conserve
 * la clasificación y se coma el número de la cédula no es una optimización, es una avería.
 *
 *   yarn ts-node scripts/medir-resolucion-ocr-identidad.ts                  # cédula sintética
 *   yarn ts-node scripts/medir-resolucion-ocr-identidad.ts ~/fotos-cedulas   # fotos REALES
 *
 * Lo que se lee abajo es la fila donde los campos empiezan a faltar. El tope va POR ENCIMA de esa
 * fila, no en ella.
 *
 * ## Con fotos reales
 *
 * El argumento es un directorio de FUERA del repositorio, y este comando no copia, no mueve y no
 * escribe nada dentro de él: sólo lee. Es la única forma honesta de calibrar esto —una cédula que
 * dibujamos nosotros es un SVG nítido que no pasó por ningún sensor, y lo primero que se pierde al
 * reducir una foto de verdad es la MRZ, que es la letra más pequeña de la tarjeta y de donde salen
 * el número y las fechas—.
 *
 * Empareja anverso y reverso por nombre: `algo.jpg` y `algo-reverso.jpg`. Sin reverso la medición
 * sigue valiendo, pero mide un caso más pobre: sin MRZ el analizador cae al texto impreso, que es
 * justo la parte que aguanta más. Para elegir el tope hay que ver perder la MRZ.
 *
 * Cuando termines, BORRA las fotos. No pertenecen a esta máquina más tiempo del que dure la
 * medición.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { TesseractOcrAdapter } from '../src/modules/workers/identity-verification/core/adapters/tesseract-ocr.adapter';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import {
  IDENTITY_FIXTURES,
  buildIdentityFixtureImages,
} from '../src/modules/workers/identity-verification/fixtures/identity-fixtures';
import { BoliviaCiDocumentParser } from '../src/modules/workers/identity-verification/core/parsers/bolivia-ci-document.parser';
import { IdentityDocumentType } from '../src/modules/workers/identity-verification/core/domain/identity-enums';
import type { DocumentOcrResult } from '../src/modules/workers/identity-verification/core/ports/identity.ports';

const TOPES = [0, 1400, 1200, 1000, 800, 600] as const;

function unir(front: DocumentOcrResult, back: DocumentOcrResult): DocumentOcrResult {
  return {
    ...front,
    rawText: `${front.rawText}\n${back.rawText}`,
    lines: [...front.lines, ...back.lines],
  };
}

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const SUFIJO_REVERSO = '-reverso';

/** Los ejemplares a medir: los del catálogo, o los de un directorio de fuera. */
function ejemplares(
  directorio: string | undefined,
): Array<{ nombre: string; cargar: () => Promise<{ document: Buffer; documentBack: Buffer | null }> }> {
  if (directorio === undefined) {
    return ['identidad-aprobada', 'identidad-sobre-escritorio']
      .map((code) => IDENTITY_FIXTURES.find((f) => f.code === code))
      .filter((fx): fx is NonNullable<typeof fx> => fx !== undefined)
      .map((fx) => ({
        nombre: `${fx.code} (sintético)`,
        cargar: async () => {
          const imgs = await buildIdentityFixtureImages(fx);
          return { document: imgs.document, documentBack: imgs.documentBack };
        },
      }));
  }

  /*
   * El directorio se comprueba ANTES de tocarlo, y el error se escribe entero.
   *
   * `readdirSync` sobre algo que no existe lanza un ENOENT con su volcado de
   * pila, y eso obliga a quien corre el comando a leer diez líneas de rutas de
   * `node:fs` para enterarse de que se equivocó de carpeta. Lo que hay que
   * decirle es qué buscaba, dónde, y qué tiene que hacer.
   */
  const ruta = resolve(directorio);
  let esDirectorio: boolean;
  try {
    esDirectorio = statSync(ruta).isDirectory();
  } catch {
    throw new Error(
      `No existe la carpeta ${ruta}.\n` +
        `Crea una FUERA del repositorio, mete ahí las fotos y vuelve a llamarme con su ruta:\n` +
        `  mkdir -p ~/fotos-cedulas   # y copia ahí las fotos\n` +
        `  yarn ts-node scripts/medir-resolucion-ocr-identidad.ts ~/fotos-cedulas\n` +
        `Sin argumento mido la cédula sintética, que sirve para comprobar que esto funciona y ` +
        `NO para elegir el tope.`,
    );
  }
  if (!esDirectorio) {
    throw new Error(`${ruta} es un archivo, y lo que necesito es la CARPETA que lo contiene.`);
  }

  const archivos = readdirSync(ruta).filter((f) => EXTENSIONES.has(extname(f).toLowerCase()));
  const anversos = archivos.filter((f) => !basename(f, extname(f)).endsWith(SUFIJO_REVERSO));
  if (anversos.length === 0) {
    throw new Error(
      `La carpeta ${ruta} existe pero no tiene imágenes que yo sepa leer.\n` +
        `Admito ${[...EXTENSIONES].join(', ')}, y el reverso se empareja por nombre: ` +
        `foto.jpg + foto${SUFIJO_REVERSO}.jpg.` +
        (readdirSync(ruta).length === 0 ? '' : `\nLo que hay ahí: ${readdirSync(ruta).join(', ')}`),
    );
  }
  return anversos.map((archivo) => {
    const raiz = basename(archivo, extname(archivo));
    const reverso = archivos.find((f) => basename(f, extname(f)) === `${raiz}${SUFIJO_REVERSO}`);
    return {
      nombre: `${archivo}${reverso === undefined ? ' · SIN REVERSO, no mide la MRZ' : ''}`,
      cargar: () =>
        Promise.resolve({
          document: readFileSync(join(ruta, archivo)),
          documentBack: reverso === undefined ? null : readFileSync(join(ruta, reverso)),
        }),
    };
  });
}

async function main() {
  const ocr = new TesseractOcrAdapter();
  const images = new SharpImageAdapter(IDENTITY_DEFAULTS);
  const parser = new BoliviaCiDocumentParser();

  const directorio = process.argv[2];
  // La lista se resuelve ANTES de anunciar nada: anunciar «midiendo X» y fallar
  // en la línea siguiente es peor que no anunciar.
  const lista = ejemplares(directorio);
  console.log(
    directorio === undefined
      ? 'Midiendo la cédula SINTÉTICA. Es un SVG nítido: aguanta más de lo que aguantará una foto.\n' +
          'Para lo que de verdad decide el tope, pásale una carpeta con fotos reales.'
      : `Midiendo ${String(lista.length)} foto(s) de ${resolve(directorio)}. ` +
          'Este comando sólo LEE; nada se copia al repositorio.',
  );

  for (const ejemplar of lista) {
    const imgs = await ejemplar.cargar();
    const doc = await images.normalize(imgs.document);
    const enc = await images.frame(doc.buffer);
    const reverso = imgs.documentBack ? (await images.normalize(imgs.documentBack)).buffer : null;

    console.log(`\n=== ${ejemplar.nombre} ===`);
    for (const tope of TOPES) {
      const anverso = tope === 0 ? enc.buffer : await images.downscale(enc.buffer, tope);
      const dorso =
        reverso === null ? null : tope === 0 ? reverso : await images.downscale(reverso, tope);
      const meta = await sharp(anverso).metadata();

      const t = Date.now();
      const front = await ocr.extract({ image: anverso, correlationId: 'medicion' });
      const back = dorso ? await ocr.extract({ image: dorso, correlationId: 'medicion' }) : null;
      const ms = Date.now() - t;

      const juntas = back ? unir(front, back) : front;
      const { fields, warnings } = await parser.parse({
        ocr: juntas,
        context: { type: IdentityDocumentType.BOLIVIA_CI, country: 'BO' },
      });
      const f = fields as Record<string, unknown>;
      const tiene = (clave: string) => (f[clave] ? '·' : 'FALTA');
      console.log(
        `  ${String(meta.width).padStart(4)}x${String(meta.height).padEnd(4)} ${String(ms).padStart(5)}ms | ` +
          `numero ${tiene('documentNumber')} nombre ${tiene('fullName')} ` +
          `nacimiento ${tiene('dateOfBirth')} caducidad ${tiene('expirationDate')}` +
          (warnings.length ? ` | avisos: ${warnings.join(', ')}` : ''),
      );
      if (tope === 0) console.log(`         (campos leídos: ${JSON.stringify(fields)})`);
    }
  }
  await ocr.onModuleDestroy?.();
}

main().catch((error: unknown) => {
  // Un mensaje que YO escribí se imprime tal cual; lo demás sí lleva su volcado,
  // porque ahí el fallo es de verdad inesperado y la pila es lo único que ayuda.
  console.error(error instanceof Error ? `\n${error.message}\n` : error);
  process.exit(1);
});

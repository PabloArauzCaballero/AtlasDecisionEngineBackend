#!/usr/bin/env node
/**
 * Calibra los umbrales de la comparación biométrica MIDIÉNDOLOS.
 *
 * Un umbral es una promesa sobre errores: «por encima de esto acepto, y al
 * hacerlo acepto también una de cada mil caras ajenas». Esa promesa sólo se
 * puede sostener sobre una medición, así que este comando construye las dos
 * distribuciones que la sostienen —parecidos entre tomas de la MISMA persona y
 * entre personas DISTINTAS— y saca de ellas los cortes:
 *
 *   IDENTITY_MATCH_THRESHOLD   percentil de las impostoras que deja fuera todas
 *                              menos la tasa de falsa aceptación pedida
 *   IDENTITY_REVIEW_THRESHOLD  percentil de las genuinas por debajo del cual se
 *                              rechaza, con la tasa de falso rechazo pedida
 *
 * Entre los dos queda la franja que va a una persona. Si al medir resulta que no
 * hay franja —el corte de aceptación cae por debajo del de rechazo—, el comando
 * falla en vez de emitir un par imposible.
 *
 * **Corre `yarn build` antes.** Este comando mide con el motor COMPILADO, así que
 * una compilación vieja calibra contra una configuración biométrica que ya no es
 * la que decide — y un umbral medido sobre otro motor no vale para éste.
 *
 *   node scripts/calibrar-identidad.mjs                  # población sintética
 *   node scripts/calibrar-identidad.mjs ruta/al/corpus   # corpus real, selfie↔selfie
 *   node scripts/calibrar-identidad.mjs --documento-selfie ruta/al/corpus
 *
 * El corpus real es una carpeta con una subcarpeta por persona y al menos dos
 * imágenes en cada una. **No se versiona nunca**: son rostros de personas.
 *
 * ## El modo `--documento-selfie`, y por qué el otro no basta
 *
 * El modo clásico empareja varias TOMAS de la misma persona: selfie contra
 * selfie. Ese no es el contraste que este producto hace. La comparación real es
 * **el retrato impreso de un carnet contra una selfie viva**, y son dos
 * dominios distintos: el retrato va tras un plastificado que lo lava, le mete un
 * velo de color y le come contraste, y encima llega fotografiado de una tarjeta
 * pequeña. Calibrar con parejas selfie↔selfie produce un umbral alto y
 * perfectamente inútil, porque describe una población que el flujo nunca ve.
 *
 * Está medido: sobre una cédula boliviana auténtica y una selfie real de su
 * titular, el parecido es 0,67. El umbral heredado de la población sintética
 * —0,8824— no sólo no lo aprobaba: quedaba por debajo del corte de RECHAZO, de
 * modo que el motor declaraba impostor a un solicitante legítimo.
 *
 * En este modo, dentro de la carpeta de cada persona:
 *
 *   - el DOCUMENTO es el archivo cuyo nombre empieza por `doc`, `carnet` o
 *     `cedula` (basta la foto del anverso entero: el rostro se recorta solo);
 *   - todo lo demás son SELFIES suyas.
 *
 * Las parejas genuinas son documento↔selfie de la misma persona; las impostoras,
 * documento de una contra selfies de las demás. Es exactamente lo que el
 * pipeline compara.
 *
 * ## Los rostros se RECORTAN como los recorta el pipeline
 *
 * En los dos modos, y desde que el pipeline pasó a recortar las dos caras igual.
 * Un umbral medido sobre imágenes enteras no aplica a un motor que compara
 * recortes: sería calibrar un instrumento distinto del que decide.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const OBJETIVO_FMR = Number(process.env.CALIBRACION_FMR ?? 0.001);
const OBJETIVO_FNMR = Number(process.env.CALIBRACION_FNMR ?? 0.01);
const IMAGENES = /\.(png|jpe?g|webp)$/i;
/** Cómo se reconoce el archivo del documento dentro de la carpeta de una persona. */
const ES_DOCUMENTO = /^(doc|carnet|cedula|c[ée]dula)/i;
/** Los mismos valores con los que el pipeline recorta un rostro para compararlo. */
const MARGEN_RECORTE = 0.25;
const LADO_RECORTE = 480;

// `fileURLToPath` y no la ruta de la URL a pelo: en Windows aquélla llega como
// `/d:/...`, que no es una ruta válida y hacía fallar la comprobación de la
// compilación con el mensaje de que faltaba, estando hecha.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Carga el motor y los generadores desde el TypeScript ya compilado o desde el fuente. */
async function cargarMotor() {
  const compilado = path.join(raiz, 'dist', 'modules', 'workers', 'identity-verification');
  const runtime = path.join(compilado, 'core', 'adapters', 'human-runtime.js');
  try {
    await stat(runtime);
  } catch {
    console.error(
      'Falta la compilación. Ejecuta `yarn build` antes de calibrar: el motor biométrico ' +
        'vive en TypeScript y este comando no lo transpila.',
    );
    process.exit(2);
  }
  return {
    runtime: await import(pathToFileURL(runtime).href),
    fixtures: await import(
      pathToFileURL(path.join(compilado, 'fixtures', 'identity-faces.js')).href
    ),
  };
}

/** Corpus real: una subcarpeta por persona. */
async function corpusDeDisco(dir) {
  const personas = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const suyas = (await readdir(path.join(dir, entrada.name)))
      .filter((f) => IMAGENES.test(f))
      .map((f) => path.join(dir, entrada.name, f));
    if (suyas.length >= 2) personas.push({ nombre: entrada.name, imagenes: suyas });
  }
  return personas;
}

/**
 * Corpus documento↔selfie: en cada carpeta, un documento y sus selfies.
 *
 * Se exige EXACTAMENTE un documento por persona. Con dos, no se sabría cuál es
 * el vigente, y calibrar contra un carnet caducado del que ya no se acepta el
 * retrato es medir contra un dato que el flujo no va a ver.
 */
async function corpusDocumentoSelfie(dir) {
  const personas = [];
  const avisos = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const archivos = (await readdir(path.join(dir, entrada.name))).filter((f) => IMAGENES.test(f));
    const documentos = archivos.filter((f) => ES_DOCUMENTO.test(f));
    const selfies = archivos.filter((f) => !ES_DOCUMENTO.test(f));
    if (documentos.length !== 1 || selfies.length === 0) {
      avisos.push(
        `  ${entrada.name}: ${documentos.length} documento(s) y ${selfies.length} selfie(s)`,
      );
      continue;
    }
    personas.push({
      nombre: entrada.name,
      documento: path.join(dir, entrada.name, documentos[0]),
      selfies: selfies.map((f) => path.join(dir, entrada.name, f)),
    });
  }
  if (avisos.length > 0) {
    console.error(
      `Carpetas descartadas (hace falta UN archivo que empiece por doc/carnet/cedula y al ` +
        `menos una selfie):\n${avisos.join('\n')}`,
    );
  }
  return personas;
}

const percentil = (orden, p) => orden[Math.min(orden.length - 1, Math.floor(p * orden.length))];

/**
 * El descriptor de una imagen, recortando el rostro como lo recorta el pipeline.
 *
 * Devuelve `null` cuando no hay exactamente un rostro describible: una imagen
 * con dos caras no se sabe de quién es, y una sin ninguna no aporta nada. Las
 * descartadas se cuentan y se publican — un corpus del que se cae la mitad de
 * las tomas no produce un umbral, produce una ilusión de umbral.
 *
 * Reproduce también la excepción del pipeline: si la caja del rostro toca el
 * borde del encuadre, NO se recorta. Con la cara cortada por el marco el margen
 * no cabe y el recorte entrega medio rostro ampliado.
 */
async function descriptorRecortado(detectarRostros, ruta) {
  const original = await readFile(ruta);
  const rostros = await detectarRostros(original);
  if (rostros.length !== 1 || !rostros[0].embedding) return null;

  const caja = rostros[0].box;
  const padX = caja.width * MARGEN_RECORTE;
  const padY = caja.height * MARGEN_RECORTE;
  const cabe =
    caja.left - padX >= 0 &&
    caja.top - padY >= 0 &&
    caja.left + caja.width + padX <= 1 &&
    caja.top + caja.height + padY <= 1;
  if (!cabe) return rostros[0].embedding;

  const meta = await sharp(original).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const recorte = await sharp(original)
    .extract({
      left: Math.max(0, Math.floor((caja.left - padX) * W)),
      top: Math.max(0, Math.floor((caja.top - padY) * H)),
      width: Math.ceil((caja.width + 2 * padX) * W),
      height: Math.ceil((caja.height + 2 * padY) * H),
    })
    .resize({ width: LADO_RECORTE, height: LADO_RECORTE, fit: 'inside', withoutEnlargement: false })
    .jpeg({ quality: 95 })
    .toBuffer();

  const dentro = await detectarRostros(recorte);
  // Si el recorte deja de dejarse describir, vale el descriptor de la imagen
  // entera: perder la toma sería peor que compararla sin recortar.
  return dentro.length > 0 && dentro[0].embedding ? dentro[0].embedding : rostros[0].embedding;
}

async function main() {
  const args = process.argv.slice(2);
  const modoDocumentoSelfie = args.includes('--documento-selfie');
  const dir = args.find((a) => !a.startsWith('--'));
  const { runtime, fixtures } = await cargarMotor();
  const { detectarRostros, parecidoCoseno } = runtime;

  let etiquetaCorpus;
  let tomasPorPersona;
  const descriptores = [];
  /** En el modo documento↔selfie: el retrato del carnet de cada persona. */
  const referencias = [];
  let sinRostro = 0;

  if (modoDocumentoSelfie) {
    if (!dir) {
      console.error('El modo --documento-selfie necesita la ruta del corpus.');
      process.exit(2);
    }
    const personas = await corpusDocumentoSelfie(path.resolve(dir));
    if (personas.length < 10) {
      console.error(
        `El corpus tiene ${personas.length} personas con documento y al menos una selfie. Con ` +
          'menos de 10 la tasa de falsa aceptación no se puede estimar.',
      );
      process.exit(2);
    }
    tomasPorPersona = Math.round(
      personas.reduce((n, p) => n + p.selfies.length, 0) / personas.length,
    );
    const huella = createHash('sha256');
    for (const p of personas) {
      huella.update(path.basename(p.documento));
      for (const i of p.selfies) huella.update(path.basename(i));
    }
    etiquetaCorpus = `docsel-${huella.digest('hex').slice(0, 8)}`;

    for (const persona of personas) {
      const documento = await descriptorRecortado(detectarRostros, persona.documento);
      if (!documento) {
        sinRostro += 1;
        continue;
      }
      const suyas = [];
      for (const selfie of persona.selfies) {
        const e = await descriptorRecortado(detectarRostros, selfie);
        if (e) suyas.push(e);
        else sinRostro += 1;
      }
      if (suyas.length === 0) continue;
      referencias.push(documento);
      descriptores.push(suyas);
      process.stdout.write(`\r${descriptores.length}/${personas.length} personas`);
    }
  } else if (dir) {
    const personas = await corpusDeDisco(path.resolve(dir));
    if (personas.length < 10) {
      console.error(
        `El corpus tiene ${personas.length} personas con dos o más imágenes. Con menos de 10 ` +
          'la tasa de falsa aceptación no se puede estimar: haría falta que una de cada mil ' +
          'parejas fuera medible y aquí no llegan ni a mil parejas.',
      );
      process.exit(2);
    }
    tomasPorPersona = Math.round(
      personas.reduce((n, p) => n + p.imagenes.length, 0) / personas.length,
    );
    // Huella del corpus, no su contenido: permite saber si dos calibraciones se
    // hicieron sobre lo mismo sin guardar ni un rostro.
    const huella = createHash('sha256');
    for (const p of personas) for (const i of p.imagenes) huella.update(path.basename(i));
    etiquetaCorpus = `real-${huella.digest('hex').slice(0, 8)}`;

    for (const persona of personas) {
      const suyos = [];
      for (const imagen of persona.imagenes) {
        const e = await descriptorRecortado(detectarRostros, imagen);
        if (e) suyos.push(e);
        else sinRostro += 1;
      }
      descriptores.push(suyos);
      process.stdout.write(`\r${descriptores.length}/${personas.length} personas`);
    }
  } else {
    const N = Number(process.env.CALIBRACION_PERSONAS ?? 60);
    tomasPorPersona = 3;
    etiquetaCorpus = 'sintetico';
    for (let i = 1; i <= N; i += 1) {
      const suyos = [];
      for (let t = 0; t < tomasPorPersona; t += 1) {
        const rostros = await detectarRostros(await fixtures.retrato(i, t));
        if (rostros.length !== 1 || !rostros[0].embedding) {
          sinRostro += 1;
          continue;
        }
        suyos.push(rostros[0].embedding);
      }
      descriptores.push(suyos);
      process.stdout.write(`\r${i}/${N} personas`);
    }
  }

  const genuinas = [];
  const impostoras = [];
  if (modoDocumentoSelfie) {
    /*
     * El DOCUMENTO de cada persona contra las selfies de todo el mundo.
     *
     * Las parejas no son simétricas y eso es correcto: el flujo siempre compara
     * un retrato de carnet contra una selfie, nunca dos selfies ni dos carnets.
     * Emparejar en las dos direcciones metería en la distribución contrastes que
     * el motor no hace y desplazaría los cortes.
     */
    for (let i = 0; i < referencias.length; i += 1) {
      for (const suya of descriptores[i]) genuinas.push(parecidoCoseno(referencias[i], suya));
      for (let j = 0; j < descriptores.length; j += 1) {
        if (i === j) continue;
        for (const ajena of descriptores[j]) {
          impostoras.push(parecidoCoseno(referencias[i], ajena));
        }
      }
    }
  } else {
    for (let i = 0; i < descriptores.length; i += 1) {
      for (let a = 0; a < descriptores[i].length; a += 1) {
        for (let b = a + 1; b < descriptores[i].length; b += 1) {
          genuinas.push(parecidoCoseno(descriptores[i][a], descriptores[i][b]));
        }
        for (let j = i + 1; j < descriptores.length; j += 1) {
          for (const otro of descriptores[j]) {
            impostoras.push(parecidoCoseno(descriptores[i][a], otro));
          }
        }
      }
    }
  }
  genuinas.sort((x, y) => x - y);
  impostoras.sort((x, y) => x - y);

  console.log(`\n\nparejas: ${genuinas.length} genuinas, ${impostoras.length} impostoras`);
  console.log(`tomas descartadas por no dar un rostro único: ${sinRostro}`);

  /*
   * ¿Se puede medir la tasa pedida? Con 500 parejas impostoras, el percentil
   * 99,9 lo decide UNA pareja, y una pareja no es una tasa. Antes de emitir un
   * número que va a decidir sobre identidades, se comprueba que hay con qué.
   */
  const minimasParaFmr = Math.ceil(10 / OBJETIVO_FMR);
  if (impostoras.length < minimasParaFmr) {
    console.error(
      `\nHacen falta al menos ${minimasParaFmr} parejas impostoras para estimar una tasa de ` +
        `${OBJETIVO_FMR} y hay ${impostoras.length}. Añade personas al corpus o pide una tasa ` +
        'menos exigente con CALIBRACION_FMR.',
    );
    process.exit(2);
  }

  const match = percentil(impostoras, 1 - OBJETIVO_FMR);
  const review = percentil(genuinas, OBJETIVO_FNMR);

  const resumen = (nombre, v) =>
    console.log(
      `${nombre.padEnd(11)} min=${v[0].toFixed(4)} p05=${percentil(v, 0.05).toFixed(4)} ` +
        `mediana=${percentil(v, 0.5).toFixed(4)} p95=${percentil(v, 0.95).toFixed(4)} ` +
        `max=${v[v.length - 1].toFixed(4)}`,
    );
  console.log();
  resumen('genuinas', genuinas);
  resumen('impostoras', impostoras);

  if (review >= match) {
    console.error(
      `\nNo hay franja: el corte de aceptación (${match.toFixed(4)}) queda por debajo del de ` +
        `rechazo (${review.toFixed(4)}). Las dos distribuciones se solapan demasiado para las ` +
        'tasas pedidas; afloja CALIBRACION_FMR o CALIBRACION_FNMR, o mejora la calidad del corpus.',
    );
    process.exit(1);
  }

  // Notación exponencial: `fmr1e-3` se lee «una de cada mil». `fmr001` no.
  const fmt = (x) => Number(x).toExponential(0);
  const perfil = `${etiquetaCorpus}-${descriptores.length}x${tomasPorPersona}-fmr${fmt(OBJETIVO_FMR)}-fnmr${fmt(OBJETIVO_FNMR)}`;

  // Cuántos aciertos cuesta de verdad, no en teoría: es la cifra que hay que
  // poder enseñar cuando alguien pregunte cuánta gente irá a revisión.
  const genuinasARevision = genuinas.filter((g) => g >= review && g < match).length;
  const genuinasRechazadas = genuinas.filter((g) => g < review).length;
  const impostorasAceptadas = impostoras.filter((i) => i >= match).length;

  console.log(`\n--- perfil «${perfil}» ---`);
  console.log(`IDENTITY_MATCH_THRESHOLD=${match.toFixed(4)}`);
  console.log(`IDENTITY_REVIEW_THRESHOLD=${review.toFixed(4)}`);
  console.log(`IDENTITY_THRESHOLD_PROFILE_VERSION=${perfil}`);
  console.log(
    `\nsobre este corpus: aprueba automáticamente ${(((genuinas.length - genuinasARevision - genuinasRechazadas) * 100) / genuinas.length).toFixed(1)} % de las genuinas, ` +
      `manda a revisión ${((genuinasARevision * 100) / genuinas.length).toFixed(1)} % y rechaza ${((genuinasRechazadas * 100) / genuinas.length).toFixed(1)} %; ` +
      `deja pasar ${impostorasAceptadas} de ${impostoras.length} impostoras (${((impostorasAceptadas * 100) / impostoras.length).toFixed(3)} %).`,
  );
  if (etiquetaCorpus === 'sintetico') {
    console.log(
      '\nAVISO: población SINTÉTICA. Estos cortes valen para demostrar y probar el worker; ' +
        'no predicen la tasa de falsas aceptaciones sobre personas reales, y el esquema de ' +
        'entorno rechaza un perfil «sintetico-…» en producción a propósito.',
    );
  } else if (!modoDocumentoSelfie) {
    /*
     * Un corpus real pero del contraste EQUIVOCADO tampoco sirve, y esta es la
     * advertencia que faltaba. Medir selfie contra selfie da cortes altos
     * —dos capturas del mismo día con la misma cámara se parecen muchísimo— y
     * aplicarlos a un flujo que compara un retrato plastificado contra una
     * selfie viva rechaza a gente legítima. Está medido: 0,67 en un par real.
     */
    console.log(
      '\nAVISO: estas parejas son selfie↔selfie, y este worker compara RETRATO DE CARNET contra ' +
        'selfie. Son dos dominios distintos y el corte sale sistemáticamente alto. Para el umbral ' +
        'que de verdad aplica: node scripts/calibrar-identidad.mjs --documento-selfie <corpus>',
    );
  }
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});

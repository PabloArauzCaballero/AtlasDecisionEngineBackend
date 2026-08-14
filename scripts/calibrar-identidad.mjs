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
 *   node scripts/calibrar-identidad.mjs                  # población sintética
 *   node scripts/calibrar-identidad.mjs ruta/al/corpus   # corpus real
 *
 * El corpus real es una carpeta con una subcarpeta por persona y al menos dos
 * imágenes en cada una. **No se versiona nunca**: son rostros de personas.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OBJETIVO_FMR = Number(process.env.CALIBRACION_FMR ?? 0.001);
const OBJETIVO_FNMR = Number(process.env.CALIBRACION_FNMR ?? 0.01);
const IMAGENES = /\.(png|jpe?g|webp)$/i;

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

const percentil = (orden, p) => orden[Math.min(orden.length - 1, Math.floor(p * orden.length))];

async function main() {
  const dir = process.argv[2];
  const { runtime, fixtures } = await cargarMotor();
  const { detectarRostros, parecidoCoseno } = runtime;

  let etiquetaCorpus;
  let tomasPorPersona;
  const descriptores = [];
  let sinRostro = 0;

  if (dir) {
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
        const rostros = await detectarRostros(await readFile(imagen));
        if (rostros.length !== 1 || !rostros[0].embedding) {
          sinRostro += 1;
          continue;
        }
        suyos.push(rostros[0].embedding);
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
  }
}

main().catch((error) => {
  console.error('FALLO:', error.message);
  process.exit(1);
});

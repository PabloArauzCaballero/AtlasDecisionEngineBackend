/**
 * CRUZA las parejas impostoras de un corpus exportado, que es la mitad que sale gratis.
 *
 *   yarn cruce:impostoras ~/corpus-beta
 *
 * ## Por qué esto no cuesta nada y vale mucho
 *
 * Una beta con testers da las parejas GENUINAS —documento y selfie de la misma persona— y sólo
 * ésas: nadie va a intentar hacerse pasar por otro para ayudarnos. Las IMPOSTORAS, en cambio, se
 * construyen sin pedir nada a nadie: el documento de cada sujeto contra las selfies de todos los
 * demás. Con 25 sujetos son 600 parejas.
 *
 * Y son la mitad que fija la tasa que importa para no aprobar a un impostor. Con 0 fallos en 600,
 * el techo de falsa aceptación al 95 % es del 0,5 %; con 21, del 13,3 %. La diferencia entre esas
 * dos cifras es la diferencia entre un umbral que se puede defender y uno que no.
 *
 * ## Lo que hace y lo que NO hace
 *
 * Mide y publica las dos distribuciones, y dice si existe un corte que las separe. **No emite
 * umbrales**: eso es `calibrar-identidad.mjs`, que además exige que quede franja entre los dos
 * cortes. Aquí sólo se contesta «¿hay separación, y cuánta?».
 *
 * Lee la carpeta que produce `yarn exportar:corpus-identidad`: una subcarpeta por sujeto, con el
 * documento en un archivo que empieza por `carnet` y el resto selfies. No escribe nada.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SharpImageAdapter } from '../src/modules/workers/identity-verification/core/adapters/sharp-image.adapter';
import {
  detectarRostros,
  parecidoCoseno,
} from '../src/modules/workers/identity-verification/core/adapters/human-runtime';
import { IDENTITY_DEFAULTS } from '../src/modules/workers/identity-verification/core/identity-options';
import {
  ruleOfThree,
  zeroErrorUpperBound,
  clopperPearson,
} from '../src/common/statistics/binomial';

const [raizArg] = process.argv.slice(2);
if (!raizArg) {
  console.error(
    'Uso: yarn cruce:impostoras <directorio>\n' +
      'El directorio es el que produce `yarn exportar:corpus-identidad`.',
  );
  process.exit(2);
}
const raiz = resolve(raizArg);

const IMAGENES = /\.(png|jpe?g|webp)$/i;
const ES_DOCUMENTO = /^(carnet|doc|cedula|c[ée]dula)/i;
const imagenes = new SharpImageAdapter(IDENTITY_DEFAULTS);

interface Sujeto {
  readonly clave: string;
  readonly documento: string;
  readonly selfies: readonly string[];
}

function leerSujetos(): Sujeto[] {
  const sujetos: Sujeto[] = [];
  for (const entrada of readdirSync(raiz)) {
    const carpeta = join(raiz, entrada);
    if (!statSync(carpeta).isDirectory()) continue;
    const archivos = readdirSync(carpeta).filter((f) => IMAGENES.test(f));
    const documento = archivos.find((f) => ES_DOCUMENTO.test(f));
    const selfies = archivos.filter((f) => !ES_DOCUMENTO.test(f));
    if (!documento || selfies.length === 0) {
      console.warn(`  ! ${entrada}: falta documento o selfie. Se salta.`);
      continue;
    }
    sujetos.push({
      clave: entrada,
      documento: join(carpeta, documento),
      selfies: selfies.map((f) => join(carpeta, f)),
    });
  }
  return sujetos;
}

/** El descriptor del rostro mayor, recortado igual que lo recorta el pipeline. */
async function descriptor(ruta: string): Promise<number[] | null> {
  const original = readFileSync(ruta);
  const rostros = await detectarRostros(original);
  if (rostros.length === 0) return null;
  const mayor = rostros.reduce((m, r) =>
    r.box.width * r.box.height > m.box.width * m.box.height ? r : m,
  );
  // Las dos caras por el MISMO camino: la asimetría de preprocesado costó 0,08 de parecido.
  const recorte = await imagenes.crop(original, mayor.box).catch(() => original);
  const delRecorte = await detectarRostros(recorte);
  const elegido = delRecorte.length > 0 ? delRecorte[0] : mayor;
  return elegido.embedding?.length ? elegido.embedding : null;
}

const pct = (n: number): string => `${(n * 100).toFixed(3)} %`;

async function main(): Promise<void> {
  const sujetos = leerSujetos();
  if (sujetos.length === 0) {
    console.error(`No hay ningún sujeto utilizable en ${raiz}.`);
    process.exit(2);
  }
  console.log(`\nSujetos: ${sujetos.length}`);

  // Un descriptor por archivo, calculado UNA vez: el cruce es cuadrático y recalcularlo por pareja
  // multiplicaría por N el trabajo sin cambiar ningún número.
  const docs = new Map<string, number[]>();
  const selfies = new Map<string, number[][]>();
  for (const s of sujetos) {
    const d = await descriptor(s.documento);
    if (d) docs.set(s.clave, d);
    else console.warn(`  ! ${s.clave}: sin rostro describible en el documento.`);
    const lista: number[][] = [];
    for (const ruta of s.selfies) {
      const e = await descriptor(ruta);
      if (e) lista.push(e);
      else console.warn(`  ! ${s.clave}: sin rostro describible en ${ruta.split('/').pop()}.`);
    }
    selfies.set(s.clave, lista);
  }

  const genuinas: number[] = [];
  const impostoras: number[] = [];
  for (const a of sujetos) {
    const doc = docs.get(a.clave);
    if (!doc) continue;
    for (const b of sujetos) {
      for (const selfie of selfies.get(b.clave) ?? []) {
        (a.clave === b.clave ? genuinas : impostoras).push(parecidoCoseno(doc, selfie));
      }
    }
  }

  const resumen = (nombre: string, xs: number[]): void => {
    if (xs.length === 0) {
      console.log(`  ${nombre}: ninguna`);
      return;
    }
    const media = xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(
      `  ${nombre}: ${xs.length} · mín ${Math.min(...xs).toFixed(4)} · ` +
        `media ${media.toFixed(4)} · máx ${Math.max(...xs).toFixed(4)}`,
    );
  };

  console.log('\nDistribuciones:');
  resumen('genuinas ', genuinas);
  resumen('impostoras', impostoras);

  if (genuinas.length === 0 || impostoras.length === 0) {
    console.log(
      '\nHacen falta las DOS para decir algo: sin genuinas no hay falso rechazo que medir, y sin\n' +
        'impostoras no hay falsa aceptación. Exporta más casos firmados.',
    );
    return;
  }

  const peorGenuina = Math.min(...genuinas);
  const mejorImpostora = Math.max(...impostoras);
  console.log(
    `\nSeparación: peor genuina ${peorGenuina.toFixed(4)} · mejor impostora ${mejorImpostora.toFixed(4)}`,
  );
  if (peorGenuina > mejorImpostora) {
    console.log(
      `  ✓ Existe un corte que separa: cualquiera entre ${mejorImpostora.toFixed(4)} y ` +
        `${peorGenuina.toFixed(4)} (margen ${(peorGenuina - mejorImpostora).toFixed(4)}).`,
    );
  } else {
    console.log(
      '  ✗ NO hay un corte único que separe: se solapan. Eso no es un fallo del motor —es la\n' +
        '    razón por la que existe la franja de revisión entre los dos umbrales—.',
    );
  }

  /*
   * Lo que estas cifras LICENCIAN, que casi nunca es lo que parecen.
   *
   * Cero fallos no es «cero»: es un techo que depende del número de parejas. Y un acierto de uno
   * de uno no dice nada. Se imprime con el mismo instrumento que usan los corpus.
   */
  console.log('\nLo que licencia esta medición:');
  const fallosImpostores = impostoras.filter((x) => x >= peorGenuina).length;
  if (fallosImpostores === 0) {
    console.log(
      `  falsa aceptación: 0 de ${impostoras.length} → techo ${pct(zeroErrorUpperBound(impostoras.length))} ` +
        `al 95 % (regla de tres: ${pct(ruleOfThree(impostoras.length))})`,
    );
  } else {
    const ci = clopperPearson(fallosImpostores, impostoras.length);
    console.log(
      `  falsa aceptación: ${fallosImpostores} de ${impostoras.length} → ` +
        `${pct(ci.lower)} a ${pct(ci.upper)} al 95 %`,
    );
  }
  const aceptadas = genuinas.filter((x) => x >= mejorImpostora).length;
  const ciG = clopperPearson(aceptadas, genuinas.length);
  console.log(
    `  aceptación de genuinas: ${aceptadas} de ${genuinas.length} → ` +
      `${pct(ciG.lower)} a ${pct(ciG.upper)} al 95 %`,
  );
  const sujetosConGenuina = sujetos.filter((s) => docs.has(s.clave) && (selfies.get(s.clave)?.length ?? 0) > 0).length;
  if (genuinas.length < 66 || sujetosConGenuina < 20) {
    console.log(
      `\nTodavía no alcanza para calibrar: hacen falta 66 parejas genuinas de 20 sujetos ` +
        `distintos, y hay ${genuinas.length} de ${sujetosConGenuina}.`,
    );
  } else {
    console.log('\nAlcanza para calibrar: node scripts/calibrar-identidad.mjs --documento-selfie ' + raiz);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

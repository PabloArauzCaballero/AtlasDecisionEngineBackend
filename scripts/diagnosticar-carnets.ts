/**
 * DIAGNOSTICA un directorio de carnets reales, carpeta por carpeta.
 *
 *   yarn ts-node scripts/diagnosticar-carnets.ts ~/Desktop/carnets
 *   yarn ts-node scripts/diagnosticar-carnets.ts ~/Desktop/carnets --texto
 *   yarn ts-node scripts/diagnosticar-carnets.ts ~/Desktop/carnets --json /tmp/medicion.json
 *
 * Cada subdirectorio es una PERSONA con sus dos caras. Empareja por contenido y
 * no por nombre de archivo —las fotos llegan de WhatsApp con nombres que no
 * dicen qué cara son— y publica, para cada una, lo que el pipeline sacaría.
 *
 * No copia, no mueve y no escribe NADA dentro del directorio de entrada, y no
 * deja rastro en el repositorio. Sólo lee.
 *
 * ## Por qué esto es un INSTRUMENTO y no una utilidad
 *
 * Todas las carpetas que se le pasan contienen documentos AUTÉNTICOS. Eso
 * convierte al resumen final en la única medida honesta que este worker puede
 * tener hoy de su propia tasa de falsa acusación: cada `FRAUD_SUSPECTED` sobre
 * este directorio es un documento legítimo acusado, y cada `REVIEW` es una
 * persona esperando por una cola que nadie necesitaba abrir. El corpus de
 * identidad lo dice con todas las letras —una señal sin calibrar se registra,
 * no rechaza— y sin un número medido no hay forma de saber si una calibración
 * mejoró algo.
 *
 * Por eso el resumen imprime denominadores y no sólo porcentajes, y por eso
 * **una carpeta que falla no interrumpe el barrido**: un directorio vacío o una
 * imagen ilegible dejaban antes la medición a medias sin decirlo, que es la
 * forma más silenciosa de medir mal.
 *
 * El texto reconocido lleva nombre, domicilio y número de documento de personas
 * reales, así que sólo se imprime con `--texto`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
import {
  evaluarFraude,
  UMBRALES_DE_FRAUDE_POR_DEFECTO,
} from '../src/modules/workers/identity-verification/core/forensics/identity-fraud.scorer';
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

interface Medicion {
  readonly persona: string;
  readonly imagenes: number;
  readonly error?: string;
  readonly anverso?: string;
  readonly reverso?: string | null;
  readonly ladoLargo?: number;
  readonly clasificacion?: string;
  readonly confianza?: number;
  readonly generacion?: string;
  readonly cobertura?: number;
  readonly evidencia?: number;
  readonly mrz?: boolean;
  readonly mrzChecks?: Record<string, boolean | null>;
  readonly camposPresentes?: number;
  readonly avisos?: readonly string[];
  readonly fraude?: string;
  readonly riesgo?: number;
  readonly motivos?: readonly string[];
  readonly observaciones?: readonly string[];
  readonly coberturaEvaluable?: boolean;
}

async function leer(buffer: Buffer, lado: number): Promise<DocumentOcrResult> {
  const reducida = await imagenes.downscale(buffer, lado);
  return ocr.extract({ image: reducida, correlationId: 'diagnostico' });
}

function cobertura(anverso: string, reverso: string): number {
  return reconocerCedulaBoliviana({ textoAnverso: anverso, textoReverso: reverso }).mejor.cobertura;
}

/** Cuántos de los cuatro campos que un expediente necesita se llegaron a leer. */
function contarCampos(campos: Record<string, { value: string | null } | undefined>): number {
  return ['documentNumber', 'fullName', 'dateOfBirth', 'expirationDate'].filter(
    (nombre) => campos[nombre]?.value,
  ).length;
}

async function diagnosticar(carpeta: string, mostrarTexto: boolean): Promise<Medicion> {
  const persona = basename(carpeta);
  const archivos = readdirSync(carpeta)
    .filter((n) => !n.startsWith('.') && IMAGENES.has(extname(n).toLowerCase()))
    .map((n) => join(carpeta, n))
    .sort();

  console.log(`\n${'='.repeat(78)}\n${persona}  (${archivos.length} imágenes)\n${'='.repeat(78)}`);

  if (archivos.length === 0) {
    console.log('  (carpeta sin imágenes: no se mide)');
    return { persona, imagenes: 0, error: 'SIN_IMAGENES' };
  }

  // Qué cara es cada archivo: gana la que más plantilla de ANVERSO reconozca.
  const caras: Array<{ ruta: string; buffer: Buffer; anversoScore: number; reversoScore: number }> =
    [];
  for (const ruta of archivos) {
    const original = readFileSync(ruta);
    const norm = await imagenes.normalize(original);
    const enc = await imagenes.frame(norm.buffer);
    const fina = await leer(enc.buffer, IDENTITY_DEFAULTS.ocrFineLongEdge);
    caras.push({
      ruta,
      buffer: original,
      anversoScore: cobertura(fina.rawText, ''),
      reversoScore: cobertura('', fina.rawText),
    });
    console.log(
      `  ${basename(ruta).padEnd(46)} ${String(norm.quality.width).padStart(5)}x${String(norm.quality.height).padEnd(5)}` +
        ` recortado=${String(enc.recortado).padEnd(5)} área=${enc.areaConservada.toFixed(3)}` +
        ` anverso=${cobertura(fina.rawText, '').toFixed(3)} reverso=${cobertura('', fina.rawText).toFixed(3)}`,
    );
  }

  /*
   * El reparto de caras se decide por la DIFERENCIA entre las dos plantillas y
   * no por la puntuación de anverso sola.
   *
   * Con la regla anterior —ordenar por parecido al anverso y tomar el primero—
   * una foto de reverso nítida le ganaba el puesto de anverso a un anverso
   * borroso, y entonces la MRZ (que sólo está en el reverso) se buscaba en la
   * cara equivocada y el caso salía sin número ni fechas. Se observó en dos de
   * las veintitantas carpetas de prueba.
   */
  const ordenadas = [...caras].sort(
    (a, b) => b.anversoScore - b.reversoScore - (a.anversoScore - a.reversoScore),
  );
  const anverso = ordenadas[0];
  const reverso = ordenadas.length > 1 ? ordenadas[ordenadas.length - 1] : null;

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

  console.log(
    `\n  anverso: ${basename(anverso.ruta)}${reverso ? `   reverso: ${basename(reverso.ruta)}` : '   (sin reverso)'}`,
  );
  console.log(
    `  clasificación : ${clas.type}  conf=${clas.confidence.toFixed(3)}  señales=[${clas.signals.join(', ')}]`,
  );
  console.log(`  generación    : ${rec.mejor.generacion}  cobertura=${rec.mejor.cobertura.toFixed(3)}`);
  console.log(`  evidencia     : ${ev.confidence.toFixed(3)}  contra=${ev.contraindicator ?? '—'}`);
  console.log(`  MRZ           : ${mrz ? `sí  checks=${JSON.stringify(mrz.checks)}` : 'no'}`);
  const f = parsed.fields;
  const campo = (n: string, v: { value: string | null; source?: string } | undefined) =>
    `    ${n.padEnd(16)} ${String(v?.value ?? '—').padEnd(40)} [${v?.source ?? '—'}]`;
  console.log('  CAMPOS:');
  for (const nombre of [
    'documentNumber',
    'fullName',
    'firstNames',
    'lastNames',
    'dateOfBirth',
    'issueDate',
    'expirationDate',
    'placeOfBirth',
  ]) {
    console.log(campo(nombre, (f as Record<string, { value: string | null; source?: string }>)[nombre]));
  }
  console.log(`  AVISOS: ${parsed.warnings.length ? parsed.warnings.join(', ') : '—'}`);

  const plantilla = analizarPlantilla({
    textoAnverso: front.rawText,
    textoReverso: back?.rawText ?? '',
    campos: parsed.fields,
    mrz,
    ahora: new Date(),
    ladoLargoPx: Math.max(norm.quality.width, norm.quality.height),
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
    `  observaciones : ${plantilla.observaciones.map((o) => o.codigo).join(', ') || '—'}` +
      `${plantilla.coberturaEvaluable ? '' : '  [plantilla NO evaluable por resolución]'}`,
  );
  console.log(
    `  pixeles       : ${manipulacion.senales.map((s) => s.codigo).join(', ') || '—'}` +
      `  ${JSON.stringify(manipulacion.medidas)}`,
  );

  if (mostrarTexto) {
    console.log('\n  --- texto ANVERSO -------------------------------------------------------');
    console.log(
      front.rawText
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => `  | ${l}`)
        .join('\n'),
    );
    if (back) {
      console.log('  --- texto REVERSO -------------------------------------------------------');
      console.log(
        back.rawText
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => `  | ${l}`)
          .join('\n'),
      );
    }
  }

  return {
    persona,
    imagenes: archivos.length,
    anverso: basename(anverso.ruta),
    reverso: reverso ? basename(reverso.ruta) : null,
    ladoLargo: Math.max(norm.quality.width, norm.quality.height),
    clasificacion: clas.type,
    confianza: Number(clas.confidence.toFixed(3)),
    generacion: rec.mejor.generacion,
    cobertura: Number(rec.mejor.cobertura.toFixed(3)),
    evidencia: Number(ev.confidence.toFixed(3)),
    mrz: mrz !== null,
    mrzChecks: mrz ? (mrz.checks as unknown as Record<string, boolean | null>) : undefined,
    camposPresentes: contarCampos(parsed.fields as never),
    avisos: parsed.warnings,
    fraude: fraude.veredicto,
    riesgo: fraude.riesgo,
    motivos: fraude.motivos,
    observaciones: fraude.observaciones,
    coberturaEvaluable: plantilla.coberturaEvaluable,
  };
}

/**
 * El resumen, que es para lo que existe el script.
 *
 * Lleva denominadores en todas las filas: «6 de 23» dice algo que «26 %» no
 * dice, y la diferencia importa cuando la muestra son veintitantas personas.
 */
function resumir(mediciones: readonly Medicion[]): void {
  const medidas = mediciones.filter((m) => !m.error);
  const n = medidas.length;
  console.log(`\n${'='.repeat(78)}\nRESUMEN — ${n} documentos AUTÉNTICOS medidos`);
  console.log(`${'='.repeat(78)}`);
  if (n === 0) return;

  const sinMedir = mediciones.filter((m) => m.error);
  if (sinMedir.length > 0) {
    console.log(`  sin medir      : ${sinMedir.map((m) => `${m.persona} (${m.error})`).join(', ')}`);
  }

  const cuenta = (predicado: (m: Medicion) => boolean): string => {
    const k = medidas.filter(predicado).length;
    return `${k}/${n} (${((100 * k) / n).toFixed(0)} %)`;
  };
  const mediana = (valores: number[]): number => {
    const orden = [...valores].sort((a, b) => a - b);
    return orden.length === 0 ? 0 : orden[Math.floor(orden.length / 2)];
  };

  console.log(`  clasificadas CI: ${cuenta((m) => m.clasificacion === 'BOLIVIA_CI')}`);
  console.log(`  con MRZ leída  : ${cuenta((m) => m.mrz === true)}`);
  console.log(
    `  MRZ con algún control fallido: ${cuenta((m) => Object.values(m.mrzChecks ?? {}).some((v) => v === false))}`,
  );
  console.log(`  los 4 campos   : ${cuenta((m) => m.camposPresentes === 4)}`);
  console.log(
    `  cobertura      : mediana ${mediana(medidas.map((m) => m.cobertura ?? 0)).toFixed(3)}` +
      `  mín ${Math.min(...medidas.map((m) => m.cobertura ?? 0)).toFixed(3)}` +
      `  máx ${Math.max(...medidas.map((m) => m.cobertura ?? 0)).toFixed(3)}`,
  );
  console.log(
    `  lado largo     : mediana ${mediana(medidas.map((m) => m.ladoLargo ?? 0))} px` +
      `  mín ${Math.min(...medidas.map((m) => m.ladoLargo ?? 0))}  máx ${Math.max(...medidas.map((m) => m.ladoLargo ?? 0))}`,
  );
  console.log('\n  LO QUE LE PASA A UN DOCUMENTO AUTÉNTICO:');
  console.log(`    CLEAR            : ${cuenta((m) => m.fraude === 'CLEAR')}`);
  console.log(`    REVIEW           : ${cuenta((m) => m.fraude === 'REVIEW')}   <- cola humana`);
  console.log(
    `    FRAUD_SUSPECTED  : ${cuenta((m) => m.fraude === 'FRAUD_SUSPECTED')}   <- acusación falsa`,
  );

  const motivos = new Map<string, number>();
  for (const m of medidas) for (const motivo of m.motivos ?? []) {
    motivos.set(motivo, (motivos.get(motivo) ?? 0) + 1);
  }
  console.log('\n  MOTIVOS levantados sobre documentos auténticos:');
  for (const [motivo, veces] of [...motivos].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${motivo.padEnd(34)} ${veces}/${n}`);
  }

  const noEvaluables = medidas.filter((m) => m.coberturaEvaluable === false).length;
  console.log(
    `\n  plantilla NO evaluable por resolución: ${noEvaluables}/${n} ` +
      `(${((100 * noEvaluables) / n).toFixed(0)} %) — a esas se les pide otra captura, no se las acusa`,
  );

  const observaciones = new Map<string, number>();
  for (const m of medidas) for (const nota of m.observaciones ?? []) {
    observaciones.set(nota, (observaciones.get(nota) ?? 0) + 1);
  }
  if (observaciones.size > 0) {
    console.log('\n  OBSERVACIONES (se registran, no acusan):');
    for (const [nota, veces] of [...observaciones].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${nota.padEnd(34)} ${veces}/${n}`);
    }
  }

  const avisos = new Map<string, number>();
  for (const m of medidas) for (const aviso of m.avisos ?? []) {
    avisos.set(aviso, (avisos.get(aviso) ?? 0) + 1);
  }
  console.log('\n  AVISOS del analizador:');
  for (const [aviso, veces] of [...avisos].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${aviso.padEnd(34)} ${veces}/${n}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mostrarTexto = args.includes('--texto');
  const jsonIndex = args.indexOf('--json');
  const jsonDestino = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
  const raiz = resolve(args.find((a) => !a.startsWith('--') && a !== jsonDestino) ?? '');

  if (!raiz || !statSync(raiz).isDirectory()) {
    console.error('Uso: yarn ts-node scripts/diagnosticar-carnets.ts <directorio> [--texto] [--json <archivo>]');
    process.exit(1);
  }

  const personas = readdirSync(raiz)
    .filter((n) => !n.startsWith('.'))
    .map((n) => join(raiz, n))
    .filter((r) => statSync(r).isDirectory());

  const mediciones: Medicion[] = [];
  for (const carpeta of personas) {
    try {
      mediciones.push(await diagnosticar(carpeta, mostrarTexto));
    } catch (error) {
      /*
       * Una carpeta que revienta NO interrumpe el barrido, y se declara.
       *
       * Antes sí lo hacía: una sola carpeta vacía dejó una medición en diez de
       * veintiséis personas sin que el resumen dijera que faltaban dieciséis.
       */
      const detalle = error instanceof Error ? error.message : String(error);
      console.log(`  ERROR: ${detalle}`);
      mediciones.push({ persona: basename(carpeta), imagenes: 0, error: detalle });
    }
  }

  resumir(mediciones);

  if (jsonDestino) {
    writeFileSync(resolve(jsonDestino), `${JSON.stringify(mediciones, null, 1)}\n`);
    console.log(`\n  medición completa en ${resolve(jsonDestino)}`);
  }

  await ocr.onModuleDestroy();
}

void main();

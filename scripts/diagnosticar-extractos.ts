/**
 * DICE QUÉ COMPUERTA detuvo cada extracto, y con qué puntaje.
 *
 * ## Para qué existe
 *
 * Cuando el motor rechaza, el cliente recibe una frase accionable y la fila
 * guarda un código. Ninguna de las dos cosas responde la pregunta de quien está
 * calibrando el motor: «de veinte extractos que se caen, ¿cuántos mueren en el
 * contenedor, cuántos en el emisor y cuántos por vigencia?». Sin esa cuenta se
 * calibra a ciegas —se baja un umbral, se vuelve a probar, y no se sabe si el
 * cambio tocó el caso que importaba—.
 *
 * Este comando corre las CUATRO compuertas sobre cada archivo, las corre TODAS
 * aunque la primera ya haya decidido, y enseña el resultado de cada una. Es la
 * diferencia con subir el PDF y leer el error: el error dice la primera causa;
 * esto dice todas, que es lo que permite arreglar dos de una vez.
 *
 *   yarn ts-node -P tsconfig.json -T scripts/diagnosticar-extractos.ts <archivo|carpeta>...
 *   yarn ts-node -P tsconfig.json -T scripts/diagnosticar-extractos.ts ~/extractos --json
 *
 * ## Lo que NO hace
 *
 * No toca la base de datos. El padrón que usa es la nómina compilada de ASFI, no
 * la tabla administrada del tenant, así que un marcador que alguien añadió desde
 * el portal no cuenta aquí. Es deliberado: el comando tiene que poder correrse
 * sobre un portátil sin levantar Postgres, y para la pregunta que responde —qué
 * compuerta pesa— la nómina compilada basta.
 *
 * Tampoco guarda nada ni manda el documento a ninguna parte.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { assessAuthenticity } from '../src/modules/workers/bank-statement/core/engine/authenticity/authenticity-gate';
import { assessIssuer } from '../src/modules/workers/bank-statement/core/engine/issuer-gate';
import { assessRecency } from '../src/modules/workers/bank-statement/core/engine/recency/recency-gate';
import { StatementProcessingError } from '../src/modules/workers/bank-statement/core/domain/errors';
import { createStatementEngine } from '../src/modules/workers/bank-statement/core/statement-engine';

interface Diagnostico {
  readonly archivo: string;
  readonly bytes: number;
  readonly contenedor: { veredicto: string; puntaje: number; senales: string[] };
  readonly contenido: { tipo: string; veredicto: string; confianza: number } | null;
  readonly emisor: { veredicto: string; entidad: string; motivos: string[] } | null;
  readonly vigencia: { veredicto: string; cierre: string | null; antiguedadDias: number | null } | null;
  readonly cobertura: { mesesCompletos: number; exigidos: number; satisfecha: boolean } | null;
  readonly desenlace: string;
  readonly detenidoPor: string | null;
}

function esPdf(ruta: string): boolean {
  return extname(ruta).toLowerCase() === '.pdf';
}

/** Recorre carpetas de un nivel. Más profundidad invitaría a barrer el disco. */
function expandir(entradas: readonly string[]): string[] {
  const salida: string[] = [];
  for (const entrada of entradas) {
    const ruta = resolve(entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...readdirSync(ruta).map((n) => join(ruta, n)).filter(esPdf));
    } else if (esPdf(ruta)) {
      salida.push(ruta);
    }
  }
  return salida.sort();
}

/**
 * El motor con TODAS las compuertas en medición.
 *
 * Es lo que permite ver qué habría pasado en cada etapa en vez de detenerse en la
 * primera: con las compuertas exigiendo, un documento que falla el contenedor no
 * llega nunca a decir de qué banco es, y esa es justo la mitad del diagnóstico.
 */
function motorEnMedicion() {
  return createStatementEngine({
    limits: { maxFileSizeBytes: 20 * 1_048_576, maxPageCount: 120, processingTimeoutMs: 120_000 },
    issuerGate: { requireLicensedIssuer: false },
    authenticityGate: { enforce: false },
    affordability: { enforceMinimumMonths: false },
    recencyGate: { enforce: false },
  });
}

async function diagnosticar(ruta: string): Promise<Diagnostico> {
  const bytes = readFileSync(ruta);
  const engine = motorEnMedicion();

  // El contenedor se puede juzgar sin abrir el documento, así que se juzga
  // primero y por separado: es la única compuerta que sigue respondiendo cuando
  // el PDF no se deja leer.
  const contenedor = assessAuthenticity(bytes, 1, {
    enforce: false,
    rejectScore: 70,
    reviewScore: 30,
  });

  const base = {
    archivo: ruta,
    bytes: bytes.byteLength,
    contenedor: {
      veredicto: contenedor.verdict,
      puntaje: contenedor.report.suspicionScore,
      senales: contenedor.report.signals.map((s) => `${s.code}(${String(s.weight)})`),
    },
  };

  try {
    const analisis = await engine.analyze(bytes, { fileName: ruta });
    const emisor = assessIssuer(analisis.context.institution, { requireLicensedIssuer: true });
    const vigencia = assessRecency(analisis.affordability.coverage.to);
    const detenidoPor = primeraQueDetiene(
      contenedor.report.suspicionScore,
      emisor.disposition,
      analisis.affordability.coverage.satisfied,
      vigencia.disposition,
    );
    return {
      ...base,
      contenido: {
        tipo: analisis.context.classification.documentType,
        veredicto: analisis.context.classification.verdict,
        confianza: analisis.context.classification.confidence,
      },
      emisor: {
        veredicto: emisor.verdict,
        entidad: analisis.context.institution.name ?? analisis.context.institution.code,
        motivos: [...emisor.reasons],
      },
      vigencia: {
        veredicto: vigencia.verdict,
        cierre: vigencia.periodTo,
        antiguedadDias: vigencia.ageDays,
      },
      cobertura: {
        mesesCompletos: analisis.affordability.coverage.monthsComplete,
        exigidos: analisis.affordability.coverage.minimumMonthsRequired,
        satisfecha: analisis.affordability.coverage.satisfied,
      },
      desenlace: detenidoPor ? 'SE DETENDRÍA' : 'PASARÍA',
      detenidoPor,
    };
  } catch (error) {
    /*
     * Con contenedor, emisor, cobertura y vigencia en medición, lo que queda que
     * pueda detener el documento es el ARCHIVO —no se abre— o el CLASIFICADOR,
     * que no tiene modo de medición porque sin él no hay nada que analizar. El
     * código distingue los dos casos, así que se publica tal cual en vez de
     * resumirlo en «no se pudo leer», que sería falso para la mitad de ellos.
     */
    const codigo = error instanceof StatementProcessingError ? error.code : 'ERROR_NO_CONTROLADO';
    return {
      ...base,
      contenido: null,
      emisor: null,
      vigencia: null,
      cobertura: null,
      desenlace: 'NO LLEGÓ AL ANÁLISIS',
      detenidoPor: codigo,
    };
  }
}

/** La primera compuerta que detendría el documento con la configuración por defecto. */
function primeraQueDetiene(
  puntaje: number,
  emisor: string,
  coberturaOk: boolean,
  vigencia: string,
): string | null {
  if (puntaje >= 70) return 'CONTENEDOR (rechazo por manipulación)';
  if (puntaje >= 30) return 'CONTENEDOR (revisión por sospecha)';
  if (emisor !== 'ACCEPT') return `EMISOR (${emisor})`;
  if (vigencia !== 'ACCEPT') return `VIGENCIA (${vigencia})`;
  // La cobertura va la última porque por omisión ya no detiene: sólo advierte.
  if (!coberturaOk) return null;
  return null;
}

function imprimir(d: Diagnostico): void {
  console.log(`\n── ${d.archivo}  (${String(Math.round(d.bytes / 1024))} KiB)`);
  console.log(
    `   contenedor : ${d.contenedor.veredicto} · puntaje ${String(d.contenedor.puntaje)}` +
      (d.contenedor.senales.length > 0 ? `\n                ${d.contenedor.senales.join(', ')}` : ''),
  );
  if (d.contenido) {
    console.log(
      `   contenido  : ${d.contenido.veredicto} · ${d.contenido.tipo} · confianza ${d.contenido.confianza.toFixed(2)}`,
    );
  }
  if (d.emisor) {
    console.log(`   emisor     : ${d.emisor.veredicto} · ${d.emisor.entidad} · ${d.emisor.motivos.join(', ')}`);
  }
  if (d.vigencia) {
    console.log(
      `   vigencia   : ${d.vigencia.veredicto} · cierra ${d.vigencia.cierre ?? '?'} · ` +
        `hace ${String(d.vigencia.antiguedadDias ?? 0)} día(s)`,
    );
  }
  if (d.cobertura) {
    console.log(
      `   cobertura  : ${String(d.cobertura.mesesCompletos)}/${String(d.cobertura.exigidos)} mes(es) completos` +
        (d.cobertura.satisfecha ? '' : '  ← advertencia, ya no rechaza'),
    );
  }
  console.log(`   ▸ ${d.desenlace}${d.detenidoPor ? ` — ${d.detenidoPor}` : ''}`);
}

async function main(): Promise<void> {
  const argumentos = process.argv.slice(2);
  const comoJson = argumentos.includes('--json');
  const rutas = expandir(argumentos.filter((a) => !a.startsWith('--')));

  if (rutas.length === 0) {
    console.error(
      'Uso: yarn ts-node -P tsconfig.json -T scripts/diagnosticar-extractos.ts <archivo.pdf|carpeta>... [--json]',
    );
    process.exitCode = 1;
    return;
  }

  const resultados: Diagnostico[] = [];
  for (const ruta of rutas) {
    const diagnostico = await diagnosticar(ruta);
    resultados.push(diagnostico);
    if (!comoJson) imprimir(diagnostico);
  }

  if (comoJson) {
    console.log(JSON.stringify(resultados, null, 2));
    return;
  }

  // El recuento es el objetivo del comando: un archivo se mira, veinte se cuentan.
  const porCausa = new Map<string, number>();
  for (const r of resultados) {
    const clave = r.detenidoPor ?? 'PASA';
    porCausa.set(clave, (porCausa.get(clave) ?? 0) + 1);
  }
  console.log(`\n═══ ${String(resultados.length)} documento(s)`);
  for (const [causa, cuantos] of [...porCausa.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(cuantos).padStart(4)}  ${causa}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

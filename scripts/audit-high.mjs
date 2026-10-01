#!/usr/bin/env node
/**
 * Bloquea por avisos ALTOS de verdad, y sólo sobre una auditoría COMPLETA (ATL-11).
 *
 * En yarn 1, `--level` filtra lo que se IMPRIME; el código de salida es un mapa de bits con TODAS las
 * severidades (1 INFO · 2 LOW · 4 MODERATE · 8 HIGH · 16 CRITICAL). Pero un error operativo de yarn
 * (DNS, 5xx, registro caído) sale con 1, igual que «sólo INFO». La versión anterior de este script
 * ignoraba el código y contaba los avisos que encontrara: una auditoría que no llegó a hacerse
 * (sin red, JSON a medias, código 32) daba «sin avisos» y salía con 0, un verde falso.
 *
 * Ahora la ejecución se acepta sólo si trae un resumen terminal válido que cuadre con el código de
 * salida (ver `lib/parse-yarn-classic-audit.mjs`, protocolo de yarn 1.22.x). Sólo entonces se aplica la
 * política: bloquean high y critical; el resto se informa.
 *
 *   node scripts/audit-high.mjs                 # dependencias de producción
 *   node scripts/audit-high.mjs --todos         # incluye las de desarrollo
 *
 * Salida: 0 sin bloqueantes · 1 hay high/critical · 3 la auditoría no se completó (nunca es «limpio»).
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { parseCompletedAudit } from './lib/parse-yarn-classic-audit.mjs';

const BLOQUEANTES = new Set(['high', 'critical']);
const ORDEN = ['critical', 'high', 'moderate', 'low', 'info'];
const PRESUPUESTO_MS = 300_000;
const MAX_SALIDA = 16 * 1024 * 1024;

function ejecutarAudit(incluirDesarrollo) {
  const args = ['audit', '--json', ...(incluirDesarrollo ? [] : ['--groups', 'dependencies'])];
  return new Promise((resolve) => {
    const salida = {
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      timedOut: false,
      truncated: false,
      spawnError: null,
    };
    // Windows (Node 24) se niega a lanzar `yarn.cmd` sin shell; el comando es CONSTANTE, no entra texto externo.
    const proceso =
      process.platform === 'win32'
        ? spawn(`yarn ${args.join(' ')}`, { shell: true })
        : spawn('yarn', args, { shell: false });
    let bytes = 0;
    const matar = () => {
      proceso.kill('SIGTERM');
      setTimeout(() => proceso.kill('SIGKILL'), 2_000).unref();
    };
    const plazo = setTimeout(() => {
      salida.timedOut = true;
      matar();
    }, PRESUPUESTO_MS);
    const juntar = (canal) => (trozo) => {
      bytes += trozo.length;
      if (bytes > MAX_SALIDA) {
        if (!salida.truncated) {
          salida.truncated = true;
          matar();
        }
        return;
      }
      salida[canal] += trozo;
    };
    proceso.stdout.on('data', juntar('stdout'));
    proceso.stderr.on('data', juntar('stderr'));
    proceso.on('error', (error) => {
      salida.spawnError = error.message;
      clearTimeout(plazo);
      resolve(salida);
    });
    proceso.on('close', (codigo, senal) => {
      clearTimeout(plazo);
      salida.exitCode = codigo;
      salida.signal = senal;
      resolve(salida);
    });
  });
}

const incluirDesarrollo = process.argv.includes('--todos');
const ambito = incluirDesarrollo ? 'todas las dependencias' : 'dependencias de producción';
const resultado = parseCompletedAudit(await ejecutarAudit(incluirDesarrollo));

if (!resultado.ok) {
  console.error(
    `\nLa auditoría de ${ambito} NO se completó (${resultado.kind}): ${resultado.reason}.\n` +
      'Sin un reporte completo no se puede afirmar que no haya avisos altos: se rechaza.',
  );
  process.exit(3);
}

// Por id: el mismo aviso aparece una vez por cada ruta de dependencia que lo alcanza.
const porId = new Map(resultado.advisories.map((aviso) => [aviso.id, aviso]));
const porSeveridad = new Map(ORDEN.map((s) => [s, []]));
for (const aviso of porId.values()) porSeveridad.get(aviso.severity)?.push(aviso);

const conteo = resultado.summary.vulnerabilities;
const resumen = ORDEN.filter((s) => conteo[s] > 0)
  .map((s) => `${conteo[s]} ${s}`)
  .join(' · ');
console.log(
  `Auditoría de ${ambito} (${resultado.summary.totalDependencies} paquetes): ${resumen || 'sin avisos'}.`,
);

for (const severidad of ORDEN) {
  for (const aviso of porSeveridad.get(severidad)) {
    const marca = BLOQUEANTES.has(severidad) ? 'BLOQUEA' : 'informa';
    console.log(`  [${marca}] ${severidad.padEnd(8)} ${aviso.module ?? aviso.id}`);
  }
}

const bloquean = [...BLOQUEANTES].reduce((total, s) => total + conteo[s], 0);
if (bloquean > 0) {
  console.error(
    `\n${bloquean} aviso(s) de severidad alta o crítica en ${ambito}. Actualice el paquete o fije una resolución antes de desplegar.`,
  );
  process.exit(1);
}

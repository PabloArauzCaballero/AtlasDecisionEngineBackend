#!/usr/bin/env node
/**
 * Bloquea por avisos ALTOS de verdad, que es lo que `yarn audit --level high` NO hace.
 *
 * En yarn 1, `--level` filtra lo que se IMPRIME; el código de salida es un mapa de bits con
 * TODAS las severidades encontradas:
 *
 *     1 INFO · 2 LOW · 4 MODERATE · 8 HIGH · 16 CRITICAL
 *
 * Así que `yarn audit --level high --groups dependencies` sale con 6 cuando lo único que hay
 * son dos avisos bajos y dos moderados. Medido en este repositorio: cero avisos altos y salida
 * 6. El trabajo `supply-chain` de la CI —cuyo comentario dice literalmente «Bloquea por avisos
 * ALTOS en lo que se despliega»— llevaba rojo por avisos que su autor había decidido no
 * bloquear, y el argumento escrito allí para no bloquear por los de desarrollo («una puerta que
 * hay que sortear a mano cada semana acaba desactivada») describe exactamente lo que le pasaba
 * a esta puerta.
 *
 * Lo que hace este script: pide el informe en JSON, cuenta por severidad, imprime el desglose
 * entero —los bajos y moderados siguen viéndose, que para eso está el inventario— y sale con
 * código distinto de cero SÓLO si hay altos o críticos.
 *
 *   node scripts/audit-high.mjs                 # dependencias de producción
 *   node scripts/audit-high.mjs --todos         # incluye las de desarrollo
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

/** Severidades que bloquean. El resto se informa y no para la corrida. */
const BLOQUEANTES = new Set(['high', 'critical']);
const ORDEN = ['critical', 'high', 'moderate', 'low', 'info'];

function ejecutarAudit(incluirDesarrollo) {
  /*
   * Una ÚNICA cadena con `shell: true`, y no un array de argumentos.
   *
   * Las dos alternativas fallan aquí. Sin shell, Node 24 se niega a lanzar `yarn.cmd` en
   * Windows (`EINVAL`: ya no ejecuta `.cmd` directamente, por seguridad). Con shell Y un array,
   * Node concatena los argumentos sin escaparlos y avisa de ello (DEP0190).
   *
   * Con una cadena literal no hay nada que escapar: el comando es constante, no entra ni un
   * carácter que venga de fuera. Si algún día hubiera que interpolar algo, esta decisión deja
   * de valer y habría que volver al array.
   */
  const comando = incluirDesarrollo
    ? 'yarn audit --json'
    : 'yarn audit --json --groups dependencies';
  return new Promise((resolve, reject) => {
    const proceso = spawn(comando, { shell: true });
    let salida = '';
    proceso.stdout.on('data', (trozo) => (salida += trozo));
    proceso.on('error', reject);
    // El código de salida se IGNORA a propósito: es el mapa de bits que este script existe para
    // no obedecer. Lo que decide es el contenido del informe.
    proceso.on('close', () => resolve(salida));
  });
}

function avisosDe(salida) {
  const avisos = new Map();
  for (const linea of salida.split('\n')) {
    if (!linea.trim()) continue;
    let evento;
    try {
      evento = JSON.parse(linea);
    } catch {
      continue; // Líneas de progreso que no son JSON; no son un error.
    }
    if (evento.type !== 'auditAdvisory') continue;
    const aviso = evento.data?.advisory;
    if (!aviso) continue;
    // Por id: el mismo aviso aparece una vez por cada ruta de dependencia que lo alcanza, y
    // contarlo cinco veces convertiría un problema en cinco.
    avisos.set(aviso.id, aviso);
  }
  return [...avisos.values()];
}

const incluirDesarrollo = process.argv.includes('--todos');
const avisos = avisosDe(await ejecutarAudit(incluirDesarrollo));

const porSeveridad = new Map(ORDEN.map((s) => [s, []]));
for (const aviso of avisos) {
  porSeveridad.get(aviso.severity)?.push(aviso);
}

const ambito = incluirDesarrollo ? 'todas las dependencias' : 'dependencias de producción';
const resumen = ORDEN.filter((s) => porSeveridad.get(s).length)
  .map((s) => `${porSeveridad.get(s).length} ${s}`)
  .join(' · ');
console.log(`Auditoría de ${ambito}: ${resumen || 'sin avisos'}.`);

for (const severidad of ORDEN) {
  for (const aviso of porSeveridad.get(severidad)) {
    const marca = BLOQUEANTES.has(severidad) ? 'BLOQUEA' : 'informa';
    console.log(
      `  [${marca}] ${severidad.padEnd(8)} ${aviso.module_name} — ${aviso.title}` +
        (aviso.patched_versions ? ` (parcheado en ${aviso.patched_versions})` : ''),
    );
  }
}

const bloqueantes = ORDEN.filter((s) => BLOQUEANTES.has(s)).flatMap((s) => porSeveridad.get(s));
if (bloqueantes.length) {
  console.error(
    `\n${bloqueantes.length} aviso(s) de severidad alta o crítica en ${ambito}. ` +
      'Actualice el paquete o fije una resolución antes de desplegar.',
  );
  process.exit(1);
}

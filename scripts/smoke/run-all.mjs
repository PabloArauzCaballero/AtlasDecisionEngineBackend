#!/usr/bin/env node
/**
 * Smoke integral de los tres tipos de usuario, en orden.
 *
 * El orden no es decorativo: el ciclo de vida de un algoritmo NO cabe en una sola
 * identidad. La segregación de funciones exige que quien escribe no apruebe y que quien
 * aprueba no despliegue, así que el autor deja el artefacto compilado y en revisión, el
 * aprobador lo aprueba y el operador lo despliega y lo ejecuta. Correrlos en otro orden
 * mediría estados que en producción no existen.
 *
 * Uso: node scripts/smoke/run-all.mjs
 * Evidencia: smoke/out/{author,approver,operator,access,summary}.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, OUT_DIR } from './lib/config.mjs';
import { Reporter } from './lib/report.mjs';
import { provisionApiKeyClients, resolvePrincipal, USER_ORDER } from './lib/principals.mjs';
import { saveState } from './lib/state.mjs';
import { BUILD_DOMAINS, CONSUME_DOMAINS, openReporter, runDomains, runRuntimeAudience } from './run-user.mjs';
import * as access from './scenarios/access.mjs';
import { request } from './lib/http.mjs';

async function assertReachable() {
  const health = await request({ method: 'GET', path: '/health' });
  if (health.status === 0) {
    throw new Error(
      `No hay nadie escuchando en ${config.baseUrl} (${health.networkError}). Arranca la API antes de correr el smoke.`,
    );
  }
  if (health.status >= 500) {
    throw new Error(`La API en ${config.baseUrl} respondió ${health.status} a /health. No tiene sentido seguir.`);
  }
}

async function main() {
  console.log(`\n╔═ Smoke integral de Atlas Decision Engine`);
  console.log(`║  destino: ${config.baseUrl} · tenant ${config.tenantId} · corrida ${config.runTag}`);
  console.log(`╚═ tres tipos de usuario, en orden: ${USER_ORDER.join(' → ')}\n`);

  await assertReachable();
  // Se registra una sola vez para toda la tanda: cada smoke suelto lo repetiría sin daño,
  // pero repetirlo tres veces sólo alarga la corrida.
  await provisionApiKeyClients();

  const state = {};
  const reports = [];

  /**
   * Dos pasadas, y el orden de cada una tiene su razón.
   *
   * La primera CONSTRUYE: el autor deja el artefacto compilado y en revisión, el aprobador
   * lo aprueba y el operador lo despliega. La segunda CONSUME lo construido: ejecutar una
   * decisión y leer la bandeja sólo son posibles cuando ya hay algo desplegado y el
   * gobierno ya emitió sus eventos. Intentarlo en una sola pasada dejaba sin comprobar,
   * para dos de los tres usuarios, justo las rutas que dependen del resultado del tercero.
   */
  const sessions = [];
  for (const userTypeKey of USER_ORDER) {
    const { reporter } = await openReporter(userTypeKey);
    const principal = await resolvePrincipal(userTypeKey);
    console.log(`   contra ${config.baseUrl}, tenant ${config.tenantId}\n`);
    await runDomains({ reporter, principal, state, domains: BUILD_DOMAINS });
    sessions.push({ userTypeKey, reporter, principal });
    await saveState(state);
  }

  // La decisión en línea la ejecuta la credencial de audiencia `runtime`, y deja la
  // evidencia auditada que la segunda pasada va a leer.
  console.log('\n══ Ejecución en línea (audiencia runtime)');
  await runRuntimeAudience({ reporter: sessions.at(-1).reporter, state });
  await saveState(state);

  console.log('\n══ Segunda pasada: lo que depende de lo ya construido');
  for (const session of sessions) {
    console.log(`\n── ${session.userTypeKey}`);
    await runDomains({
      reporter: session.reporter,
      principal: session.principal,
      state,
      domains: CONSUME_DOMAINS,
    });
    const { report } = await session.reporter.write(`${session.userTypeKey}.json`);
    reports.push({ userType: session.userTypeKey, report });
    await saveState(state);
  }

  // La frontera de autenticación se recorre al final, cuando ya existe un artefacto
  // desplegado contra el que intentar entrar sin ser nadie.
  const accessReporter = new Reporter({
    userType: 'access',
    roles: [],
    authMethod: 'varias',
    principalId: 'frontera',
  });
  console.log('\n══ Frontera de autenticación (sin credencial, credencial inválida, audiencia y tenant ajenos)');
  try {
    await access.run({ reporter: accessReporter, state });
  } catch (error) {
    accessReporter.record({
      id: 'access.dominio',
      title: 'la frontera de autenticación se recorre entera',
      expected: 'sin excepciones no controladas',
      outcome: 'FAIL',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const accessWritten = await accessReporter.write('access.json');
  reports.push({ userType: 'access', report: accessWritten.report });
  console.log(
    `\n   ${accessWritten.report.summary.passed}/${accessWritten.report.summary.total} en verde · ` +
      `${accessWritten.report.summary.failed} fallo(s)`,
  );

  // --- Resumen de la tanda. ----------------------------------------------------------
  const totals = reports.reduce(
    (acc, { report }) => ({
      total: acc.total + report.summary.total,
      passed: acc.passed + report.summary.passed,
      failed: acc.failed + report.summary.failed,
      skipped: acc.skipped + report.summary.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );

  // Catálogo agregado: si aquí aparece INTERNAL_ERROR, el motor devolvió algo que no
  // forma parte de su contrato, y eso importa más que el recuento de fallos.
  const errorCatalog = {};
  for (const { userType, report } of reports) {
    for (const [code, bucket] of Object.entries(report.errorCatalog)) {
      const entry = (errorCatalog[code] ??= { count: 0, statuses: [], seenBy: [] });
      entry.count += bucket.count;
      for (const status of bucket.statuses) if (!entry.statuses.includes(status)) entry.statuses.push(status);
      if (!entry.seenBy.includes(userType)) entry.seenBy.push(userType);
    }
  }

  const uncatalogued = Object.keys(errorCatalog).filter((code) => code === 'INTERNAL_ERROR');

  const summary = {
    startedAt: reports[0]?.report.startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    tenantId: config.tenantId,
    runTag: config.runTag,
    order: USER_ORDER,
    totals: { ...totals, allPassed: totals.failed === 0 },
    uncataloguedErrors: uncatalogued,
    errorCatalog,
    runs: reports.map(({ userType, report }) => ({
      userType,
      authMethod: report.authMethod,
      roles: report.roles,
      file: `${userType}.json`,
      summary: report.summary,
    })),
    lifecycle: state.lifecycle ?? null,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await saveState(state);

  console.log('\n╔═ Resumen de la tanda');
  for (const run of summary.runs) {
    const badge = run.summary.allPassed ? 'VERDE' : `ROJO (${run.summary.failed})`;
    console.log(`║  ${run.userType.padEnd(9)} ${String(run.summary.passed).padStart(4)}/${String(run.summary.total).padEnd(4)} ${badge}`);
    if (!run.summary.allPassed) {
      for (const id of run.summary.failedIds.slice(0, 10)) console.log(`║      ✗ ${id}`);
      if (run.summary.failedIds.length > 10) console.log(`║      … y ${run.summary.failedIds.length - 10} más`);
    }
  }
  console.log(`║`);
  console.log(`║  total: ${totals.passed}/${totals.total} · ${totals.failed} fallo(s) · ${totals.skipped} omitida(s)`);
  if (uncatalogued.length) {
    console.log(`║  ATENCIÓN: se observaron errores sin catalogar: ${uncatalogued.join(', ')}`);
  }
  console.log(`╚═ evidencia en ${OUT_DIR}\n`);

  return totals.failed === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`\nLa tanda no pudo completarse: ${error instanceof Error ? error.message : error}\n`);
    process.exit(2);
  });

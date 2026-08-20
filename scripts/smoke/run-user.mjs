#!/usr/bin/env node
/**
 * Smoke integral de UN tipo de usuario.
 *
 * Recorre la superficie completa con la credencial de ese usuario: donde sus roles llegan
 * exige que el payload correcto funcione y que cada payload roto sea rechazado con un
 * código catalogado; donde no llegan exige un 403. La evidencia queda en
 * `smoke/out/<usuario>.json` con un identificador estable por comprobación.
 *
 * Uso: node scripts/smoke/run-user.mjs <author|approver|operator>
 */
import { config } from './lib/config.mjs';
import { Reporter } from './lib/report.mjs';
import { createProbe } from './lib/probe.mjs';
import { provisionApiKeyClients, resolvePrincipal, runtimePrincipal, USER_TYPES } from './lib/principals.mjs';
import { loadState, saveState } from './lib/state.mjs';
import { setActor } from './lib/fixtures.mjs';

import * as platform from './scenarios/platform.mjs';
import * as authoring from './scenarios/authoring.mjs';
import * as quality from './scenarios/quality.mjs';
import * as operations from './scenarios/operations.mjs';
import * as runtimeScenario from './scenarios/runtime.mjs';
import * as workers from './scenarios/workers.mjs';
import * as inbox from './scenarios/inbox.mjs';

/**
 * Todos los usuarios recorren todos los dominios.
 *
 * Es deliberado: la mitad del valor de este smoke está en las denegaciones. Que el
 * aprobador reciba 403 al intentar desplegar es una comprobación tan real como que el
 * operador consiga desplegar, y sólo se obtiene haciendo que cada usuario lo intente todo.
 */
export const DOMAINS = {
  platform,
  authoring,
  quality,
  operations,
  workers,
  runtime: runtimeScenario,
  inbox,
};

/**
 * Orden por pasadas.
 *
 * `build` produce el estado; `runtime` e `inbox` lo CONSUMEN y por eso no pueden correr
 * antes de que exista: no hay decisión que ejecutar hasta que alguien despliega, ni
 * notificación que leer hasta que el gobierno emitió sus eventos. Separarlo en pasadas es
 * lo que permite que ninguna comprobación quede sin intentar.
 */
export const BUILD_DOMAINS = ['platform', 'authoring', 'quality', 'operations', 'workers'];
export const CONSUME_DOMAINS = ['runtime', 'inbox'];

/** Recorre una lista de dominios con un informe ya abierto. */
export async function runDomains({ reporter, principal, state, domains }) {
  for (const name of domains) {
    const module = DOMAINS[name];
    if (!module) throw new Error(`Dominio desconocido: ${name}`);
    const probe = createProbe({ reporter, principal, domain: name });
    try {
      await module.run({ probe, reporter, state, principal });
    } catch (error) {
      // Un dominio que revienta no puede llevarse por delante los demás: se registra dónde
      // reventó y el recorrido continúa.
      reporter.record({
        id: `${name}.dominio`,
        title: `el dominio "${name}" se recorre entero`,
        expected: 'sin excepciones no controladas',
        outcome: 'FAIL',
        reason: error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
      });
    }
  }
}

/**
 * La ejecución en línea usa OTRA audiencia: ninguna credencial de gestión llega ahí, por
 * muchos roles que tenga. Se recorre una sola vez, cuando ya hay algo desplegado.
 */
export async function runRuntimeAudience({ reporter, state }) {
  const probe = createProbe({ reporter, principal: runtimePrincipal(), domain: 'runtime' });
  try {
    await runtimeScenario.runRuntimeAudience({ probe, reporter, state });
  } catch (error) {
    reporter.record({
      id: 'runtime.audiencia',
      title: 'la superficie de ejecución en línea se recorre entera',
      expected: 'sin excepciones no controladas',
      outcome: 'FAIL',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function openReporter(userTypeKey) {
  const userType = USER_TYPES[userTypeKey];
  if (!userType) {
    throw new Error(`Tipo de usuario desconocido: "${userTypeKey}". Usa uno de: ${Object.keys(USER_TYPES).join(', ')}`);
  }
  setActor(userTypeKey);
  const principal = await resolvePrincipal(userTypeKey);
  const reporter = new Reporter({
    userType: userTypeKey,
    roles: principal.expectedRoles,
    authMethod: principal.authMethod,
    principalId: principal.principalId,
  });

  console.log(`\n══ ${userType.label} (${userType.roles.join(', ')})`);
  console.log(`   ${userType.description}`);
  console.log(`   identidad: ${principal.principalId} vía ${principal.authMethod}`);

  if (principal.roleMismatch) {
    // Una identidad del proveedor con menos roles de los previstos mediría otra cosa: las
    // denegaciones que observase no serían las del tipo de usuario que se quiere probar.
    reporter.record({
      id: 'principal.roles',
      title: 'la identidad tiene los roles que este tipo de usuario debe tener',
      expected: userType.roles.join(', '),
      outcome: 'FAIL',
      reason: `al proveedor de identidad le faltan estos roles: ${principal.roleMismatch.join(', ')}`,
    });
  }

  return { reporter, principal, userType };
}

/** Corrida suelta de un tipo de usuario: hace las dos pasadas de seguido. */
export async function runUser(userTypeKey, { state: sharedState, skipProvision = false } = {}) {
  if (!skipProvision) await provisionApiKeyClients();

  const state = sharedState ?? (await loadState());
  const { reporter } = await openReporter(userTypeKey);
  console.log(`   contra ${config.baseUrl}, tenant ${config.tenantId}\n`);

  await runDomains({ reporter, principal: (await resolvePrincipal(userTypeKey)), state, domains: BUILD_DOMAINS });
  if (userTypeKey === 'operator') await runRuntimeAudience({ reporter, state });
  await runDomains({
    reporter,
    principal: await resolvePrincipal(userTypeKey),
    state,
    domains: CONSUME_DOMAINS,
  });

  const { target, report } = await reporter.write(`${userTypeKey}.json`);
  if (!sharedState) await saveState(state);

  const { summary } = report;
  console.log(`\n   ${summary.passed}/${summary.total} en verde · ${summary.failed} fallo(s) · ${summary.skipped} omitida(s)`);
  if (summary.failed) console.log(`   primer fallo: ${summary.firstFailure}`);
  console.log(`   evidencia: ${target}`);

  return { report, state, target };
}

// Ejecución directa desde la línea de órdenes.
if (process.argv[1]?.endsWith('run-user.mjs')) {
  const userTypeKey = process.argv[2];
  if (!userTypeKey) {
    console.error(`Indica el tipo de usuario: ${Object.keys(USER_TYPES).join(' | ')}`);
    process.exit(2);
  }
  runUser(userTypeKey)
    .then(({ report }) => process.exit(report.summary.allPassed ? 0 : 1))
    .catch((error) => {
      console.error(`\nEl smoke no pudo arrancar: ${error instanceof Error ? error.message : error}\n`);
      process.exit(2);
    });
}

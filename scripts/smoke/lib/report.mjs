/**
 * Registro de evidencia del smoke.
 *
 * Cada comprobación tiene un identificador estable (`<dominio>.<ruta>.<caso>`) y guarda la
 * petición, el estado, el código de error catalogado y qué se esperaba. Esa es la diferencia
 * entre "el smoke está en rojo" y "falló `governance.submit-for-review.invalid.missing-flag`
 * porque esperaba HTTP_400 y llegó 500". Sin el identificador, encontrar el punto exacto de
 * fallo depende de leer la consola entera.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT_DIR } from './config.mjs';
import { errorCode, errorMessage } from './http.mjs';

export const OUTCOME = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  /** No se pudo intentar porque un prerrequisito no se cumplió. No es un acierto. */
  SKIPPED: 'SKIPPED',
};

export class Reporter {
  constructor({ userType, roles, authMethod, principalId }) {
    this.userType = userType;
    this.roles = roles;
    this.authMethod = authMethod;
    this.principalId = principalId;
    this.startedAt = new Date().toISOString();
    this.checks = [];
    this.phase = 'setup';
  }

  startPhase(phase) {
    this.phase = phase;
    console.log(`\n── ${phase}`);
  }

  /**
   * Registra una comprobación ya resuelta.
   *
   * `expected` se guarda tal cual se declaró para que el informe explique el criterio, no
   * sólo el veredicto: quien lo lea seis meses después no tiene el código delante.
   */
  record({ id, title, expected, response, outcome, reason, extra }) {
    const entry = {
      id,
      phase: this.phase,
      title,
      outcome,
      expected,
      ...(response
        ? {
            request: { method: response.method, path: response.path },
            status: response.status,
            durationMs: response.durationMs,
            errorCode: errorCode(response),
            errorMessage: errorMessage(response),
            ...(response.networkError ? { networkError: response.networkError } : {}),
          }
        : {}),
      ...(reason ? { reason } : {}),
      ...(extra ? { extra } : {}),
    };
    this.checks.push(entry);

    const badge =
      outcome === OUTCOME.PASS ? '  OK  ' : outcome === OUTCOME.SKIPPED ? ' SKIP ' : ' FALLO';
    const tail = outcome === OUTCOME.PASS ? '' : ` — ${reason ?? ''}`;
    console.log(`${badge} ${id} · ${title}${tail}`);
    return entry;
  }

  /** Comprobación que ni siquiera se pudo intentar: se registra, no se oculta. */
  skip(id, title, reason) {
    return this.record({ id, title, outcome: OUTCOME.SKIPPED, reason });
  }

  get summary() {
    const failed = this.checks.filter((check) => check.outcome === OUTCOME.FAIL);
    const skipped = this.checks.filter((check) => check.outcome === OUTCOME.SKIPPED);
    return {
      total: this.checks.length,
      passed: this.checks.filter((check) => check.outcome === OUTCOME.PASS).length,
      failed: failed.length,
      skipped: skipped.length,
      allPassed: failed.length === 0,
      firstFailure: failed[0]?.id,
      failedIds: failed.map((check) => check.id),
      skippedIds: skipped.map((check) => check.id),
    };
  }

  /**
   * Catálogo de códigos de error observados.
   *
   * Es la respuesta directa a "asegurarte de que los errores estén catalogados": si aquí
   * aparece `INTERNAL_ERROR`, o un código que nadie declaró esperar, el motor devolvió algo
   * que no forma parte de su contrato.
   */
  get errorCatalog() {
    const catalog = {};
    for (const check of this.checks) {
      if (!check.errorCode) continue;
      const bucket = (catalog[check.errorCode] ??= { count: 0, statuses: [], checks: [] });
      bucket.count += 1;
      if (!bucket.statuses.includes(check.status)) bucket.statuses.push(check.status);
      bucket.checks.push(check.id);
    }
    return catalog;
  }

  async write(fileName) {
    await mkdir(OUT_DIR, { recursive: true });
    const report = {
      userType: this.userType,
      principalId: this.principalId,
      roles: this.roles,
      authMethod: this.authMethod,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      summary: this.summary,
      errorCatalog: this.errorCatalog,
      checks: this.checks,
    };
    const target = join(OUT_DIR, fileName);
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
    return { target, report };
  }
}

/**
 * Evalúa una respuesta contra lo esperado y la registra.
 *
 * `expect` admite `{ status }`, `{ statusIn: [] }`, `{ errorCode }` y `{ assert(body) }`.
 * Un 5xx nunca pasa por muy "esperado" que fuese el código: un fallo del servidor no es
 * un rechazo catalogado, es un defecto.
 */
export function evaluate(reporter, { id, title, expect, response, extra }) {
  const problems = [];

  if (response.status === 0) {
    problems.push(`no hubo respuesta: ${response.networkError}`);
  } else {
    if (response.status >= 500) problems.push(`el servidor falló con ${response.status}`);
    if (expect.status !== undefined && response.status !== expect.status) {
      problems.push(`esperaba ${expect.status} y llegó ${response.status}`);
    }
    if (expect.statusIn && !expect.statusIn.includes(response.status)) {
      problems.push(`esperaba uno de [${expect.statusIn.join(', ')}] y llegó ${response.status}`);
    }
    const code = errorCode(response);
    if (expect.errorCode) {
      const accepted = Array.isArray(expect.errorCode) ? expect.errorCode : [expect.errorCode];
      if (!code || !accepted.includes(code)) {
        problems.push(`esperaba el código [${accepted.join(', ')}] y llegó ${code ?? 'ninguno'}`);
      }
    }
    // Un error sin código no es catalogable, y catalogar los errores es el objetivo.
    if (!response.ok && !code) problems.push('el error llegó sin código catalogado');
    if (expect.assert && response.ok) {
      try {
        expect.assert(response.body, response);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
    // Algunos rechazos llevan el motivo concreto en `error.details`: un contrato inválido
    // "por cualquier motivo" no fija nada, así que se puede exigir cuál fue.
    if (expect.assertError && !response.ok) {
      try {
        expect.assertError(response.body?.error?.details, response.body);
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  return reporter.record({
    id,
    title,
    expected: describeExpectation(expect),
    response,
    outcome: problems.length ? OUTCOME.FAIL : OUTCOME.PASS,
    reason: problems.length ? problems.join(' | ') : undefined,
    extra,
  });
}

function describeExpectation(expect) {
  const parts = [];
  if (expect.status !== undefined) parts.push(`status ${expect.status}`);
  if (expect.statusIn) parts.push(`status ∈ [${expect.statusIn.join(', ')}]`);
  if (expect.errorCode) {
    const accepted = Array.isArray(expect.errorCode) ? expect.errorCode : [expect.errorCode];
    parts.push(`código ${accepted.join('|')}`);
  }
  if (expect.assert) parts.push('aserción sobre el cuerpo');
  if (expect.assertError) parts.push('aserción sobre los detalles del error');
  return parts.join(' + ') || 'sin criterio';
}

/** Aserción legible dentro de `expect.assert`. */
export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

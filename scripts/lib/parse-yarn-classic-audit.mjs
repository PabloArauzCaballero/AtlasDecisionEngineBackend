/**
 * Parser puro del protocolo `yarn audit --json` de Yarn Classic (1.22.x). No ejecuta procesos ni red.
 *
 * Protocolo observado en yarn 1.22.22 (lib/cli.js, comando audit + JSONReporter):
 *   - stdout: líneas JSON `{type, data}`: `auditAdvisory` (0..n) y UN `auditSummary` al final.
 *   - stderr: `warning` y `error` en JSON (JSONReporter.error/warn escriben en stderr).
 *   - exit code: máscara de `summary.vulnerabilities` (1 info, 2 low, 4 moderate, 8 high, 16 critical),
 *     así que 0..31. Un error operativo de yarn termina con 1 —el mismo valor que «sólo INFO»—,
 *     por eso el código por sí solo NUNCA decide: el resumen debe existir y cuadrar con el código.
 *   - `--level` sólo filtra los avisos impresos; el resumen cuenta todas las severidades.
 */

export const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const SEVERITY_BIT = { info: 1, low: 2, moderate: 4, high: 8, critical: 16 };
const SUMMARY_COUNT_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'totalDependencies',
];
const STDOUT_BENIGN_TYPES = new Set(['info', 'success']);
const STDERR_BENIGN_TYPES = new Set(['warning', 'info']);
// Aviso de runtime de Node (p. ej. DEP0040) en stderr: no es un registro del protocolo ni un error de yarn.
const NODE_RUNTIME_WARNING = /^\(node:\d+\) /;

const failure = (kind, reason, extra = {}) => ({ ok: false, kind, reason, ...extra });

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function parseJsonLines(text, stream) {
  const records = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim() === '') continue;
    if (stream === 'stderr' && NODE_RUNTIME_WARNING.test(line)) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { error: `${stream} línea ${index + 1}: no es JSON (truncada o malformada)` };
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof parsed.type !== 'string'
    ) {
      return { error: `${stream} línea ${index + 1}: registro sin campo \`type\`` };
    }
    records.push(parsed);
  }
  return { records };
}

function validateSummary(data) {
  if (data === null || typeof data !== 'object') return 'auditSummary.data ausente';
  const counts = data.vulnerabilities;
  if (counts === null || typeof counts !== 'object')
    return 'auditSummary.data.vulnerabilities ausente';
  const keys = Object.keys(counts).sort().join(',');
  if (keys !== [...SEVERITIES].sort().join(','))
    return `severidades no reconocidas o ausentes (${keys})`;
  for (const severity of SEVERITIES) {
    if (!isCount(counts[severity]))
      return `contador vulnerabilities.${severity} no es un entero no negativo`;
  }
  for (const field of SUMMARY_COUNT_FIELDS) {
    if (!isCount(data[field])) return `contador ${field} no es un entero no negativo`;
  }
  if (data.totalDependencies === 0) return 'totalDependencies = 0: no se auditó ningún paquete';
  return null;
}

function maskOf(counts) {
  return SEVERITIES.reduce(
    (mask, severity) => (counts[severity] > 0 ? mask | SEVERITY_BIT[severity] : mask),
    0,
  );
}

/**
 * @param {{stdout:string, stderr:string, exitCode:number|null, signal:string|null, timedOut?:boolean,
 *          truncated?:boolean, spawnError?:string|null}} outcome
 * @returns {{ok:true, summary:object, advisories:object[], exitMask:number} |
 *           {ok:false, kind:'OPERATIONAL_ERROR'|'PROTOCOL_ERROR', reason:string}}
 */
export function parseCompletedAudit(outcome) {
  const {
    stdout,
    stderr,
    exitCode,
    signal,
    timedOut = false,
    truncated = false,
    spawnError = null,
  } = outcome;
  if (spawnError)
    return failure('OPERATIONAL_ERROR', `no se pudo iniciar el auditor: ${spawnError}`);
  if (timedOut)
    return failure('OPERATIONAL_ERROR', 'el auditor superó su presupuesto de tiempo', {
      transient: true,
    });
  if (truncated)
    return failure('OPERATIONAL_ERROR', 'la salida del auditor superó el límite y fue truncada');
  if (signal) return failure('OPERATIONAL_ERROR', `el auditor terminó por la señal ${signal}`);
  if (!Number.isInteger(exitCode))
    return failure('OPERATIONAL_ERROR', 'el auditor no devolvió un código de salida');

  const out = parseJsonLines(stdout, 'stdout');
  if (out.error) return failure('PROTOCOL_ERROR', out.error);
  const err = parseJsonLines(stderr, 'stderr');
  if (err.error) return failure('PROTOCOL_ERROR', err.error);

  const errorRecord = [...out.records, ...err.records].find((record) => record.type === 'error');
  if (errorRecord) {
    const detail =
      typeof errorRecord.data === 'string' ? errorRecord.data.slice(0, 300) : 'sin detalle';
    return failure('OPERATIONAL_ERROR', `yarn registró un error: ${detail}`, {
      transient:
        /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|getaddrinfo|\b50[234]\b|Unexpected audit response/i.test(
          detail,
        ),
    });
  }

  const summaries = out.records.filter((record) => record.type === 'auditSummary');
  if (summaries.length === 0)
    return failure('PROTOCOL_ERROR', 'falta el resumen terminal auditSummary');
  if (summaries.length > 1) return failure('PROTOCOL_ERROR', 'hay más de un auditSummary');
  if (out.records[out.records.length - 1] !== summaries[0]) {
    return failure('PROTOCOL_ERROR', 'hay registros después de auditSummary');
  }
  const unknown = out.records.find(
    (record) =>
      !['auditAdvisory', 'auditSummary'].includes(record.type) &&
      !STDOUT_BENIGN_TYPES.has(record.type),
  );
  if (unknown)
    return failure('PROTOCOL_ERROR', `tipo de registro de stdout incompatible: ${unknown.type}`);
  const unknownErr = err.records.find((record) => !STDERR_BENIGN_TYPES.has(record.type));
  if (unknownErr)
    return failure('PROTOCOL_ERROR', `tipo de registro de stderr incompatible: ${unknownErr.type}`);

  const summaryProblem = validateSummary(summaries[0].data);
  if (summaryProblem) return failure('PROTOCOL_ERROR', summaryProblem);
  const summary = summaries[0].data;

  const advisories = [];
  for (const record of out.records.filter((item) => item.type === 'auditAdvisory')) {
    const advisory = record.data?.advisory;
    if (
      !advisory ||
      !SEVERITIES.includes(advisory.severity) ||
      advisory.id === undefined ||
      advisory.id === null
    ) {
      return failure(
        'PROTOCOL_ERROR',
        'auditAdvisory sin advisory.id o con severidad no reconocida',
      );
    }
    if (summary.vulnerabilities[advisory.severity] === 0) {
      return failure(
        'PROTOCOL_ERROR',
        `auditAdvisory ${advisory.severity} contradice el resumen (contador 0)`,
      );
    }
    advisories.push({
      id: advisory.id,
      githubAdvisoryId: advisory.github_advisory_id ?? null,
      severity: advisory.severity,
      module: advisory.module_name ?? null,
      path: record.data?.resolution?.path ?? null,
    });
  }

  const exitMask = maskOf(summary.vulnerabilities);
  if (exitCode !== exitMask) {
    return failure(
      'PROTOCOL_ERROR',
      `código de salida ${exitCode} no corresponde a la máscara ${exitMask} del resumen (código fuera de protocolo o resumen contradictorio)`,
    );
  }
  return { ok: true, summary, advisories, exitMask };
}

/**
 * Aplica la política de severidades SOLO sobre una auditoría completada y válida.
 * @param {{summary:object, advisories:object[]}} completed
 * @param {{blockSeverities?:string[], exceptions?:Array<{advisory:string|number, owner:string, reason:string, expires:string}>, now?:Date}} policy
 */
export function evaluateAudit(completed, policy = {}) {
  const blockSeverities = policy.blockSeverities ?? ['high', 'critical'];
  const now = policy.now ?? new Date();
  const counts = completed.summary.vulnerabilities;
  const blockingCount = blockSeverities.reduce((total, severity) => total + counts[severity], 0);
  if (blockingCount === 0) return { decision: 'PASS', blocking: [], excepted: [] };

  const blocking = completed.advisories.filter((advisory) =>
    blockSeverities.includes(advisory.severity),
  );
  const excepted = [];
  const unresolved = [];
  for (const advisory of blocking) {
    const match = (policy.exceptions ?? []).find((exception) => {
      const keys = [String(advisory.id), advisory.githubAdvisoryId].filter(Boolean);
      const expires = Date.parse(exception.expires);
      return (
        keys.includes(String(exception.advisory)) &&
        Boolean(exception.owner) &&
        Boolean(exception.reason) &&
        Number.isFinite(expires) &&
        expires > now.getTime()
      );
    });
    (match ? excepted : unresolved).push(advisory);
  }
  // Una excepción nunca oculta hallazgos que el resumen cuenta y los avisos no detallan.
  const covered =
    blocking.length >= blockingCount && unresolved.length === 0 && blocking.length > 0;
  return covered
    ? { decision: 'PASS_WITH_EXCEPTIONS', blocking: [], excepted }
    : {
        decision: 'BLOCKED_FINDINGS',
        blocking: unresolved.length > 0 ? unresolved : blocking,
        excepted,
      };
}

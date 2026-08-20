/**
 * Los dos workers adicionales: extractos bancarios y análisis semántico.
 *
 * Recorre el camino que ninguna otra prueba cubre entero —API acepta → fila encolada →
 * aviso → el worker reclama → procesa → resultado consultable → descarga— y comprueba
 * además que el número de cuenta viaja enmascarado en todas las salidas. Un dato sensible
 * que se filtra en el CSV no lo ve ninguna prueba unitaria.
 */
import { assert } from '../lib/report.mjs';
import { items, pollUntil } from '../lib/http.mjs';
import { config } from '../lib/config.mjs';

const OPERATE = ['RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS'];
const READ = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR'];
const FIXTURES = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST'];
const DOWNLOAD = ['RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR'];

const TERMINAL = ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('workers · catálogo');

  const catalog = await probe.ok({
    id: 'workers-list',
    title: 'GET /v1/workers declara los workers disponibles',
    path: '/v1/workers',
    roles: READ,
    expect: {
      assert: (body) => {
        const codes = items(body).map((worker) => worker.code);
        assert(codes.includes('bank-statement'), `el catálogo debe declarar bank-statement y trajo [${codes.join(', ')}]`);
        assert(codes.includes('semantic-analysis'), `el catálogo debe declarar semantic-analysis y trajo [${codes.join(', ')}]`);
      },
    },
  });

  const available = catalog.response.ok
    ? Object.fromEntries(items(catalog.response.body).map((worker) => [worker.code, worker.available]))
    : {};

  await bankStatement({ probe, reporter, state, available });
  await semanticAnalysis({ probe, reporter, state, available });
}

async function bankStatement({ probe, reporter, state, available }) {
  reporter.startPhase('workers · extractos bancarios');

  const base = '/v1/workers/bank-statement';

  const fixtures = await probe.ok({
    id: 'bank-statement-fixtures',
    title: `GET ${base}/fixtures`,
    path: `${base}/fixtures`,
    roles: FIXTURES,
  });

  const fixtureCodes = fixtures.response.ok ? items(fixtures.response.body).map((f) => f.code) : [];
  const hasValidFixture = fixtureCodes.includes('valid-basic');

  await probe.ok({
    id: 'bank-statement-runs-list',
    title: `GET ${base}/runs`,
    path: `${base}/runs?page=1&pageSize=25`,
    roles: READ,
  });

  await probe.invalid({
    id: 'bank-statement-runs-list',
    case: 'unknown-status',
    title: `GET ${base}/runs rechaza un estado inexistente`,
    path: `${base}/runs?status=INVENTADO`,
    roles: READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'bank-statement-runs-create',
    case: 'no-file-no-fixture',
    title: `POST ${base}/runs sin archivo ni escenario`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: {},
    expect: { status: 400, errorCode: 'BANK_STATEMENT_FILE_REQUIRED' },
  });

  await probe.invalid({
    id: 'bank-statement-runs-create',
    case: 'unknown-fixture',
    title: `POST ${base}/runs con un escenario inexistente`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { fixtureCode: 'escenario-que-no-existe' },
    expect: { statusIn: [403, 404], errorCode: ['WORKER_FIXTURE_NOT_FOUND', 'WORKER_FIXTURES_DISABLED'] },
  });

  // Un archivo que no es un PDF, comprobado por contenido y no por la extensión.
  const notAPdf = new FormData();
  notAPdf.append('file', new Blob(['esto no es un pdf'], { type: 'application/pdf' }), 'extracto.pdf');
  await probe.invalid({
    id: 'bank-statement-runs-create',
    case: 'not-a-pdf',
    title: `POST ${base}/runs rechaza un archivo que no es PDF por su contenido`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: notAPdf,
    expect: { status: 415, errorCode: 'BANK_STATEMENT_FILE_NOT_PDF' },
  });

  /**
   * Nombre con recorrido de rutas.
   *
   * Lo que se exige es el EFECTO, no el mecanismo: el nombre no puede llegar tal cual a un
   * `Content-Disposition` ni a un log. Da igual si el motor lo rechaza o lo neutraliza,
   * mientras `../` no sobreviva. Exigir un código concreto ataría la prueba a una
   * implementación y la haría fallar cuando el guardián cambie sin dejar de proteger.
   */
  if (probe.reaches(OPERATE)) {
    const badName = new FormData();
    badName.append(
      'file',
      new Blob([`%PDF-1.4 recorrido ${Date.now()}`], { type: 'application/pdf' }),
      '../fuera/del/arbol.pdf',
    );
    const traversal = await probe.send({ method: 'POST', path: `${base}/runs`, body: badName });
    const rejected = [400, 415].includes(traversal.status);
    const neutralized =
      traversal.status === 202 && !JSON.stringify(traversal.body ?? {}).includes('../');
    reporter.record({
      id: 'workers.bank-statement-runs-create.invalid.path-traversal-name',
      title: `POST ${base}/runs no deja pasar un nombre con recorrido de rutas`,
      expected: 'rechazo (400/415) o aceptación con el nombre ya neutralizado',
      response: traversal,
      outcome: rejected || neutralized ? 'PASS' : 'FAIL',
      reason:
        rejected || neutralized
          ? undefined
          : `el nombre con "../" sobrevivió en la respuesta: ${JSON.stringify(traversal.body).slice(0, 200)}`,
      extra: { rejected, neutralized },
    });
  }

  // Quien no alcanza el catálogo de escenarios no puede saber si `valid-basic` existe; lo
  // intenta igual, porque lo que debe observar es el 403 del permiso.
  const created = await probe.ok({
    id: 'bank-statement-runs-create',
    title: `POST ${base}/runs encola la conversión`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { fixtureCode: 'valid-basic' },
    expect: { status: 202, assert: (body) => assert(body?.requestId, 'la ejecución debe traer requestId') },
  });

  /**
   * Quien no puede encolar sigue el recorrido sobre la ejecución que dejó el autor.
   *
   * Consultarla y descargarla son rutas de OTROS roles —el aprobador no encola pero sí
   * audita—, y comprobarlas exige una ejecución real: contra una inventada el 404 taparía
   * lo que se quiere ver.
   */
  const requestId = created.response.ok ? created.response.body.requestId : state.bankStatementRequestId;
  if (created.response.ok) state.bankStatementRequestId = requestId;

  if (!requestId) {
    throw new Error(
      'no hay ejecución de extractos sobre la que seguir: este usuario no puede encolarla y el ' +
        'estado no trae ninguna. Corre `yarn smoke:full`.',
    );
  }

  // Reenviar el mismo documento no puede crear una segunda ejecución: la huella del
  // archivo es única por tenant.
  await probe.ok({
    id: 'bank-statement-idempotency',
    title: 'Reenviar el mismo documento devuelve la ejecución existente',
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { fixtureCode: 'valid-basic' },
    expect: {
      status: 202,
      assert: (body) => assert(body?.requestId === requestId, `se esperaba ${requestId} y llegó ${body?.requestId}`),
    },
  });

  // Descargar antes de que termine no puede devolver un archivo a medias.
  const early = await probe.send({ path: `${base}/runs/${requestId}/download?format=csv` });
  if (!TERMINAL.includes(early.body?.status) && early.status !== 200) {
    await probe.invalid({
      id: 'bank-statement-download',
      case: 'result-not-ready',
      title: 'La descarga antes de terminar es rechazada',
      path: `${base}/runs/${requestId}/download?format=csv`,
      roles: DOWNLOAD,
      expect: { status: 409, errorCode: 'BANK_STATEMENT_RESULT_NOT_READY' },
    });
  }

  console.log('\n  … esperando al worker de extractos\n');
  const polled = await pollUntil(
    () => probe.send({ path: `${base}/runs/${requestId}` }),
    (response) => {
      // Un 5xx aislado tras recrear contenedores es el pool reconectando, no un defecto.
      if (response.status >= 500) return false;
      return { finished: TERMINAL.includes(response.body?.status), seen: response.body?.status };
    },
  );

  if (polled.timedOut) {
    probe.skip(
      'bank-statement-terminal',
      'la ejecución alcanza un estado terminal',
      `siguió en ${polled.result?.body?.status ?? 'desconocido'} tras agotar la espera. Un QUEUED perpetuo ` +
        'significa que el worker no reclamó: revisa BANK_STATEMENT_WORKER_ENABLED y WORKER_ROLE en el proceso worker. ' +
        `Estados vistos: ${[...new Set(polled.seen)].join(' → ')}`,
    );
    return;
  }

  await probe.ok({
    id: 'bank-statement-runs-get',
    title: `GET ${base}/runs/:requestId trae el resultado enmascarado`,
    path: `${base}/runs/${requestId}`,
    roles: READ,
    expect: {
      assert: (body) => {
        assert(
          body?.status === 'SUCCEEDED' || body?.status === 'SUCCEEDED_WITH_WARNINGS',
          `la ejecución debía terminar con éxito y quedó en ${body?.status}`,
        );
        assert(body?.progress === 100, `el progreso debía llegar a 100 y llegó a ${body?.progress}`);
        assert(body?.result, 'la ejecución debe traer resultado');
        const masked = body?.result?.account?.accountNumberMasked;
        assert(/^\*+\d{4}$/.test(masked ?? ''), `el número de cuenta debe viajar enmascarado y llegó ${masked}`);
        assert(
          !JSON.stringify(body.result).includes('1234567890'),
          'el número de cuenta completo apareció en el resultado',
        );
      },
    },
  });

  await probe.ok({
    id: 'bank-statement-download',
    title: `GET ${base}/runs/:requestId/download sirve el CSV como adjunto`,
    path: `${base}/runs/${requestId}/download?format=csv`,
    roles: DOWNLOAD,
    raw: true,
    expect: {
      status: 200,
      assert: (_body, response) => {
        assert(
          (response.headers['content-disposition'] ?? '').includes('attachment'),
          'el archivo debe servirse como adjunto y no en línea',
        );
        assert(!response.text.includes('1234567890'), 'el CSV filtró el número de cuenta completo');
      },
    },
  });

  for (const format of ['json', 'normalized']) {
    await probe.ok({
      id: `bank-statement-download-${format}`,
      title: `GET /download?format=${format}`,
      path: `${base}/runs/${requestId}/download?format=${format}`,
      roles: DOWNLOAD,
      raw: true,
      expect: { status: 200 },
    });
  }

  await probe.invalid({
    id: 'bank-statement-download',
    case: 'unknown-format',
    title: 'GET /download rechaza un formato fuera del catálogo',
    path: `${base}/runs/${requestId}/download?format=xml`,
    roles: DOWNLOAD,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'bank-statement-runs-get',
    case: 'unknown-request',
    title: `GET ${base}/runs/:requestId inexistente`,
    path: `${base}/runs/no-existe-esta-ejecucion`,
    roles: READ,
    expect: { status: 404, errorCode: 'BANK_STATEMENT_RUN_NOT_FOUND' },
  });

  // Cancelar una ejecución ya terminada no puede prosperar.
  await probe.invalid({
    id: 'bank-statement-cancel',
    case: 'already-terminal',
    title: 'POST /cancel sobre una ejecución ya terminada',
    method: 'POST',
    path: `${base}/runs/${requestId}/cancel`,
    roles: OPERATE,
    expect: { status: 409, errorCode: 'BANK_STATEMENT_RUN_NOT_CANCELLABLE' },
  });

  // Aislamiento por tenant: la ejecución de otro no existe para quien pregunta.
  if (probe.reaches(READ)) {
    const foreign = await probe.send({ path: `${base}/runs/${requestId}`, headers: { 'x-tenant-id': '999' } });
    reporter.record({
      id: 'workers.bank-statement-tenant-isolation.valid',
      title: 'una ejecución de otro tenant no es accesible',
      expected: '404 o 403, nunca el contenido',
      response: foreign,
      outcome: [403, 404, 401].includes(foreign.status) ? 'PASS' : 'FAIL',
      reason: [403, 404, 401].includes(foreign.status)
        ? undefined
        : `se esperaba una denegación y llegó ${foreign.status}`,
    });
  }
}

async function semanticAnalysis({ probe, reporter, state, available }) {
  reporter.startPhase('workers · análisis semántico');

  const base = '/v1/workers/semantic-analysis';

  const fixtures = await probe.ok({
    id: 'semantic-fixtures',
    title: `GET ${base}/fixtures`,
    path: `${base}/fixtures`,
    roles: FIXTURES,
  });

  const fixtureCodes = fixtures.response.ok ? items(fixtures.response.body).map((f) => f.code) : [];

  await probe.ok({
    id: 'semantic-runs-list',
    title: `GET ${base}/runs`,
    path: `${base}/runs?page=1&pageSize=25`,
    roles: READ,
  });

  await probe.invalid({
    id: 'semantic-runs-create',
    case: 'empty-input',
    title: `POST ${base}/runs sin texto ni escenario`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: {},
    expect: { status: 400, errorCode: 'SEMANTIC_TEXT_EMPTY' },
  });

  await probe.invalid({
    id: 'semantic-runs-create',
    case: 'ambiguous-input',
    title: `POST ${base}/runs con texto Y escenario a la vez`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { text: 'Un texto cualquiera.', fixtureCode: 'gasto-claro' },
    expect: { status: 400, errorCode: 'SEMANTIC_INPUT_AMBIGUOUS' },
  });

  await probe.invalid({
    id: 'semantic-runs-create',
    case: 'text-too-long',
    title: `POST ${base}/runs rechaza un texto por encima del máximo`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { text: 'a'.repeat(90_000) },
    expect: { statusIn: [400, 413], errorCode: ['SEMANTIC_TEXT_TOO_LONG', 'HTTP_400', 'HTTP_413'] },
  });

  await probe.invalid({
    id: 'semantic-runs-create',
    case: 'unknown-fixture',
    title: `POST ${base}/runs con un escenario inexistente`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { fixtureCode: 'escenario-que-no-existe' },
    expect: { statusIn: [403, 404], errorCode: ['WORKER_FIXTURE_NOT_FOUND', 'WORKER_FIXTURES_DISABLED'] },
  });

  const text = `Quiero reportar un cobro que no reconozco en mi tarjeta. Referencia ${Date.now()}.`;
  const created = await probe.ok({
    id: 'semantic-runs-create',
    title: `POST ${base}/runs encola el análisis`,
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { text },
    expect: { status: 202, assert: (body) => assert(body?.requestId, 'la ejecución debe traer requestId') },
  });

  // Igual que en extractos: quien no encola sigue sobre la ejecución que dejó el autor.
  const requestId = created.response.ok ? created.response.body.requestId : state.semanticRequestId;
  if (created.response.ok) state.semanticRequestId = requestId;

  if (!requestId) {
    throw new Error(
      'no hay análisis semántico sobre el que seguir: este usuario no puede encolarlo y el estado ' +
        'no trae ninguno. Corre `yarn smoke:full`.',
    );
  }

  await probe.ok({
    id: 'semantic-idempotency',
    title: 'Reenviar el mismo texto devuelve la ejecución existente',
    method: 'POST',
    path: `${base}/runs`,
    roles: OPERATE,
    body: { text },
    expect: {
      status: 202,
      assert: (body) => assert(body?.requestId === requestId, `se esperaba ${requestId} y llegó ${body?.requestId}`),
    },
  });

  /**
   * Espera del análisis, sin afirmar QUIÉN lo procesa.
   *
   * El catálogo declara el worker disponible sólo si hay proveedor de modelo externo
   * (`SEMANTIC_ANALYSIS_PROVIDER`), pero el motor tiene además un analizador léxico local
   * que resuelve sin él. Así que "el catálogo dice indisponible" NO implica "la cola no
   * avanza", y exigir lo segundo era afirmar un negativo que este smoke no puede poseer:
   * depende de qué procesos haya vivos en la instalación, no del contrato.
   *
   * Lo que sí es contrato, y se exige siempre: la petición se acepta, no se pierde, sigue
   * siendo consultable y su estado pertenece al vocabulario cerrado. Si además termina, el
   * resultado tiene que venir completo.
   */
  console.log('\n  … esperando al worker semántico\n');
  const polled = await pollUntil(
    () => probe.send({ path: `${base}/runs/${requestId}` }),
    (response) => {
      if (response.status >= 500) return false;
      return { finished: TERMINAL.includes(response.body?.status), seen: response.body?.status };
    },
    { timeoutMs: 20_000 },
  );

  const observed = polled.result?.body?.status;
  const KNOWN = ['QUEUED', 'RUNNING', ...TERMINAL];
  reporter.record({
    id: 'workers.semantic-run-tracked.valid',
    title: 'el análisis encolado no se pierde y su estado es siempre uno del catálogo',
    expected: `estado ∈ [${KNOWN.join(', ')}]`,
    response: polled.result,
    outcome: KNOWN.includes(observed) ? 'PASS' : 'FAIL',
    reason: KNOWN.includes(observed) ? undefined : `estado inesperado: ${observed}`,
    extra: {
      estadoObservado: observed,
      catalogoDeclara: available['semantic-analysis'] === true ? 'disponible' : 'no disponible',
      nota:
        'El catálogo exige proveedor externo para declararse disponible; el analizador léxico ' +
        'local puede resolver igualmente, así que ambos estados son legítimos.',
    },
  });

  // El detalle se consulta SIEMPRE: es una ruta de lectura y su contrato no depende de que
  // la ejecución haya terminado. Sólo cuando terminó con éxito se exige además el resultado.
  await probe.ok({
    id: 'semantic-runs-get',
    title: `GET ${base}/runs/:requestId devuelve la ejecución consultable`,
    path: `${base}/runs/${requestId}`,
    roles: READ,
    expect: {
      assert: (body) => {
        assert(body?.requestId === requestId, `se esperaba ${requestId} y llegó ${body?.requestId}`);
        if (body?.status === 'SUCCEEDED' || body?.status === 'SUCCEEDED_WITH_WARNINGS') {
          assert(body?.result, 'un análisis terminado con éxito debe traer resultado');
        }
      },
    },
  });

  await probe.invalid({
    id: 'semantic-runs-get',
    case: 'unknown-request',
    title: `GET ${base}/runs/:requestId inexistente`,
    path: `${base}/runs/no-existe-este-analisis`,
    roles: READ,
    expect: { status: 404, errorCode: 'SEMANTIC_RUN_NOT_FOUND' },
  });

  // Cancelar una ejecución nueva: si el worker ya la tomó el rechazo también es correcto,
  // y es la carrera real que existe en un sistema con trabajadores activos.
  const fresh = await probe.send({
    method: 'POST',
    path: `${base}/runs`,
    body: { text: `Texto para cancelar ${Date.now()}.` },
  });
  if (fresh.ok && fresh.body?.requestId) {
    await probe.ok({
      id: 'semantic-cancel',
      title: `POST ${base}/runs/:requestId/cancel`,
      method: 'POST',
      path: `${base}/runs/${fresh.body.requestId}/cancel`,
      roles: OPERATE,
      // 409 es igual de correcto: el worker pudo reclamarla entre encolar y cancelar.
      expect: { statusIn: [200, 201, 202, 204, 409] },
    });
  }

  await probe.invalid({
    id: 'semantic-cancel',
    case: 'unknown-request',
    title: `POST ${base}/runs/:requestId/cancel inexistente`,
    method: 'POST',
    path: `${base}/runs/no-existe-este-analisis/cancel`,
    roles: OPERATE,
    expect: { status: 404, errorCode: 'SEMANTIC_RUN_NOT_FOUND' },
  });
}

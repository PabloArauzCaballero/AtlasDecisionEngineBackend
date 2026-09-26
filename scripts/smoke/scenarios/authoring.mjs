/**
 * Superficie de autoría: catálogo de variables, motivos, artefactos, grafo, validación,
 * compilación, importación de código, campos calculados y árboles anidados.
 *
 * Es la fase que produce el artefacto que los otros dos smokes continúan. Sólo el autor
 * (RISK_ANALYST/FRAUD_ANALYST) la alcanza entera; para los demás el valor de estas
 * comprobaciones es el 403.
 */
import { assert } from '../lib/report.mjs';
import * as fixture from '../lib/fixtures.mjs';

const AUTHOR = ['RISK_ANALYST', 'FRAUD_ANALYST'];
const AUTHOR_ADMIN = ['RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN'];
const READ = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR'];
const READ_OPS = [...READ, 'OPERATIONS'];
const VALIDATE = ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST'];

export async function run({ probe, reporter, state }) {
  reporter.startPhase('autoría · catálogo de variables');

  await probe.ok({
    id: 'variables-list',
    title: 'GET /v1/variables lista el catálogo',
    path: '/v1/variables?page=1&pageSize=25',
    roles: READ,
  });

  await probe.invalid({
    id: 'variables-list',
    case: 'page-size-out-of-range',
    title: 'GET /v1/variables acota el tamaño de página',
    path: '/v1/variables?pageSize=9999',
    roles: READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'variables-list',
    case: 'unknown-usage',
    title: 'GET /v1/variables rechaza un uso fuera de INPUT/OUTPUT',
    path: '/v1/variables?usage=LATERAL',
    roles: READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  const created = await probe.ok({
    id: 'variables-create',
    title: 'POST /v1/variables crea una definición con su primera versión',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: fixture.variableDefinition(),
    expect: {
      assert: (body) => assert(body?.id, 'la respuesta debe traer el id de la definición'),
    },
  });
  if (created.allowed && created.response.ok) state.variableDefinitionId = created.response.body.id;

  await probe.invalid({
    id: 'variables-create',
    case: 'malformed-code',
    title: 'POST /v1/variables rechaza un código que no respeta el patrón',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: { ...fixture.variableDefinition(), variableCode: '9-empieza-por-numero' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'variables-create',
    case: 'unknown-data-type',
    title: 'POST /v1/variables rechaza un tipo de dato fuera del catálogo canónico',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: (() => {
      const payload = fixture.variableDefinition();
      payload.variableCode = `smoke_bad_type_${fixture.RUN}`;
      payload.initialVersion = { ...payload.initialVersion, dataType: 'TIPO_INVENTADO' };
      return payload;
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'variables-create',
    case: 'missing-initial-version',
    title: 'POST /v1/variables exige la versión inicial',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: (() => {
      const { initialVersion, ...rest } = fixture.variableDefinition();
      return { ...rest, variableCode: `smoke_no_version_${fixture.RUN}` };
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (state.variableDefinitionId) {
    await probe.ok({
      id: 'variables-get',
      title: 'GET /v1/variables/:definitionId',
      path: `/v1/variables/${state.variableDefinitionId}`,
      roles: READ,
    });

    await probe.ok({
      id: 'variables-create-version',
      title: 'POST /v1/variables/:definitionId/versions añade una versión',
      method: 'POST',
      path: `/v1/variables/${state.variableDefinitionId}/versions`,
      roles: AUTHOR_ADMIN,
      body: { ...fixture.variableContract(), contractVersion: '2' },
    });

    await probe.ok({
      id: 'variables-dependencies',
      title: 'GET /v1/variables/:definitionId/dependencies',
      path: `/v1/variables/${state.variableDefinitionId}/dependencies`,
      roles: READ,
    });

    await probe.ok({
      id: 'variables-compatibility',
      title: 'POST /v1/variables/:definitionId/compatibility compara contratos',
      method: 'POST',
      path: `/v1/variables/${state.variableDefinitionId}/compatibility`,
      roles: READ,
      body: fixture.variableContract(),
    });
  } else {
    for (const id of ['variables-get', 'variables-create-version', 'variables-dependencies', 'variables-compatibility']) {
      probe.skip(id, `rutas sobre una definición de variable`, 'no se pudo crear la definición');
    }
  }

  await probe.invalid({
    id: 'variables-get',
    case: 'malformed-id',
    title: 'GET /v1/variables/:definitionId rechaza un id no numérico',
    path: '/v1/variables/no-es-un-id',
    roles: READ,
    expect: { status: 400, errorCode: ['INVALID_ID', 'HTTP_400'] },
  });

  await probe.ok({
    id: 'variables-validate-contract',
    title: 'POST /v1/variables/validate-contract valida antes de guardar',
    method: 'POST',
    path: '/v1/variables/validate-contract',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
    body: { ...fixture.variableContract(), sampleValues: [1000, -5] },
  });

  await probe.invalid({
    id: 'variables-validate-contract',
    case: 'too-many-samples',
    title: 'POST /v1/variables/validate-contract acota los valores de prueba',
    method: 'POST',
    path: '/v1/variables/validate-contract',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
    body: { ...fixture.variableContract(), sampleValues: Array.from({ length: 21 }, (_, i) => i) },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Motivos de decisión. ----------------------------------------------------------
  await probe.ok({
    id: 'reason-codes-list',
    title: 'GET /v1/reason-codes',
    path: '/v1/reason-codes?page=1&pageSize=25',
    roles: READ_OPS,
  });

  await probe.ok({
    id: 'reason-codes-create',
    title: 'POST /v1/reason-codes crea un motivo',
    method: 'POST',
    path: '/v1/reason-codes',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE'],
    body: fixture.reasonCode(),
  });

  await probe.invalid({
    id: 'reason-codes-create',
    case: 'lowercase-code',
    title: 'POST /v1/reason-codes exige el patrón de código en mayúsculas',
    method: 'POST',
    path: '/v1/reason-codes',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE'],
    body: { ...fixture.reasonCode(), reasonCode: 'minusculas invalidas' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Artefactos y grafo. -----------------------------------------------------------
  reporter.startPhase('autoría · artefacto y grafo');

  await probe.ok({
    id: 'artifacts-list',
    title: 'GET /v1/artifacts',
    path: '/v1/artifacts?page=1&pageSize=25',
    roles: READ_OPS,
  });

  await probe.invalid({
    id: 'artifacts-list',
    case: 'unknown-status',
    title: 'GET /v1/artifacts rechaza un estado fuera del ciclo de vida',
    path: '/v1/artifacts?status=INVENTADO',
    roles: READ_OPS,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  const artifact = await probe.ok({
    id: 'artifacts-create',
    title: 'POST /v1/artifacts crea el artefacto y su primer borrador',
    method: 'POST',
    path: '/v1/artifacts',
    roles: AUTHOR,
    body: fixture.createArtifact(),
    expect: {
      assert: (body) => {
        assert(body?.id, 'la respuesta debe traer el id del artefacto');
        assert(body?.versions?.[0]?.id, 'la respuesta debe traer la primera versión');
        assert(body.versions[0].status === 'DRAFT', `la primera versión debe nacer en DRAFT y llegó ${body.versions[0].status}`);
      },
    },
  });

  await probe.invalid({
    id: 'artifacts-create',
    case: 'code-too-short',
    title: 'POST /v1/artifacts rechaza un código de menos de tres caracteres',
    method: 'POST',
    path: '/v1/artifacts',
    roles: AUTHOR,
    body: { ...fixture.createArtifact(), artifactCode: 'AB' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'artifacts-create',
    case: 'missing-business-purpose',
    title: 'POST /v1/artifacts exige el propósito de negocio',
    method: 'POST',
    path: '/v1/artifacts',
    roles: AUTHOR,
    body: (() => {
      const { businessPurpose, ...rest } = fixture.createArtifact(`SMOKE_NOPURPOSE_${fixture.RUN}`);
      return rest;
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'artifacts-create',
    case: 'duplicate-code',
    title: 'POST /v1/artifacts rechaza un código ya usado',
    method: 'POST',
    path: '/v1/artifacts',
    roles: AUTHOR,
    body: fixture.createArtifact(),
    expect: { statusIn: [400, 409], errorCode: ['RESOURCE_ALREADY_EXISTS', 'ARTIFACT_CODE_TAKEN'] },
  });

  /**
   * Quien no puede crear sigue recorriendo el ciclo de vida sobre el artefacto que ya dejó
   * el autor.
   *
   * Abandonar el dominio aquí dejaba sin comprobar todo lo que viene después para dos de
   * los tres usuarios, y una comprobación que no se hace no dice nada: precisamente lo que
   * hay que demostrar es que el aprobador y el operador reciben 403 al intentar escribir el
   * grafo de una versión real, no de una inventada.
   */
  const owns = artifact.allowed && artifact.response.ok;
  const artifactId = owns ? artifact.response.body.id : state.lifecycle?.artifactId;
  const versionId = owns ? artifact.response.body.versions[0].id : state.lifecycle?.versionId;
  let lockVersion = owns ? (artifact.response.body.versions[0].lockVersion ?? 1) : 1;

  if (owns) {
    state.lifecycle = { artifactId, versionId, artifactCode: fixture.artifactCode() };
  }

  if (!artifactId || !versionId) {
    throw new Error(
      'no hay artefacto sobre el que seguir: este usuario no puede crearlo y el estado no trae ninguno. ' +
        'Corre `yarn smoke:full`, que encadena a los tres, o el smoke del autor primero.',
    );
  }

  await probe.ok({
    id: 'artifacts-get',
    title: 'GET /v1/artifacts/:artifactId con su historial de versiones',
    path: `/v1/artifacts/${artifactId}`,
    roles: READ_OPS,
  });

  await probe.invalid({
    id: 'artifacts-get',
    case: 'unknown-id',
    title: 'GET /v1/artifacts/:artifactId con un id inexistente',
    path: '/v1/artifacts/9007199254740991',
    roles: READ_OPS,
    expect: { statusIn: [400, 404], errorCode: ['ARTIFACT_NOT_FOUND', 'INVALID_ID'] },
  });

  await probe.ok({
    id: 'artifact-versions-get',
    title: 'GET /v1/artifact-versions/:versionId',
    path: `/v1/artifact-versions/${versionId}`,
    roles: READ_OPS,
  });

  await probe.ok({
    id: 'artifact-versions-graph-get',
    title: 'GET /v1/artifact-versions/:versionId/graph',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: READ,
  });

  // Entrada propia y coherente. Ver `graphInputVariable` en fixtures: la del catálogo
  // sembrado no declara valor por defecto y el contrato lo lee como nulo.
  const inputVariable = await probe.ok({
    id: 'graph-input-variable',
    title: 'POST /v1/variables crea la entrada que el grafo declarará',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: fixture.graphInputVariable(),
  });

  // Quien no puede crearla usa la que dejó el autor: el grafo debe declarar una entrada
  // real para que el 403 que reciba sea el del permiso y no el de un dato inexistente.
  const inputVersionId = inputVariable.response.ok
    ? inputVariable.response.body?.versions?.[0]?.id
    : state.inputVariableVersionId;
  const inputCode = inputVariable.response.ok ? fixture.inputVariableCode() : state.inputVariableCode;

  if (!inputVersionId || !inputCode) {
    throw new Error(
      'no hay variable de entrada sobre la que construir el grafo: este usuario no puede crearla ' +
        'y el estado no trae ninguna. Corre `yarn smoke:full`.',
    );
  }

  // Sólo el dueño del artefacto fija la variable del ciclo de vida. Los demás crean la
  // suya —y deben poder hacerlo, es su camino correcto—, pero pisar esta clave dejaría al
  // runtime ejecutando con un nombre que el artefacto desplegado no declara, y todas las
  // decisiones caerían en el valor por defecto sin que nada lo delatara.
  if (owns && inputVariable.response.ok) {
    state.inputVariableCode = inputCode;
    state.inputVariableVersionId = inputVersionId;
  }
  const seeded = { versionId: inputVersionId };

  // El bloqueo optimista es obligatorio: sin If-Match la escritura se rechaza en 412.
  await probe.invalid({
    id: 'artifact-versions-graph-put',
    case: 'missing-if-match',
    title: 'PUT del grafo sin If-Match no escribe nada',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    body: fixture.graph(seeded.versionId),
    expect: { status: 428, errorCode: 'IF_MATCH_REQUIRED' },
  });

  await probe.invalid({
    id: 'artifact-versions-graph-put',
    case: 'stale-if-match',
    title: 'PUT del grafo con un bloqueo caducado da conflicto',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    headers: { 'if-match': '9999' },
    body: fixture.graph(seeded.versionId),
    expect: { status: 409, errorCode: 'LOCK_CONFLICT' },
  });

  await probe.invalid({
    id: 'artifact-versions-graph-put',
    case: 'dangling-edge',
    title: 'PUT del grafo rechaza un eje hacia un nodo inexistente',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    headers: { 'if-match': String(lockVersion) },
    body: fixture.graphWithDanglingEdge(seeded.versionId),
    expect: { statusIn: [400, 409, 422], errorCode: ['EDGE_NODE_NOT_FOUND', 'GRAPH_INVALID', 'HTTP_400'] },
  });

  await probe.invalid({
    id: 'artifact-versions-graph-put',
    case: 'no-nodes',
    title: 'PUT del grafo exige al menos un nodo',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    headers: { 'if-match': String(lockVersion) },
    body: { ...fixture.graph(seeded.versionId), nodes: [] },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'artifact-versions-graph-put',
    case: 'unknown-variable-dependency',
    title: 'PUT del grafo rechaza una dependencia a una variable inexistente',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    headers: { 'if-match': String(lockVersion) },
    body: fixture.graph('9007199254740991'),
    expect: { statusIn: [400, 404, 409], errorCode: ['VARIABLE_DEPENDENCY_NOT_FOUND', 'VARIABLE_VERSION_NOT_FOUND', 'HTTP_400'] },
  });

  const graphWritten = await probe.ok({
    id: 'artifact-versions-graph-put',
    title: 'PUT del grafo escribe el borrador de forma atómica',
    method: 'PUT',
    path: `/v1/artifact-versions/${versionId}/graph`,
    roles: AUTHOR,
    headers: { 'if-match': String(lockVersion) },
    body: fixture.graph(seeded.versionId),
    expect: {
      assert: (body) => assert(body?.lockVersion > lockVersion, 'el bloqueo optimista debe avanzar tras escribir'),
    },
  });
  if (graphWritten.response.ok) lockVersion = graphWritten.response.body.lockVersion;

  await probe.ok({
    id: 'artifact-versions-notes',
    title: 'PATCH /v1/artifact-versions/:versionId/notes',
    method: 'PATCH',
    path: `/v1/artifact-versions/${versionId}/notes`,
    roles: AUTHOR,
    body: { notes: 'Anotado por el smoke integral.' },
  });

  await probe.invalid({
    id: 'artifact-versions-notes',
    case: 'unknown-field',
    title: 'PATCH de notas rechaza un campo que no está en el contrato',
    method: 'PATCH',
    path: `/v1/artifact-versions/${versionId}/notes`,
    roles: AUTHOR,
    body: { notes: 'ok', campoInventado: true },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  // --- Validación y compilación. -----------------------------------------------------
  reporter.startPhase('autoría · validación y compilación');

  // Compilar antes de validar debe fallar: sólo se compila lo que está VALIDATED.
  await probe.invalid({
    id: 'artifact-versions-compile',
    case: 'not-validated-yet',
    title: 'POST /compile sobre un borrador sin validar es rechazado',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId}/compile`,
    roles: VALIDATE,
    expect: { status: 409, errorCode: 'VERSION_NOT_COMPILABLE' },
  });

  /**
   * Sólo el dueño llega aquí con un borrador. Para los demás la versión ya está en revisión
   * o desplegada, y entonces lo correcto —lo que hay que exigir— es el rechazo: una versión
   * bajo revisión no se puede revalidar por debajo, porque el resultado que los aprobadores
   * están mirando dejaría de corresponder al grafo.
   */
  const validated = await probe.ok({
    id: 'artifact-versions-validate',
    title: owns ? 'POST /validate deja la versión validada' : 'POST /validate no toca una versión en revisión',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId}/validate`,
    roles: VALIDATE,
    expect: owns
      ? {
          assert: (body) =>
            assert(body?.valid === true, `el grafo del smoke debe validar y devolvió ${JSON.stringify(body?.errors ?? body)}`),
        }
      : { status: 409, errorCode: 'VERSION_NOT_VALIDATABLE' },
  });

  if (validated.response.ok && validated.response.body?.valid) {
    const compiled = await probe.ok({
      id: 'artifact-versions-compile',
      title: 'POST /compile produce el artefacto inmutable',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/compile`,
      roles: VALIDATE,
      expect: {
        assert: (body) => assert(body?.compileStatus === 'SUCCESS', `se esperaba compileStatus SUCCESS y llegó ${body?.compileStatus}`),
      },
    });
    if (compiled.response.ok) state.lifecycle.compiledArtifactId = compiled.response.body?.id;
  } else {
    // Quien no es dueño ya recibió el 409 al validar; el mismo rechazo se exige al compilar,
    // que es la otra puerta de la inmutabilidad.
    await probe.ok({
      id: 'artifact-versions-compile',
      title: 'POST /compile no recompila una versión en revisión',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/compile`,
      roles: VALIDATE,
      expect: { status: 409, errorCode: ['VERSION_NOT_COMPILABLE', 'VERSION_NOT_VALIDATABLE'] },
    });
  }

  await probe.invalid({
    id: 'artifact-versions-validate',
    case: 'unknown-version',
    title: 'POST /validate sobre una versión inexistente',
    method: 'POST',
    path: '/v1/artifact-versions/9007199254740991/validate',
    roles: VALIDATE,
    expect: { statusIn: [400, 404], errorCode: ['VERSION_NOT_FOUND', 'INVALID_ID'] },
  });

  // --- Clonado y diferencia entre versiones. -----------------------------------------
  const cloned = await probe.ok({
    id: 'artifact-versions-clone',
    title: 'POST /clone abre un borrador nuevo desde la versión inmutable',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId}/clone`,
    roles: AUTHOR,
    body: { changeSummary: 'Clon creado por el smoke para comparar versiones.' },
  });

  await probe.invalid({
    id: 'artifact-versions-clone',
    case: 'missing-change-summary',
    title: 'POST /clone exige el resumen del cambio',
    method: 'POST',
    path: `/v1/artifact-versions/${versionId}/clone`,
    roles: AUTHOR,
    body: {},
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (owns && cloned.response.ok && cloned.response.body?.id) {
    state.lifecycle.clonedVersionId = cloned.response.body.id;
  }

  // Comparar dos versiones es una LECTURA, así que la alcanza cualquier rol lector aunque
  // no pueda clonar. Se compara contra el clon que dejó el dueño.
  await probe.ok({
    id: 'artifact-versions-diff',
    title: 'GET /diff compara dos versiones canónicamente',
    path: `/v1/artifact-versions/${versionId}/diff/${state.lifecycle?.clonedVersionId ?? versionId}`,
    roles: READ,
  });

  await probe.ok({
    id: 'artifact-versions-validate-and-compile',
    title: owns
      ? 'POST /validate-and-compile encadena ambos pasos'
      : 'POST /validate-and-compile tampoco toca una versión en revisión',
    method: 'POST',
    path: `/v1/artifact-versions/${state.lifecycle?.clonedVersionId ?? versionId}/validate-and-compile`,
    roles: VALIDATE,
    expect: owns ? {} : { status: 409, errorCode: ['VERSION_NOT_VALIDATABLE', 'VERSION_NOT_COMPILABLE'] },
  });

  // --- Importación de código. --------------------------------------------------------
  reporter.startPhase('autoría · importación de código');

  await probe.ok({
    id: 'code-imports-list',
    title: 'GET /v1/code-imports',
    path: '/v1/code-imports?page=1&pageSize=25',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR'],
  });

  // La salida que el contrato del código declara debe existir en el catálogo antes de
  // analizarlo: el analizador rechaza importar código que nombra variables inexistentes.
  await probe.ok({
    id: 'code-import-output-variable',
    title: 'POST /v1/variables crea la salida que el código importado declarará',
    method: 'POST',
    path: '/v1/variables',
    roles: AUTHOR_ADMIN,
    body: fixture.codeImportOutputVariable(),
  });
  state.outputVariableCode = fixture.outputVariableCode();

  const analyzed = await probe.ok({
    id: 'code-imports-analyze',
    title: 'POST /v1/code-imports analiza una fuente con contrato declarado',
    method: 'POST',
    path: '/v1/code-imports',
    roles: AUTHOR,
    body: fixture.codeImport(inputCode, fixture.outputVariableCode()),
    expect: {
      assert: (body) => {
        assert(body?.id, 'el análisis debe devolver su identificador');
        assert(
          (body?.issues ?? []).every((issue) => issue.severity !== 'ERROR'),
          `el análisis no debe reportar errores bloqueantes y reportó ${JSON.stringify(body?.issues)}`,
        );
      },
    },
  });

  await probe.invalid({
    id: 'code-imports-analyze',
    case: 'unsupported-language',
    title: 'POST /v1/code-imports rechaza un lenguaje fuera del catálogo',
    method: 'POST',
    path: '/v1/code-imports',
    roles: AUTHOR,
    body: { language: 'RUBY', sourceCode: 'puts 1' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  await probe.invalid({
    id: 'code-imports-analyze',
    case: 'missing-source',
    title: 'POST /v1/code-imports exige el código fuente',
    method: 'POST',
    path: '/v1/code-imports',
    roles: AUTHOR,
    body: { language: 'JAVASCRIPT' },
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (analyzed.response.ok && analyzed.response.body?.id) {
    const importId = analyzed.response.body.id;
    await probe.ok({
      id: 'code-imports-get',
      title: 'GET /v1/code-imports/:id',
      path: `/v1/code-imports/${importId}`,
      roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR'],
    });

    // Un destino nuevo, para no pisar el borrador que sostiene el ciclo de vida.
    const target = await probe.send({
      method: 'POST',
      path: '/v1/artifacts',
      body: fixture.createArtifact(`SMOKE_IMPORT_${fixture.RUN}`),
    });
    if (target.ok) {
      const targetVersion = target.body.versions[0];
      await probe.ok({
        id: 'code-imports-save-draft',
        title: 'POST /:id/save-draft escribe el grafo generado en un borrador',
        method: 'POST',
        path: `/v1/code-imports/${importId}/save-draft`,
        roles: AUTHOR,
        body: { artifactVersionId: targetVersion.id, expectedLockVersion: targetVersion.lockVersion ?? 1 },
      });

      await probe.invalid({
        id: 'code-imports-save-draft',
        case: 'stale-lock',
        title: 'POST /:id/save-draft con un bloqueo caducado da conflicto',
        method: 'POST',
        path: `/v1/code-imports/${importId}/save-draft`,
        roles: AUTHOR,
        body: { artifactVersionId: targetVersion.id, expectedLockVersion: 9999 },
        expect: { status: 409, errorCode: 'LOCK_CONFLICT' },
      });

      const confirmTarget = await probe.send({
        method: 'POST',
        path: '/v1/artifacts',
        body: fixture.createArtifact(`SMOKE_CONFIRM_${fixture.RUN}`),
      });
      if (confirmTarget.ok) {
        await probe.ok({
          id: 'code-imports-confirm',
          title: 'POST /:id/confirm escribe, valida y compila en un paso',
          method: 'POST',
          path: `/v1/code-imports/${importId}/confirm`,
          roles: AUTHOR,
          body: {
            artifactVersionId: confirmTarget.body.versions[0].id,
            expectedLockVersion: confirmTarget.body.versions[0].lockVersion ?? 1,
          },
        });
      } else {
        probe.skip('code-imports-confirm', 'POST /:id/confirm', 'no se pudo crear el artefacto destino');
      }
    } else {
      probe.skip('code-imports-save-draft', 'POST /:id/save-draft', 'no se pudo crear el artefacto destino');
      probe.skip('code-imports-confirm', 'POST /:id/confirm', 'no se pudo crear el artefacto destino');
    }
  }

  // Una fuente con problemas bloqueantes no puede escribirse en un artefacto.
  const broken = await probe.send({ method: 'POST', path: '/v1/code-imports', body: fixture.codeImportWithIssues() });
  if (broken.ok && broken.body?.id) {
    const blockedTarget = await probe.send({
      method: 'POST',
      path: '/v1/artifacts',
      body: fixture.createArtifact(`SMOKE_BLOCKED_${fixture.RUN}`),
    });
    if (blockedTarget.ok) {
      await probe.invalid({
        id: 'code-imports-save-draft',
        case: 'blocking-issues',
        title: 'POST /:id/save-draft no escribe una fuente con problemas bloqueantes',
        method: 'POST',
        path: `/v1/code-imports/${broken.body.id}/save-draft`,
        roles: AUTHOR,
        body: {
          artifactVersionId: blockedTarget.body.versions[0].id,
          expectedLockVersion: blockedTarget.body.versions[0].lockVersion ?? 1,
        },
        expect: { status: 409, errorCode: 'CODE_IMPORT_HAS_BLOCKING_ISSUES' },
      });
    }
    await probe.ok({
      id: 'code-imports-cancel',
      title: 'POST /:id/cancel cierra el análisis sin tocar ningún artefacto',
      method: 'POST',
      path: `/v1/code-imports/${broken.body.id}/cancel`,
      roles: AUTHOR,
    });
  }

  await probe.invalid({
    id: 'code-imports-get',
    case: 'unknown-id',
    title: 'GET /v1/code-imports/:id con un id inexistente',
    path: '/v1/code-imports/9007199254740991',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR'],
    expect: { statusIn: [400, 404], errorCode: ['CODE_IMPORT_NOT_FOUND', 'INVALID_ID'] },
  });

  // --- Campos calculados. -------------------------------------------------------------
  reporter.startPhase('autoría · campos calculados y librerías');

  await probe.ok({
    id: 'calculated-fields-operations',
    title: 'GET /v1/calculated-fields/operations sirve el catálogo cerrado',
    path: '/v1/calculated-fields/operations',
    roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN'],
  });

  await probe.ok({
    id: 'calculated-fields-list',
    title: 'GET /v1/calculated-fields',
    path: '/v1/calculated-fields?page=1&pageSize=25',
    roles: READ,
  });

  await probe.invalid({
    id: 'calculated-fields-list',
    case: 'unknown-implementation-kind',
    title: 'GET /v1/calculated-fields rechaza una modalidad inexistente',
    path: '/v1/calculated-fields?implementationKind=COBOL',
    roles: READ,
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  const field = await probe.ok({
    id: 'calculated-fields-create',
    title: 'POST /v1/calculated-fields crea el campo',
    method: 'POST',
    path: '/v1/calculated-fields',
    roles: AUTHOR_ADMIN,
    body: fixture.calculatedField(),
  });

  await probe.invalid({
    id: 'calculated-fields-create',
    case: 'missing-rationale',
    title: 'POST /v1/calculated-fields exige la justificación funcional',
    method: 'POST',
    path: '/v1/calculated-fields',
    roles: AUTHOR_ADMIN,
    body: (() => {
      const { rationale, ...rest } = fixture.calculatedField();
      return { ...rest, fieldCode: `smoke_norationale_${fixture.RUN}`.toLowerCase().slice(0, 120) };
    })(),
    expect: { status: 400, errorCode: 'HTTP_400' },
  });

  if (field.response.ok && field.response.body?.id) {
    const fieldId = field.response.body.id;
    state.calculatedFieldId = fieldId;

    await probe.ok({
      id: 'calculated-fields-get',
      title: 'GET /v1/calculated-fields/:fieldId',
      path: `/v1/calculated-fields/${fieldId}`,
      roles: READ,
    });

    const version = await probe.ok({
      id: 'calculated-fields-create-version',
      title: 'POST /:fieldId/versions crea la versión con su contrato de retorno',
      method: 'POST',
      path: `/v1/calculated-fields/${fieldId}/versions`,
      roles: AUTHOR_ADMIN,
      body: fixture.calculatedFieldVersion(),
    });

    await probe.invalid({
      id: 'calculated-fields-create-version',
      case: 'missing-return-contract',
      title: 'POST /:fieldId/versions no acepta una versión sin contrato de retorno',
      method: 'POST',
      path: `/v1/calculated-fields/${fieldId}/versions`,
      roles: AUTHOR_ADMIN,
      body: (() => {
        const { returns, ...rest } = fixture.calculatedFieldVersion();
        return rest;
      })(),
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'calculated-fields-create-version',
      case: 'too-many-executable-lines',
      title: 'POST /:fieldId/versions rechaza más de tres líneas ejecutables',
      method: 'POST',
      path: `/v1/calculated-fields/${fieldId}/versions`,
      roles: AUTHOR_ADMIN,
      body: fixture.calculatedFieldVersionTooLong(),
      expect: {
        statusIn: [400, 422],
        errorCode: ['CALCULATED_FIELD_CONTRACT_INVALID', 'CALCULATED_FIELD_CODE_TOO_LONG'],
        // El motivo concreto viaja en los detalles, y es el que importa: un contrato
        // inválido "por cualquier cosa" no probaría el guardián de código.
        assertError: (details) =>
          assert(
            (details?.issues ?? []).some((issue) => issue.code === 'CODE_TOO_LONG'),
            `se esperaba el incumplimiento CODE_TOO_LONG y llegaron ${JSON.stringify(details?.issues)}`,
          ),
      },
    });

    if (version.response.ok && version.response.body?.id) {
      const versionIdCf = version.response.body.id;
      state.calculatedFieldVersionId = versionIdCf;

      await probe.ok({
        id: 'calculated-fields-sample-inputs',
        title: 'POST /versions/:versionId/sample-inputs genera entradas del contrato',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/sample-inputs`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
        body: { kind: 'VALID', count: 3, seed: `smoke-${fixture.RUN}` },
      });

      await probe.ok({
        id: 'calculated-fields-try',
        title: 'POST /versions/:versionId/try ejecuta sin persistir',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/try`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
        body: { inputs: { debt: 500, income: 2000 } },
      });

      await probe.invalid({
        id: 'calculated-fields-try',
        case: 'missing-inputs',
        title: 'POST /try exige las entradas declaradas',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/try`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
        body: {},
        expect: { status: 400, errorCode: 'HTTP_400' },
      });

      await probe.ok({
        id: 'calculated-fields-test',
        title: 'POST /versions/:versionId/test corre los casos declarados',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/test`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN'],
      });

      await probe.ok({
        id: 'calculated-fields-promote',
        title: 'POST /versions/:versionId/promote avanza el gobierno',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/promote`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'PLATFORM_ADMIN'],
        body: { status: 'IN_REVIEW', note: 'Promovido por el smoke.' },
      });

      await probe.invalid({
        id: 'calculated-fields-promote',
        case: 'unknown-status',
        title: 'POST /promote rechaza un estado fuera del ciclo',
        method: 'POST',
        path: `/v1/calculated-fields/versions/${versionIdCf}/promote`,
        roles: ['RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'PLATFORM_ADMIN'],
        body: { status: 'INVENTADO' },
        expect: { status: 400, errorCode: 'HTTP_400' },
      });
    }
  }

  // --- Árboles anidados: referencias entre artefactos. ---------------------------------
  reporter.startPhase('autoría · árboles anidados');

  await probe.ok({
    id: 'references-list',
    title: 'GET /v1/artifact-versions/:versionId/references',
    path: `/v1/artifact-versions/${versionId}/references?page=1&pageSize=25`,
    roles: READ,
  });

  await probe.ok({
    id: 'dependency-graph',
    title: 'GET /v1/artifacts/:artifactId/dependency-graph',
    path: `/v1/artifacts/${artifactId}/dependency-graph`,
    roles: READ,
  });

  /**
   * Las referencias sólo se editan sobre un BORRADOR.
   *
   * La versión que sostiene el ciclo de vida ya está compilada y en revisión a estas
   * alturas, así que escribir sobre ella devolvería `VERSION_IMMUTABLE` —correcto, pero
   * mediría la inmutabilidad y no la ruta. Se usa un borrador nuevo para que lo que se
   * observe sea el tratamiento de la referencia en sí.
   */
  const draft = await probe.send({
    method: 'POST',
    path: '/v1/artifacts',
    body: fixture.createArtifact(`SMOKE_REFS_${fixture.RUN}`),
  });
  const draftVersionId = draft.ok ? draft.body?.versions?.[0]?.id : undefined;

  // Quien no puede crear su propio borrador usa el clon que dejó el dueño: sigue siendo un
  // borrador real, que es lo que estas rutas necesitan para que el 403 o el 404 signifiquen
  // lo que deben.
  const referenceVersionId = draftVersionId ?? state.lifecycle?.clonedVersionId;
  if (!referenceVersionId) {
    throw new Error('no hay borrador sobre el que probar las referencias; corre `yarn smoke:full`');
  } else {
    await probe.invalid({
      id: 'references-create',
      case: 'unknown-child',
      title: 'POST de una referencia a un artefacto hijo inexistente',
      method: 'POST',
      path: `/v1/artifact-versions/${referenceVersionId}/references`,
      roles: AUTHOR,
      body: {
        nodeKey: 'CHECK',
        childArtifactId: '9007199254740991',
        childArtifactVersionId: '9007199254740991',
        inputMapping: [{ childVariableCode: inputCode, source: 'VARIABLE', path: `variables.${inputCode}` }],
        outputMapping: [{ childOutputCode: 'decision' }],
      },
      expect: {
        statusIn: [400, 404, 409],
        errorCode: [
          'ARTIFACT_NOT_FOUND',
          'VERSION_NOT_FOUND',
          'REFERENCE_CHILD_NOT_FOUND',
          'CHILD_ARTIFACT_NOT_FOUND',
          'REFERENCE_NODE_NOT_FOUND',
          'INVALID_ID',
          'HTTP_400',
        ],
      },
    });

    await probe.invalid({
      id: 'references-create',
      case: 'malformed-node-key',
      title: 'POST de una referencia rechaza una clave de nodo inválida',
      method: 'POST',
      path: `/v1/artifact-versions/${referenceVersionId}/references`,
      roles: AUTHOR,
      body: {
        nodeKey: 'clave con espacios',
        childArtifactId: '1',
        childArtifactVersionId: '1',
        inputMapping: [],
        outputMapping: [],
      },
      expect: { status: 400, errorCode: 'HTTP_400' },
    });

    await probe.invalid({
      id: 'references-update',
      case: 'unknown-reference',
      title: 'PUT de una referencia inexistente',
      method: 'PUT',
      path: `/v1/artifact-versions/${referenceVersionId}/references/9007199254740991`,
      roles: AUTHOR,
      body: { timeoutMs: 1000 },
      expect: {
        statusIn: [400, 404],
        errorCode: ['REFERENCE_NOT_FOUND', 'ARTIFACT_REFERENCE_NOT_FOUND', 'INVALID_ID', 'HTTP_404'],
      },
    });

    await probe.invalid({
      id: 'references-delete',
      case: 'unknown-reference',
      title: 'DELETE de una referencia inexistente',
      method: 'DELETE',
      path: `/v1/artifact-versions/${referenceVersionId}/references/9007199254740991`,
      roles: AUTHOR,
      expect: {
        statusIn: [400, 404],
        errorCode: ['REFERENCE_NOT_FOUND', 'ARTIFACT_REFERENCE_NOT_FOUND', 'INVALID_ID', 'HTTP_404'],
      },
    });

    // Escribir una referencia sobre la versión ya compilada SÍ debe fallar por inmutable:
    // es la garantía de que una versión en revisión no se puede alterar por debajo.
    await probe.invalid({
      id: 'references-create',
      case: 'immutable-version',
      title: 'POST de una referencia sobre una versión ya compilada es rechazado',
      method: 'POST',
      path: `/v1/artifact-versions/${versionId}/references`,
      roles: AUTHOR,
      body: {
        nodeKey: 'CHECK',
        childArtifactId: '1',
        childArtifactVersionId: '1',
        inputMapping: [],
        outputMapping: [],
      },
      expect: { status: 409, errorCode: 'VERSION_IMMUTABLE' },
    });
  }
}

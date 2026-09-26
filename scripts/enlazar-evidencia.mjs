/**
 * Enlaza evidencia a los requisitos de política que no la tienen.
 *
 * Existe porque la matriz de cobertura marcaba 0 % y NO era un error de cálculo:
 * en la base había 27 objetivos, 27 requisitos y CERO enlaces de evidencia. El
 * denominador estaba mal (ver `traceability.service.ts`), pero el numerador era
 * cierto: nadie había conectado nunca un artefacto ni una suite a una política.
 *
 * Pasa por los endpoints REALES —`POST /v1/traceability/policies/:id/artifacts`
 * y `…/test-suites`—, no por SQL. La diferencia no es de estilo: el servicio
 * escribe un evento de auditoría por enlace (`POLICY_ARTIFACT_LINKED`,
 * `POLICY_TEST_LINKED`) sobre una bitácora encadenada por hash. Sembrar las
 * filas a mano dejaría enlaces de gobierno sin rastro de quién los creó, que en
 * un sistema de cumplimiento es peor que no tenerlos.
 *
 * Uso (desde la raíz del motor, con el `.env` de siempre):
 *
 *   node scripts/enlazar-evidencia.mjs                       # dice qué haría, no escribe
 *   node scripts/enlazar-evidencia.mjs --aplicar --limite 1  # escribe, sólo N requisitos
 *   node scripts/enlazar-evidencia.mjs --aplicar             # escribe todos
 *
 * `--limite` está porque sembrar la matriz entera casi nunca es lo que se
 * quiere: cada enlace deja un asiento en la bitácora encadenada, que no se
 * borra. Para enseñar que el camino funciona basta UNO; el resto lo enlaza una
 * persona eligiendo el artefacto que de verdad implementa cada política.
 *
 * La credencial la resuelve `resolvePrincipal('approver')`: usa el proveedor de
 * identidad si `SMOKE_APPROVER_EMAIL`/`_PASSWORD` están definidos, y si no la
 * clave de API acotada a COMPLIANCE que el propio smoke registra. No hay ningún
 * secreto en este archivo.
 */
import { items, request } from './smoke/lib/http.mjs';
import { provisionApiKeyClients, resolvePrincipal } from './smoke/lib/principals.mjs';

const APLICAR = process.argv.includes('--aplicar');

/** `--limite N`, o `Infinity` si no se pide tope. Un valor inválido para el script. */
function limite() {
  const posicion = process.argv.indexOf('--limite');
  if (posicion === -1) return Infinity;
  const valor = Number(process.argv[posicion + 1]);
  if (!Number.isInteger(valor) || valor < 1) {
    throw new Error('--limite espera un entero de 1 en adelante.');
  }
  return valor;
}

async function todosLosObjetivos(auth) {
  const encontrados = [];
  for (let page = 1; page <= 20; page += 1) {
    const respuesta = await request({
      path: `/v1/traceability/objectives?page=${page}&pageSize=100`,
      auth,
    });
    if (!respuesta.ok) {
      throw new Error(`No se pudo listar objetivos (HTTP ${respuesta.status}): ${respuesta.text}`);
    }
    const pagina = items(respuesta.body);
    encontrados.push(...pagina);
    if (pagina.length < 100) break;
  }
  return encontrados;
}

async function primerCandidato(auth, path, etiqueta) {
  const respuesta = await request({ path, auth });
  if (!respuesta.ok) {
    throw new Error(`No se pudo leer ${etiqueta} (HTTP ${respuesta.status}): ${respuesta.text}`);
  }
  return items(respuesta.body);
}

async function main() {
  await provisionApiKeyClients().catch((error) => {
    // Sin base no se pueden registrar los clientes, pero el camino JWT puede seguir valiendo.
    console.warn(`Aviso: no se registraron clientes de API (${error.message}).`);
  });
  const auth = await resolvePrincipal('approver');
  console.log(`Credencial: ${auth.authMethod} · roles ${auth.roles.join(', ')}`);

  const objetivos = await todosLosObjetivos(auth);
  const requisitos = objetivos.flatMap((objetivo) =>
    (objetivo.policyRequirements ?? []).map((requisito) => ({
      objetivo: objetivo.objectiveCode,
      id: String(requisito.id),
      codigo: requisito.policyCode,
      artefactos: (requisito.artifactLinks ?? []).length,
      pruebas: (requisito.testLinks ?? []).length,
    })),
  );
  const sinEvidencia = requisitos.filter((r) => !r.artefactos || !r.pruebas);
  const tope = limite();
  const pendientes = sinEvidencia.slice(0, tope === Infinity ? undefined : tope);
  console.log(`${requisitos.length} requisitos, ${sinEvidencia.length} sin evidencia completa.`);
  // Un tope silencioso se leería como «ya no quedaba nada»; se dice qué se deja fuera.
  if (pendientes.length < sinEvidencia.length) {
    console.log(
      `Tope --limite ${tope}: se tocan ${pendientes.length} y se dejan ${sinEvidencia.length - pendientes.length} sin enlazar.`,
    );
  }
  if (!pendientes.length) return;

  const versiones = await primerCandidato(
    auth,
    '/v1/views/pickers/artifact-versions',
    'las versiones de artefacto',
  );
  const suites = await primerCandidato(
    auth,
    '/v1/views/pickers/test-suites',
    'las suites de prueba',
  );
  if (!versiones.length || !suites.length) {
    throw new Error(
      `Nada que enlazar: ${versiones.length} versiones y ${suites.length} suites en el catálogo. ` +
        'Publica al menos un artefacto con su suite antes de sembrar cobertura.',
    );
  }

  /*
   * Las dos patas tienen que ser del MISMO artefacto.
   *
   * «La primera versión y la primera suite» parece equivalente y no lo es: si la
   * suite pertenece a otro artefacto, el requisito queda COMPLETO enseñando una
   * versión que nadie probó y una prueba que no ejercita esa versión. Es la
   * forma exacta de mentira que la matriz existe para detectar, y quedaría
   * escrita en la auditoría. La primera vez salió coherente por casualidad.
   *
   * Esto sigue sin decidir qué artefacto implementa qué política —eso lo hace
   * una persona desde «Vincular»—, pero al menos la evidencia no se contradice.
   */
  const emparejado = versiones
    .map((version) => ({
      version,
      suite: suites.find((s) => String(s.artifactVersionId) === String(version.id)),
    }))
    .find((par) => par.suite);
  if (!emparejado) {
    throw new Error(
      'Ninguna versión del catálogo tiene una suite propia. Enlazar una versión con la suite ' +
        'de otro artefacto marcaría COMPLETO algo que nadie probó; se prefiere no sembrar nada.',
    );
  }
  const versionId = String(emparejado.version.id);
  const suiteId = String(emparejado.suite.id);
  console.log(
    `Enlazaría versión ${versionId} (${emparejado.version.artifactCode ?? '?'}) y su suite ` +
      `${suiteId} (${emparejado.suite.suiteCode ?? '?'}) a cada requisito pendiente.`,
  );
  if (!APLICAR) {
    console.log('Ensayo. Vuelve a correrlo con --aplicar para escribir.');
    return;
  }

  let hechos = 0;
  for (const requisito of pendientes) {
    for (const [ruta, cuerpo, tenia] of [
      ['artifacts', { artifactVersionId: versionId }, requisito.artefactos],
      ['test-suites', { testSuiteId: suiteId }, requisito.pruebas],
    ]) {
      if (tenia) continue;
      const respuesta = await request({
        method: 'POST',
        path: `/v1/traceability/policies/${requisito.id}/${ruta}`,
        body: cuerpo,
        auth,
      });
      if (!respuesta.ok) {
        console.error(`  ✗ ${requisito.codigo} → ${ruta}: HTTP ${respuesta.status} ${respuesta.text}`);
        continue;
      }
      hechos += 1;
    }
    console.log(`  ✓ ${requisito.objetivo} · ${requisito.codigo}`);
  }
  console.log(`${hechos} enlaces creados. Recarga /coverage-matrix.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

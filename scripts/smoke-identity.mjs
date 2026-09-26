#!/usr/bin/env node
/**
 * Smoke del worker de verificación de identidad, de extremo a extremo y por HTTP.
 *
 * Es lo que ninguna otra prueba cubre. Las unitarias ejercitan el pipeline
 * absorbido en proceso; ésta recorre el camino completo:
 *
 *   API acepta → fila encolada → pg_notify → worker reclama → pipeline →
 *   veredicto persistido → veredicto consultable por HTTP
 *
 * Si algo de ese recorrido está mal cableado —el trabajo sin registrar, el
 * aviso sin emitir, el módulo sin cargar— ninguna de las otras lo nota y ésta
 * falla en la primera vuelta.
 *
 * Uso: node scripts/smoke-identity.mjs
 * Requiere MANAGEMENT_API_KEY (lo toma de .env).
 */
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  } catch {
    // Sin .env se depende de las variables ya exportadas: es el caso de CI.
  }
}
loadEnv();

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const API_KEY = process.env.MANAGEMENT_API_KEY;
const TENANT_ID = process.env.BOOTSTRAP_TENANT_ID ?? '1';

if (!API_KEY) {
  console.error('Falta MANAGEMENT_API_KEY. Sin credencial no hay smoke que valga.');
  process.exit(2);
}

const headers = { 'x-api-key': API_KEY, 'x-tenant-id': TENANT_ID };

let fallos = 0;
function check(ok, titulo, detalle = '') {
  console.log(`${ok ? '  OK  ' : ' FALLO'} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
  if (!ok) fallos += 1;
  return ok;
}

/** El motor devuelve un ARRAY DESNUDO en las colecciones no paginadas. */
function items(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function api(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

const TERMINALES = ['SUCCEEDED', 'SUCCEEDED_WITH_WARNINGS', 'FAILED', 'CANCELLED'];

async function esperarTerminal(requestId, maxSegundos = 120) {
  const vistos = new Set();
  for (let i = 0; i < maxSegundos; i += 1) {
    const { status, body } = await api(`/v1/workers/identity-verification/runs/${requestId}`);
    if (status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    if (status !== 200) return { error: `consulta devolvió ${status}` };
    vistos.add(body.status);
    if (TERMINALES.includes(body.status)) return { run: body, vistos: [...vistos] };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { error: 'la ejecución no alcanzó un estado terminal', vistos: [...vistos] };
}

/** Encola un escenario y espera su desenlace. */
async function correrEscenario(fixtureCode, idempotencyKey) {
  const form = new FormData();
  form.append('fixtureCode', fixtureCode);
  if (idempotencyKey) form.append('idempotencyKey', idempotencyKey);
  const creada = await api('/v1/workers/identity-verification/runs', {
    method: 'POST',
    body: form,
  });
  if (creada.status !== 202) return { error: `POST devolvió ${creada.status}`, body: creada.body };
  return esperarTerminal(creada.body.requestId);
}

console.log(`\nSmoke del worker de identidad contra ${BASE_URL}\n`);

// 1. El catálogo lo declara, con sus límites y su proveedor.
const catalogo = await api('/v1/workers');
check(catalogo.status === 200, 'GET /v1/workers responde 200', `status=${catalogo.status}`);
const identidad = items(catalogo.body).find((w) => w.code === 'identity-verification');
check(Boolean(identidad), 'el catálogo declara el worker de identidad');
check(identidad?.available === true, 'se declara disponible', String(identidad?.available));
/*
 * Los proveedores se publican a propósito: son lo que dice qué afirma un
 * «VERIFICADO». Se comprueban por NOMBRE y no sólo por tipo — que sean cadenas
 * lo cumpliría también un motor que hubiera vuelto a los simulados—.
 */
check(
  identidad?.limits?.ocrProvider === 'tesseract' && identidad?.limits?.faceProvider === 'human',
  'los proveedores publicados son los reales y locales',
  `ocr=${identidad?.limits?.ocrProvider} rostro=${identidad?.limits?.faceProvider} vida=${identidad?.limits?.livenessProvider}`,
);
check(
  identidad?.limits?.thresholdProfile !== undefined,
  'publica el perfil de umbrales',
  String(identidad?.limits?.thresholdProfile),
);

// 2. Los dos workers anteriores siguen en el catálogo. La regresión más barata
//    que existe: añadir un worker no puede hacer desaparecer los otros.
const codigos = items(catalogo.body).map((w) => w.code);
check(
  codigos.includes('bank-statement') && codigos.includes('semantic-analysis'),
  'los dos workers anteriores siguen publicados',
  codigos.join(', '),
);

// 3. Los escenarios se sirven.
const fixtures = await api('/v1/workers/identity-verification/fixtures');
check(fixtures.status === 200, 'GET fixtures responde 200', `status=${fixtures.status}`);
const codigosFixture = items(fixtures.body).map((f) => f.code);
check(codigosFixture.includes('identidad-aprobada'), 'existe el escenario aprobado');

// 4. Camino feliz.
console.log('\n  … verificación limpia\n');
const sello = new Date().toISOString();
const limpia = await correrEscenario('identidad-aprobada', sello);
if (limpia.error) {
  check(false, 'la verificación alcanza un estado terminal', limpia.error);
  console.error(`\n  estados vistos: ${(limpia.vistos ?? []).join(' → ') || 'ninguno'}`);
  console.error('  Un QUEUED perpetuo significa que el worker no reclamó: revisa');
  console.error('  IDENTITY_VERIFICATION_WORKER_ENABLED y WORKER_ROLE en el proceso worker.\n');
  process.exit(1);
}
const run = limpia.run;
check(run.status === 'SUCCEEDED', 'termina con éxito', run.status);
check(run.progress === 100, 'el progreso llega a 100', String(run.progress));
check(run.result?.decision === 'VERIFIED', 'el veredicto es VERIFICADO', run.result?.decision);
check(
  run.result?.fields?.fullName?.value === 'MARIA RENEE RODRIGUEZ GONZALEZ',
  'el analizador leyó los rótulos del anverso',
  String(run.result?.fields?.fullName?.value),
);
// Y el número y la fecha salen de la MRZ del reverso, no del texto impreso: es
// la única fuente del documento que trae dígitos de control.
check(
  run.result?.fields?.documentNumber?.source === 'MRZ',
  'el número viene de la MRZ, que se puede verificar',
  String(run.result?.fields?.documentNumber?.source),
);
check(
  run.result?.fields?.dateOfBirth?.value === '2003-04-05',
  'la fecha de nacimiento sale de la MRZ',
  String(run.result?.fields?.dateOfBirth?.value),
);

/*
 * La comparación biométrica OCURRIÓ, y el veredicto la incluye.
 *
 * Sin esto, un motor que hubiera vuelto a los proveedores simulados pasaría
 * igual este smoke: el escenario limpio seguiría saliendo VERIFICADO. Lo que
 * distingue una cosa de la otra es que haya una cifra medida, que la firme un
 * proveedor real y que conste el perfil contra el que se comparó.
 */
check(
  typeof run.result?.faceMatch?.similarityScore === 'number' &&
    run.result.faceMatch.comparable === true,
  'hay un parecido MEDIDO entre las dos caras',
  String(run.result?.faceMatch?.similarityScore),
);
check(
  run.result?.providers?.face === 'human',
  'y lo midió el comparador real, no un simulado',
  String(run.result?.providers?.face),
);
/*
 * Y la ejecución lleva la marca de que su entrada la fabricó el motor: sobre una
 * imagen generada la prueba de vida NO se ejecuta —una imagen fabricada no es
 * una captura en vivo—, y decirlo es lo que impide leer este «VERIFICADO» como
 * uno de una persona ante la cámara.
 */
check(
  run.result?.liveness?.outcome === 'NOT_RUN' &&
    (run.result?.riskFlags ?? []).includes('GENERATED_INPUT_NO_LIVENESS'),
  'y consta que la prueba de vida no corrió, por ser una entrada de escenario',
  `${run.result?.liveness?.outcome} · ${(run.result?.riskFlags ?? []).join(',')}`,
);
// El encuadre se afirma donde significa algo: en la foto sobre un escritorio.
// Sobre una tarjeta a sangre el recorte apenas quita el margen (~94 %), que no
// distingue un recorte que funciona de uno que no hace nada.
console.log('\n  … cedula sobre un escritorio\n');
const escritorio = await correrEscenario('identidad-sobre-escritorio', sello);
check(
  escritorio.run?.result?.framing?.recortado === true,
  'el fondo se recorta antes de leer',
  JSON.stringify(escritorio.run?.result?.framing),
);
check(
  (escritorio.run?.result?.framing?.areaConservada ?? 1) < 0.5,
  'y el recorte es de verdad: sobrevive menos de la mitad de la foto',
  String(escritorio.run?.result?.framing?.areaConservada),
);
/*
 * Y aun así el documento se LEE. Se afirma sobre el nombre y la caducidad, no
 * sobre el número.
 *
 * El número es lo primero que se pierde a esa distancia: en esta misma máquina
 * se lee fuera del contenedor y NO se lee dentro, con la única diferencia de la
 * versión de la librería de imagen. Exigirlo aquí convertiría este smoke en un
 * detector de versiones de libvips. Que se pierda no queda escondido: sale como
 * marca de riesgo `DOCUMENT_NUMBER_NOT_FOUND` y manda la verificación a
 * revisión, que es lo que debe pasar cuando falta un campo que sostiene una
 * identidad.
 */
check(
  escritorio.run?.result?.fields?.fullName?.value === 'MARIA RENEE RODRIGUEZ GONZALEZ' &&
    escritorio.run?.result?.fields?.expirationDate?.value === '2028-11-01',
  'y aun así el documento se lee: nombre y caducidad salen enteros',
  `${escritorio.run?.result?.fields?.fullName?.value} · ${escritorio.run?.result?.fields?.expirationDate?.value}`,
);
// El enmascarado vive en el motor, no en la pantalla: lo que se guarda en la
// fila es este objeto, y una consola de base de datos lo leería igual.
check(
  /^•+\d{3}$/.test(String(run.result?.fields?.documentNumber?.value ?? '')),
  'el número de documento viaja enmascarado',
  String(run.result?.fields?.documentNumber?.value),
);
check(
  !JSON.stringify(run).includes('1234567'),
  'el número completo no aparece en ninguna parte de la respuesta',
);

/*
 * 5. Los otros desenlaces, que son lo que el escenario promete en la pantalla.
 *
 * Ya no está «identidad-sin-comparacion»: con biometría real ese estado no es
 * alcanzable desde una cédula con retrato —en cuanto el detector encuentra la
 * cara, el descriptor devuelve rasgos— y el motor dejó de anunciarlo. Lo
 * sustituye «identidad-sin-retrato», que se comprueba abajo entre los que fallan
 * a propósito.
 */
for (const [fixture, esperado] of [
  ['identidad-rechazada', 'NOT_VERIFIED'],
  ['identidad-caducada', 'NOT_VERIFIED'],
]) {
  console.log(`\n  … ${fixture}\n`);
  const resultado = await correrEscenario(fixture, sello);
  check(
    !resultado.error && resultado.run?.result?.decision === esperado,
    `«${fixture}» decide ${esperado}`,
    resultado.error ?? String(resultado.run?.result?.decision),
  );
  // Un veredicto negativo NO es una ejecución fallida: el worker hizo su
  // trabajo. Confundirlos mezclaría «el rostro no coincide» con «el proveedor
  // se cayó» en el panel de incidencias.
  check(
    resultado.run?.status === 'SUCCEEDED_WITH_WARNINGS',
    `«${fixture}» termina con advertencias, no como fallo`,
    String(resultado.run?.status),
  );
}

// 6. Una imagen que NO es un documento se rechaza. Es la comprobación que el
//    worker no tenía: con un lector simulado, una foto cualquiera terminaba
//    VERIFICADA porque el OCR inventaba una cédula.
console.log('\n  … imagen cualquiera\n');
const cualquiera = await correrEscenario('imagen-cualquiera', sello);
check(
  cualquiera.run?.status === 'FAILED',
  'una foto sin documento no produce veredicto',
  String(cualquiera.run?.status),
);
check(
  cualquiera.run?.errorCode === 'IDENTITY_DOCUMENT_UNSUPPORTED',
  'se rechaza por no ser un documento de identidad',
  String(cualquiera.run?.errorCode),
);
check(
  /no se pudo leer/i.test(String(cualquiera.run?.errorMessage ?? '')),
  'y el mensaje dice qué hacer con ella',
  String(cualquiera.run?.errorMessage),
);
// Nunca llega a comparar rostros: no hay nada contra qué comparar.
check(
  cualquiera.run?.result === undefined || cualquiera.run?.result === null,
  'sin resultado: se corta antes de la comparación biométrica',
);

/*
 * 6 bis. La fotocopia sin retrato: se corta ANTES de comparar.
 *
 * Es la comprobación de que el motor no se inventa un parecido que no puede
 * medir. Va aquí y no arriba porque su desenlace no es un veredicto, es un error
 * de validación — y esa diferencia es justamente lo que se comprueba.
 */
console.log('\n  … documento sin retrato\n');
const sinRetrato = await correrEscenario('identidad-sin-retrato', sello);
check(
  sinRetrato.run?.status === 'FAILED',
  'un documento sin retrato no produce veredicto',
  String(sinRetrato.run?.status),
);
check(
  sinRetrato.run?.errorCode === 'IDENTITY_FACE_NOT_FOUND',
  'y el código dice que faltó el rostro, no que no se pareciera',
  String(sinRetrato.run?.errorCode),
);

// 7. El escenario que promete error de calidad, falla — y de forma controlada.
console.log('\n  … foto inservible\n');
const mala = await correrEscenario('identidad-foto-mala', sello);
check(mala.run?.status === 'FAILED', 'la foto inservible falla', String(mala.run?.status));
check(
  mala.run?.errorCode === 'IDENTITY_DOCUMENT_BLURRY',
  'con un código que dice qué pasó',
  String(mala.run?.errorCode),
);
check(
  mala.run?.attemptCount === 1,
  'y sin reintentar: una foto borrosa lo estará las tres veces',
  String(mala.run?.attemptCount),
);

// 8. Entrada inválida: sin imágenes, la API rechaza antes de encolar nada.
const vacia = await api('/v1/workers/identity-verification/runs', {
  method: 'POST',
  body: new FormData(),
});
check(vacia.status === 400, 'sin imágenes responde 400, no 500', `status=${vacia.status}`);
// El código va en `error.code` del sobre RFC 7807 del motor, no en la raíz.
check(
  typeof vacia.body?.error?.code === 'string' && vacia.body.error.code.startsWith('IDENTITY_'),
  'con un código de dominio, no un error genérico',
  String(vacia.body?.error?.code),
);
check(
  typeof vacia.body?.error?.message === 'string' && /documento/i.test(vacia.body.error.message),
  'y con un mensaje que dice cuál de las imágenes falta',
  String(vacia.body?.error?.message),
);

// 9. Idempotencia: las mismas imágenes devuelven la ejecución que ya existe.
const form = new FormData();
form.append('fixtureCode', 'identidad-aprobada');
form.append('idempotencyKey', sello);
const repetida = await api('/v1/workers/identity-verification/runs', {
  method: 'POST',
  body: form,
});
check(
  repetida.body?.requestId === run.requestId,
  'reenviar las mismas imágenes devuelve la ejecución existente',
  `${repetida.body?.requestId} vs ${run.requestId}`,
);

// 10. Las métricas del worker responden: es lo que alimenta el panel de control.
const metrics = await api('/v1/workers/identity-verification/metrics?windowHours=1');
check(metrics.status === 200, 'GET metrics responde 200', `status=${metrics.status}`);
check(metrics.body?.totalRuns > 0, 'el panel ve las ejecuciones', String(metrics.body?.totalRuns));

console.log(`\n${fallos === 0 ? 'Smoke en verde.' : `${fallos} comprobación(es) en rojo.`}\n`);
process.exit(fallos === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Comprueba que el Motor de un entorno publica los artefactos que Atlas le pide decidir.
 *
 * ## Por qué existe
 *
 * El 2026-09-28 el Motor de TEST sólo publicaba `IDENTIDAD_CARNET_MOVIL`, mientras AtlasBackend
 * apuntaba crédito a `ATLAS_BNPL_UNDERWRITING`, riesgo a `RIESGO_ONBOARDING_CLIENTE` y comercios a
 * `PARTNER_KYB_REVIEW`. Cada evaluación moría con `ACTIVE_DEPLOYMENT_NOT_FOUND` y nada avisaba: la
 * variable de entorno estaba puesta y el despliegue salió en verde. La pantalla «Motor de
 * decisiones» del portal era lo único que lo decía. Este guion lo dice ANTES de dar el entorno por
 * listo, y sale con código 1 para poder colgarlo de un despliegue o de una revisión de salida.
 *
 * Es de SÓLO LECTURA: no crea, no aprueba ni despliega nada. Publicar es
 * `docs/runbooks/artefactos-en-un-entorno-nuevo.md`.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base https://motor.example [--codes A,B] [--todos]
 *   MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base https://motor.example --exigir-despliegue --environments STAGING
 *
 * La lista sale de `lib/artefactos.manifiesto.json`: por defecto los `exigido` (los que AtlasBackend
 * necesita para decidir); `--todos` añade los demás salvo los de demostración; `--codes` la
 * sustituye. `--exigir-despliegue` comprueba además que cada uno tenga despliegue ACTIVO en cada
 * entorno de `--environments`: estar en el catálogo no basta, sin despliegue el Motor sigue
 * respondiendo `ACTIVE_DEPLOYMENT_NOT_FOUND`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, exit } from 'node:process';

const MANIFIESTO = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'lib', 'artefactos.manifiesto.json'),
    'utf8',
  ),
).artefactos;
const TODOS = argv.includes('--todos');
const POR_DEFECTO = MANIFIESTO.filter((fila) => (TODOS ? !fila.demo : fila.exigido)).map(
  (fila) => fila.codigo,
);

export function faltantes(requeridos, publicados) {
  const presentes = new Set(publicados);
  return requeridos.filter((codigo) => !presentes.has(codigo));
}

/**
 * ¿El grafo abre caso donde dice «revisión»?
 *
 * Un nodo `RESULT` que emite `REVISION_MANUAL` no crea ninguna bandeja, y el Motor lo rechaza con
 * 422 `MANUAL_REVIEW_WITHOUT_CASE`: cada expediente que debía ir a una persona moría ahí y la cola
 * salía vacía (2026-10-07, `PARTNER_KYB_REVIEW` v2). «Publicado» y «desplegado» no lo detectan.
 * Devuelve el tipo del nodo que decide la revisión, y si abre caso.
 */
export function revisionAbreCaso(grafo, nodoRevision = 'REVISAR') {
  const nodo = (grafo?.nodes ?? []).find((fila) => fila.key === nodoRevision);
  if (!nodo) return { abre: false, tipo: null };
  return { abre: nodo.type === 'MANUAL_REVIEW', tipo: nodo.type };
}

/** Artefactos cuyo desenlace de revisión TIENE que abrir caso, y el nodo que lo decide. */
const ABRE_CASO = { PARTNER_KYB_REVIEW: 'REVISAR' };

function opcion(nombre) {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main() {
  const base = (opcion('base') ?? env.DECISION_ENGINE_BASE_URL ?? '').replace(/\/+$/, '');
  const clave = env.MANAGEMENT_API_KEY;
  const tenant = opcion('tenant') ?? env.DECISION_ENGINE_TENANT_ID ?? '1';
  const requeridos = (opcion('codes') ?? POR_DEFECTO.join(','))
    .split(',')
    .map((codigo) => codigo.trim())
    .filter(Boolean);

  if (!base || !clave) {
    console.error('Faltan --base (o DECISION_ENGINE_BASE_URL) y MANAGEMENT_API_KEY.');
    exit(2);
  }

  const entornos = (opcion('environments') ?? '')
    .split(',')
    .map((codigo) => codigo.trim())
    .filter(Boolean);
  const exigirDespliegue = argv.includes('--exigir-despliegue');
  if (exigirDespliegue && entornos.length === 0) {
    console.error('--exigir-despliegue necesita --environments: ¿activo en qué entorno?');
    exit(2);
  }

  async function paginas(ruta, queEs) {
    const filas = [];
    for (let page = 1; page < 50; page += 1) {
      const respuesta = await fetch(`${base}${ruta}page=${page}&pageSize=100`, {
        headers: { 'x-api-key': clave, 'x-tenant-id': tenant },
      });
      if (!respuesta.ok) {
        console.error(`GET ${ruta} → ${respuesta.status}. Sin ${queEs} no hay veredicto.`);
        exit(2);
      }
      const cuerpo = await respuesta.json();
      filas.push(...(Array.isArray(cuerpo) ? cuerpo : (cuerpo?.items ?? cuerpo?.data ?? [])));
      if (!cuerpo?.hasNextPage) break;
    }
    return filas;
  }

  const publicados = (await paginas('/v1/artifacts?', 'catálogo')).map(
    (fila) => fila.artifactCode ?? fila.code,
  );

  if (publicados.length === 0) {
    console.error('El Motor devolvió un catálogo VACÍO: no se puede afirmar que esté bien.');
    exit(2);
  }

  const faltan = faltantes(requeridos, publicados);
  for (const codigo of requeridos) {
    console.log(`${faltan.includes(codigo) ? 'FALTA ' : 'existe'}  ${codigo}`);
  }
  if (faltan.length > 0) {
    console.error(
      `\n${faltan.length} artefacto(s) sin publicar: la decisión correspondiente fallará con ACTIVE_DEPLOYMENT_NOT_FOUND.`,
    );
    exit(1);
  }

  if (!exigirDespliegue) return;
  const filasActivas = await paginas('/v1/deployments?status=ACTIVE&', 'despliegues');
  const activos = filasActivas.map(
    (fila) =>
      `${fila.artifactVersion?.artifact?.artifactCode ?? fila.artifactCode}@${fila.environment?.code ?? fila.environmentCode}`,
  );
  const esperados = requeridos.flatMap((codigo) =>
    entornos.map((entorno) => `${codigo}@${entorno}`),
  );
  const sinDespliegue = faltantes(esperados, activos);
  console.log('');
  for (const par of esperados) {
    console.log(`${sinDespliegue.includes(par) ? 'SIN DESPLIEGUE' : 'decide        '}  ${par}`);
  }
  if (sinDespliegue.length > 0) {
    console.error(
      `\n${sinDespliegue.length} sin despliegue activo: publicado no es desplegado, faltan las firmas o el --deploy.`,
    );
    exit(1);
  }

  // Desplegado no es suficiente: la versión activa tiene que abrir caso donde dice «revisión».
  let sinCaso = 0;
  for (const [codigo, nodo] of Object.entries(ABRE_CASO)) {
    if (!requeridos.includes(codigo)) continue;
    const fila = filasActivas.find(
      (activa) =>
        (activa.artifactVersion?.artifact?.artifactCode ?? activa.artifactCode) === codigo,
    );
    const versionId = fila?.artifactVersionId ?? fila?.artifactVersion?.id;
    if (!versionId) continue;
    const respuesta = await fetch(
      `${base}/v1/artifact-versions/${encodeURIComponent(versionId)}/graph`,
      {
        headers: { 'x-api-key': clave, 'x-tenant-id': tenant },
      },
    );
    if (!respuesta.ok) {
      console.error(
        `GET grafo de ${codigo} → ${respuesta.status}: no se puede afirmar que abra caso.`,
      );
      exit(2);
    }
    const { abre, tipo } = revisionAbreCaso(await respuesta.json(), nodo);
    console.log(
      `${abre ? 'abre caso    ' : 'SIN BANDEJA  '}  ${codigo} (${nodo} es ${tipo ?? 'inexistente'})`,
    );
    if (!abre) sinCaso += 1;
  }
  if (sinCaso > 0) {
    console.error(
      `\n${sinCaso} artefacto(s) desplegado(s) cuyo desenlace de revisión no abre caso: el Motor responde 422 MANUAL_REVIEW_WITHOUT_CASE y la cola sale vacía. Ver docs/runbooks/cola-de-revision-vacia.md.`,
    );
    exit(1);
  }
}

if (import.meta.url === `file://${argv[1]}`) {
  await main();
}

#!/usr/bin/env node
/**
 * Publica de una vez TODOS los artefactos del Motor en un entorno, como una semilla: un comando,
 * se puede repetir, y lo que ya está hecho no se toca.
 *
 * ## Por qué existe
 *
 * Cada artefacto tiene su guion (`atlas-underwriting-v2.mjs`, `riesgo-onboarding-cliente.mjs`…) y
 * cada uno con sus banderas: crédito pide `--crear` en un entorno vacío, tres aceptan
 * `--nueva-version`, los entornos por defecto no coinciden. Levantar un entorno era correr siete
 * guiones de memoria, y `publicar-artefactos-faltantes.sh` sólo conocía tres. El 2026-09-28 TEST
 * decidía identidad y nada más. Este guion lee la lista de `lib/artefactos.manifiesto.json`, mira
 * en el Motor en qué estado está cada uno y corre sólo lo que falta.
 *
 * ## Lo que NO hace
 *
 * No aprueba. Las dos firmas (QA_ANALYST y RISK_APPROVER, ninguna la autora) son de dos personas en
 * el portal del Motor: una semilla que firmara anularía el control. Publicar deja cada versión en
 * revisión; `--deploy-aprobadas` despliega las que YA tienen las dos firmas y lista las que no.
 *
 * ## Uso
 *
 *   MANAGEMENT_API_KEY=… node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments STAGING --dry-run
 *   MANAGEMENT_API_KEY=… node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments STAGING
 *   MANAGEMENT_API_KEY=<la del RELEASE_MANAGER> node scripts/publicar-todos-los-artefactos.mjs --base <url> --environments STAGING --deploy-aprobadas
 *
 *   --solo A,B          sólo esos códigos
 *   --solo-exigidos     sólo los que AtlasBackend necesita para decidir
 *   --incluir-demo      también los de demostración (`demo: true` en el manifiesto)
 *   --nueva-version     publica la definición del repo como versión nueva de los que ya deciden
 *   --estado            sólo la tabla; no corre ningún guion
 *
 * Sale 0 si no falló ningún guion, 1 si falló alguno (los demás se corren igual) y 2 si no pudo
 * leer el Motor. Paso a paso en `docs/runbooks/publicar-todos-los-artefactos.md`.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, env, execPath, exit } from 'node:process';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MANIFIESTO = JSON.parse(
  readFileSync(join(AQUI, 'lib', 'artefactos.manifiesto.json'), 'utf8'),
).artefactos;

const args = new Map();
for (let i = 2; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith('--')) continue;
  const next = argv[i + 1];
  if (!next || next.startsWith('--')) args.set(arg.slice(2), 'true');
  else {
    args.set(arg.slice(2), next);
    i += 1;
  }
}
const lista = (valor) =>
  (valor ?? '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);

const BASE = (args.get('base') ?? env.DECISION_ENGINE_BASE_URL ?? '').replace(/\/+$/, '');
const API_KEY = env.MANAGEMENT_API_KEY;
const TENANT_ID = args.get('tenant') ?? env.DECISION_ENGINE_TENANT_ID ?? '1';
const ENVIRONMENTS = lista(args.get('environments'));
const SOLO = lista(args.get('solo'));
const DRY_RUN = args.get('dry-run') === 'true';
const NUEVA_VERSION = args.get('nueva-version') === 'true';
const DEPLOY_APROBADAS = args.get('deploy-aprobadas') === 'true';
const SOLO_ESTADO = args.get('estado') === 'true';
const SOLO_EXIGIDOS = args.get('solo-exigidos') === 'true';
const INCLUIR_DEMO = args.get('incluir-demo') === 'true';

/** Estados que no continúa ningún guion: los resuelve una persona en el portal. */
const DE_UNA_PERSONA = new Set(['CHANGES_REQUESTED', 'REJECTED', 'SUSPENDED', 'RETIRED']);

async function api(path) {
  const respuesta = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': API_KEY, 'x-tenant-id': TENANT_ID },
  });
  if (!respuesta.ok) throw new Error(`GET ${path} → ${respuesta.status}`);
  return respuesta.json();
}

async function todasLasPaginas(path) {
  const filas = [];
  for (let page = 1; page < 50; page += 1) {
    const cuerpo = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=100`);
    filas.push(...(Array.isArray(cuerpo) ? cuerpo : (cuerpo?.items ?? cuerpo?.data ?? [])));
    if (!cuerpo?.hasNextPage) break;
  }
  return filas;
}

function elegidos() {
  const desconocidos = SOLO.filter((codigo) => !MANIFIESTO.some((fila) => fila.codigo === codigo));
  if (desconocidos.length) {
    console.error(`--solo nombra códigos que no están en el manifiesto: ${desconocidos.join(', ')}`);
    exit(2);
  }
  if (SOLO.length) return MANIFIESTO.filter((fila) => SOLO.includes(fila.codigo));
  return MANIFIESTO.filter(
    (fila) => (!fila.demo || INCLUIR_DEMO) && (!SOLO_EXIGIDOS || fila.exigido),
  );
}

/** Lo que el Motor sabe de un artefacto: su versión más alta y dónde tiene despliegue activo. */
async function leerEstado(fila, catalogo) {
  const artefacto = catalogo.find((item) => (item.artifactCode ?? item.code) === fila.codigo);
  if (!artefacto) return { existe: false, activos: [] };
  const detalle = await api(`/v1/artifacts/${artefacto.id}`);
  const ultima = (detalle.versions ?? []).reduce(
    (mejor, version) =>
      !mejor || Number(version.versionNumber) > Number(mejor.versionNumber) ? version : mejor,
    null,
  );
  const despliegues = await todasLasPaginas(
    `/v1/deployments?artifactCode=${encodeURIComponent(fila.codigo)}&status=ACTIVE`,
  );
  const activos = despliegues.map((despliegue) => ({
    entorno: despliegue.environment?.code ?? despliegue.environmentCode,
    versionId: String(despliegue.artifactVersionId ?? despliegue.artifactVersion?.id),
  }));
  return { existe: true, ultima, activos };
}

/**
 * Decide qué hacer con un artefacto. Es la única regla del guion, y es conservadora: ante un estado
 * que un guion no sabe continuar, no corre nada y lo dice.
 */
export function decidir(fila, estado, opciones) {
  const { entornos, nuevaVersion, deployAprobadas } = opciones;
  if (!estado.existe) {
    if (deployAprobadas) return { accion: 'nada', motivo: 'no existe: publícalo primero' };
    return { accion: 'publicar', banderas: fila.banderasAlCrear, motivo: 'no existe en el Motor' };
  }
  const { ultima, activos } = estado;
  if (!ultima) return { accion: 'nada', motivo: 'existe sin versiones: revísalo en el portal' };
  const status = String(ultima.status);
  const conDespliegue = activos.map((activo) => activo.entorno);
  const sinDecidir = entornos.filter((entorno) => !conDespliegue.includes(entorno));
  const decide = entornos.length ? sinDecidir.length === 0 : activos.length > 0;
  const laUltimaDecide =
    status.startsWith('DEPLOYED') ||
    activos.some((activo) => activo.versionId === String(ultima.id));

  if (status === 'APPROVED') {
    if (deployAprobadas) return { accion: 'desplegar', motivo: 'tiene las dos firmas' };
    return { accion: 'nada', motivo: 'aprobada: falta desplegarla (--deploy-aprobadas)' };
  }
  if (deployAprobadas) {
    if (status === 'IN_REVIEW') return { accion: 'nada', motivo: 'en revisión: faltan firmas' };
    if (decide && laUltimaDecide) return { accion: 'nada', motivo: 'ya decide' };
    return { accion: 'nada', motivo: `en ${status}: no está aprobada` };
  }
  if (status === 'IN_REVIEW') {
    return { accion: 'nada', motivo: 'en revisión: faltan las dos firmas en el portal' };
  }
  if (DE_UNA_PERSONA.has(status)) {
    return { accion: 'nada', motivo: `en ${status}: lo resuelve una persona en el portal` };
  }
  if (laUltimaDecide) {
    if (nuevaVersion) {
      if (!fila.banderasNuevaVersion) {
        return { accion: 'nada', motivo: 'su guion no publica versiones nuevas' };
      }
      return { accion: 'publicar', banderas: fila.banderasNuevaVersion, motivo: 'versión nueva' };
    }
    if (decide) return { accion: 'nada', motivo: 'ya decide' };
    return {
      accion: 'nada',
      motivo: `desplegada, pero sin despliegue activo en ${sinDecidir.join(',')}`,
    };
  }
  if (fila.estadosQueReanuda.includes(status)) {
    return { accion: 'publicar', banderas: [], motivo: `continúa la versión en ${status}` };
  }
  return { accion: 'nada', motivo: `en ${status}: su guion no la continúa; revísala en el portal` };
}

function correr(fila, extra) {
  const comando = [join(AQUI, fila.guion), '--base', BASE, '--tenant', TENANT_ID, ...extra];
  if (ENVIRONMENTS.length) comando.push('--environments', ENVIRONMENTS.join(','));
  if (DRY_RUN) comando.push('--dry-run');
  console.log(`\n== ${fila.codigo} · node scripts/${fila.guion} ${comando.slice(1).join(' ')}`);
  const resultado = spawnSync(execPath, comando, { stdio: 'inherit', env });
  return resultado.status === 0;
}

function tabla(filas) {
  const ancho = Math.max(...filas.map((fila) => fila.codigo.length));
  console.log('');
  for (const fila of filas) {
    console.log(
      `${fila.resultado.padEnd(16)} ${fila.codigo.padEnd(ancho)}  ${fila.version.padEnd(22)} ${fila.motivo}`,
    );
  }
}

async function main() {
  if (!BASE || !API_KEY) {
    console.error('Faltan --base (o DECISION_ENGINE_BASE_URL) y MANAGEMENT_API_KEY.');
    exit(2);
  }
  if (DEPLOY_APROBADAS && !ENVIRONMENTS.length) {
    console.error('--deploy-aprobadas exige --environments: desplegar no tiene valor por defecto.');
    exit(2);
  }
  const filas = elegidos();
  let catalogo;
  try {
    catalogo = await todasLasPaginas('/v1/artifacts');
  } catch (error) {
    console.error(`${error.message}. Sin catálogo no se publica a ciegas.`);
    exit(2);
  }

  const resumen = [];
  for (const fila of filas) {
    let estado;
    try {
      estado = await leerEstado(fila, catalogo);
    } catch (error) {
      resumen.push({ codigo: fila.codigo, resultado: 'FALLÓ', version: '-', motivo: error.message });
      continue;
    }
    const paso = decidir(fila, estado, {
      entornos: ENVIRONMENTS,
      nuevaVersion: NUEVA_VERSION,
      deployAprobadas: DEPLOY_APROBADAS,
    });
    const version = estado.ultima
      ? `v${estado.ultima.versionNumber} id ${estado.ultima.id} ${estado.ultima.status}`
      : '-';
    if (paso.accion === 'nada' || SOLO_ESTADO) {
      const pendiente = paso.accion === 'nada' ? 'sin tocar' : `haría: ${paso.accion}`;
      const banderas = paso.banderas?.length ? ` [${paso.banderas.join(' ')}]` : '';
      resumen.push({
        codigo: fila.codigo,
        resultado: pendiente,
        version,
        motivo: `${paso.motivo}${banderas}`,
      });
      continue;
    }
    if (fila.requisito) console.log(`\n(${fila.codigo}: ${fila.requisito})`);
    const bien =
      paso.accion === 'desplegar'
        ? correr(fila, ['--deploy', String(estado.ultima.id)])
        : correr(fila, paso.banderas);
    const hecho = paso.accion === 'desplegar' ? 'desplegado' : 'publicado';
    resumen.push({
      codigo: fila.codigo,
      resultado: bien ? (DRY_RUN ? 'ensayado' : hecho) : 'FALLÓ',
      version,
      motivo: bien ? paso.motivo : `el guion salió con error (${paso.motivo})`,
    });
  }

  tabla(resumen);
  const fallos = resumen.filter((fila) => fila.resultado === 'FALLÓ').length;
  if (!DEPLOY_APROBADAS && !SOLO_ESTADO && !DRY_RUN) {
    console.log(
      '\nLo publicado queda EN REVISIÓN. Faltan dos firmas en el portal del Motor (QA_ANALYST y ' +
        'RISK_APPROVER, ninguna la autora) y después --deploy-aprobadas con la credencial del RELEASE_MANAGER.',
    );
  }
  if (fallos) {
    console.error(`\n${fallos} artefacto(s) fallaron; los demás se procesaron.`);
    exit(1);
  }
}

if (import.meta.url === `file://${argv[1]}`) {
  await main();
}

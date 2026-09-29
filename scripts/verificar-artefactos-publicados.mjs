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
 *   MANAGEMENT_API_KEY=… node scripts/verificar-artefactos-publicados.mjs --base https://motor.example [--codes A,B]
 *
 * `--codes` sustituye la lista por defecto (los cuatro que consume AtlasBackend).
 */
import { argv, env, exit } from 'node:process';

const POR_DEFECTO = [
  'IDENTIDAD_CARNET_MOVIL',
  'ATLAS_BNPL_UNDERWRITING',
  'RIESGO_ONBOARDING_CLIENTE',
  'PARTNER_KYB_REVIEW',
];

export function faltantes(requeridos, publicados) {
  const presentes = new Set(publicados);
  return requeridos.filter((codigo) => !presentes.has(codigo));
}

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

  const publicados = [];
  for (let page = 1; page < 50; page += 1) {
    const respuesta = await fetch(`${base}/v1/artifacts?page=${page}&pageSize=100`, {
      headers: { 'x-api-key': clave, 'x-tenant-id': tenant },
    });
    if (!respuesta.ok) {
      console.error(`GET /v1/artifacts → ${respuesta.status}. Sin catálogo no hay veredicto.`);
      exit(2);
    }
    const cuerpo = await respuesta.json();
    const filas = Array.isArray(cuerpo) ? cuerpo : (cuerpo?.items ?? cuerpo?.data ?? []);
    publicados.push(...filas.map((fila) => fila.artifactCode ?? fila.code));
    if (!cuerpo?.hasNextPage) break;
  }

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
}

if (import.meta.url === `file://${argv[1]}`) {
  await main();
}

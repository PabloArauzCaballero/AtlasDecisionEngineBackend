#!/usr/bin/env node
/**
 * Siembra el PRIMER despliegue de un artefacto en un ambiente que no tiene ninguno.
 *
 * ## Cuándo se usa, y cuándo no
 *
 * Sólo cuando el ambiente está VACÍO para ese artefacto: TEST de Contabo el 2026-09-18 no tenía ni
 * un artefacto en `decision_artifact`, y sin binding el runtime contesta `ACTIVE_DEPLOYMENT_NOT_FOUND`
 * a toda verificación de identidad. Es exactamente lo que hizo la semilla de DEV el 2026-08-23
 * (`deployed_by = seed.system`), reproducido para poder repetirlo en cualquier ambiente nuevo.
 *
 * NO sustituye al gobierno. Si el artefacto ya tiene un binding en ese ambiente, no toca nada y lo
 * dice: cambiar una versión que ya decide exige la aprobación de dos personas en el portal y el
 * `--deploy` del guion del artefacto. Este guion no aprueba ninguna versión (no toca `status` ni
 * `approved_at`); enlaza una versión COMPILADA a un ambiente donde antes no decidía nadie.
 *
 * ## Uso
 *
 *   DATABASE_URL=postgresql://… node scripts/sembrar-despliegue.mjs --artifact IDENTIDAD_CARNET_MOVIL --version <versionId> --environment STAGING [--dry-run]
 */
import { argv, env, exit } from 'node:process';
import { Client } from 'pg';

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

const ARTIFACT = args.get('artifact');
const VERSION_ID = args.get('version');
const ENVIRONMENT = args.get('environment');
const DRY_RUN = args.get('dry-run') === 'true';
const DEPLOYED_BY = args.get('by') ?? 'seed.system';
const url = env.DATABASE_URL;

if (!url || !ARTIFACT || !VERSION_ID || !ENVIRONMENT) {
  console.error('Uso: DATABASE_URL=… node scripts/sembrar-despliegue.mjs --artifact <code> --version <versionId> --environment <code> [--dry-run]');
  exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  const artefacto = await client.query('select id, tenant_id, artifact_code from decision_artifact where artifact_code = $1', [ARTIFACT]);
  if (artefacto.rowCount === 0) throw new Error(`El artefacto ${ARTIFACT} no existe en esta base.`);
  const { id: artifactId, tenant_id: tenantId } = artefacto.rows[0];

  const version = await client.query(
    'select v.id, v.version_number, v.status, c.id as compiled_id, c.compile_status from decision_artifact_version v left join decision_compiled_artifact c on c.artifact_version_id = v.id where v.id = $1 and v.artifact_id = $2 order by c.compiled_at desc limit 1',
    [VERSION_ID, artifactId],
  );
  if (version.rowCount === 0) throw new Error(`La versión ${VERSION_ID} no es de ${ARTIFACT}.`);
  const v = version.rows[0];
  if (!v.compiled_id || v.compile_status !== 'SUCCESS') throw new Error(`La versión ${v.version_number} no está compilada con éxito (compile_status=${v.compile_status ?? 'ninguno'}).`);

  const ambiente = await client.query('select id, code from decision_environment where code = $1', [ENVIRONMENT]);
  if (ambiente.rowCount === 0) throw new Error(`El ambiente ${ENVIRONMENT} no existe en esta base.`);
  const environmentId = ambiente.rows[0].id;

  const binding = await client.query(
    'select b.id, d.artifact_version_id from decision_runtime_binding b join decision_deployment d on d.id = b.active_deployment_id where b.artifact_code = $1 and b.environment_id = $2',
    [ARTIFACT, environmentId],
  );
  if (binding.rowCount > 0) {
    console.log(`Ya hay un binding de ${ARTIFACT} en ${ENVIRONMENT} (versión ${binding.rows[0].artifact_version_id}): no se toca. Cambiarlo es gobierno, no siembra.`);
    exit(0);
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Sembrando despliegue de ${ARTIFACT} v${v.version_number} (versión ${v.id}, compilado ${v.compiled_id}) en ${ENVIRONMENT} (ambiente ${environmentId}).`);
  if (DRY_RUN) exit(0);

  await client.query('begin');
  const deployment = await client.query(
    `insert into decision_deployment (artifact_version_id, compiled_artifact_id, environment_id, deployment_mode, deployment_status, effective_from, is_active, deployed_by, deployed_at)
     values ($1, $2, $3, 'FULL', 'ACTIVE', now(), true, $4, now()) returning id`,
    [v.id, v.compiled_id, environmentId, DEPLOYED_BY],
  );
  const deploymentId = deployment.rows[0].id;
  await client.query(
    `insert into decision_runtime_binding (tenant_id, artifact_code, environment_id, active_deployment_id, binding_key, updated_at)
     values ($1, $2, $3, $4, 'default', now())`,
    [tenantId, ARTIFACT, environmentId, deploymentId],
  );
  await client.query('commit');
  console.log(`Listo: deployment ${deploymentId}, binding creado. El runtime ya resuelve ${ARTIFACT} en ${ENVIRONMENT}.`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(error.message);
  exit(1);
} finally {
  await client.end();
}

/**
 * Siembra el segundo algoritmo de demostración: priorización de cobranza.
 *
 * Su razón de existir está en `collections-demo.graph.ts`: el demo BNPL no tiene
 * un solo nodo de tipo condición ni switch, así que esas dos piezas —las que de
 * verdad distinguen un árbol de decisión de una lista de pasos— no se veían
 * funcionando en ninguna parte del producto.
 *
 * Idempotente: si la versión ya está, no hace nada; si viene de un seeder
 * anterior, la rehace. Es material de demostración sin dependientes productivos.
 */
import { Logger } from '@nestjs/common';
import { VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import {
  buildCollectionsDemoCompiled,
  COLLECTIONS_DEMO_CASES,
  COLLECTIONS_DEMO_CODE,
  COLLECTIONS_DEMO_VERSION,
} from './collections-demo.graph';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import type { VariableSeed } from './types';

const logger = new Logger('SeedCollectionsDemo');

const OUTPUT_CODES = new Set(['collections_strategy', 'collections_priority_score']);
const PRIMARY_OUTPUT = 'collections_strategy';

const DEMO_VARIABLES: VariableSeed[] = [
  {
    code: 'collections_balance',
    name: 'Saldo en cobranza',
    description: 'Importe vencido pendiente de cobro.',
    kind: 'INPUT',
    type: 'DECIMAL',
    validation: { min: 0, max: 10_000_000, scale: 2 },
  },
  {
    code: 'current_delinquency_bucket',
    name: 'Tramo de mora actual',
    description: 'Franja de días de atraso en la que cae hoy la cuenta.',
    kind: 'INPUT',
    type: 'STRING',
    validation: {
      enum: ['CURRENT', 'DPD_1_30', 'DPD_31_60', 'DPD_61_90', 'DPD_90_PLUS'],
    },
  },
  {
    code: 'collections_strategy',
    name: 'Estrategia de cobranza',
    description: 'Gestión que corresponde abrir para esta cuenta.',
    kind: 'OUTPUT',
    type: 'STRING',
    validation: {
      enum: ['SIN_GESTION', 'RECORDATORIO', 'LLAMADA', 'NEGOCIACION', 'AGENCIA_EXTERNA'],
    },
  },
  {
    code: 'collections_priority_score',
    name: 'Prioridad de gestión',
    description: 'De 0 a 100; ordena la cola del equipo de cobranza.',
    kind: 'OUTPUT',
    type: 'DECIMAL',
    validation: { min: 0, max: 100 },
  },
];

export async function seedCollectionsDemoArtifact(prisma: PrismaClient) {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: COLLECTIONS_DEMO_CODE } },
    include: { versions: { select: { semanticVersion: true } } },
  });
  if (existing?.versions.some((version) => version.semanticVersion === COLLECTIONS_DEMO_VERSION)) {
    logger.log(`Ya sembrado: ${COLLECTIONS_DEMO_CODE} ${COLLECTIONS_DEMO_VERSION}`);
    return undefined;
  }
  if (existing) {
    logger.warn(`${COLLECTIONS_DEMO_CODE} viene de un seeder anterior; se rehace.`);
    await deleteDemoArtifact(prisma, existing.id);
  }

  const seededVariables = Object.fromEntries(
    await Promise.all(
      DEMO_VARIABLES.map(async (seed) => [seed.code, await ensureVariable(prisma, seed)] as const),
    ),
  );

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: COLLECTIONS_DEMO_CODE,
      artifactType: 'COLLECTIONS_POLICY',
      name: 'Priorización de gestión de cobranza',
      description:
        'Segundo algoritmo de referencia: usa un nodo de CONDICIÓN (¿hay saldo que gestionar?) y un nodo SWITCH (tramo de mora, una salida por cada valor del enum), que el demo BNPL no ejercita en ninguna parte.',
      ownerTeam: 'COLLECTIONS',
      businessPurpose:
        'Decidir qué gestión abrir para una cuenta vencida y con qué prioridad, de forma explicable y auditable.',
      riskDomain: 'COLLECTIONS',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: COLLECTIONS_DEMO_VERSION,
      status: VersionStatus.COMPILED,
      changeSummary: 'Priorización de cobranza con nodo de condición y nodo switch.',
      authoringNotes:
        'El switch abre una rama por cada tramo del enum; la última va por defecto para que un valor nuevo del enum no deje ningún caso sin salida.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: DEMO_VARIABLES.map((seed) => ({
      artifactVersionId: version.id,
      variableVersionId: seededVariables[seed.code].version.id,
      usageType: OUTPUT_CODES.has(seed.code)
        ? seed.code === PRIMARY_OUTPUT
          ? 'OUTPUT_PRIMARY'
          : 'OUTPUT'
        : 'INPUT',
      isRequired: true,
      fallbackPolicy: OUTPUT_CODES.has(seed.code) ? 'NOT_APPLICABLE' : 'FAIL_CLOSED',
      dependencyPath: `${OUTPUT_CODES.has(seed.code) ? 'output' : 'input'}.${seed.code}`,
    })),
  });

  const compiled = buildCollectionsDemoCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
  );

  await writeGraphRows(prisma, version.id, compiled);

  await prisma.decisionOutputContractField.createMany({
    data: (compiled.outputContract ?? []).map((field) => ({
      tenantId: TENANT_ID,
      artifactVersionId: version.id,
      fieldCode: field.code,
      name: field.name,
      description: field.description,
      sourceKind: field.sourceKind,
      sourceRef: field.sourceRef,
      absenceReasons: field.absenceReasons,
      contractVersion: field.contractVersion,
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    })),
  });

  const compiledChecksum = sha256(compiled);
  await prisma.decisionCompiledArtifact.create({
    data: {
      artifactVersionId: version.id,
      compilerVersion: compiled.compilerVersion,
      runtimeSchemaVersion: compiled.runtimeSchemaVersion,
      compiledPayloadJson: compiled as unknown as Prisma.InputJsonValue,
      compiledChecksum,
      compileStatus: 'SUCCESS',
    },
  });
  await prisma.decisionArtifactVersion.update({
    where: { id: version.id },
    data: { canonicalChecksum: compiledChecksum },
  });

  /*
   * Despliegue activo en TEST. Va aquí y no en un script suelto porque un
   * despliegue montado a mano contra la base es exactamente lo que hace que un
   * entorno «funcione en mi máquina» y no se pueda reproducir: la siguiente
   * persona que levante el proyecto se encontraría el algoritmo sembrado pero
   * incapaz de ejecutar, con un ACTIVE_DEPLOYMENT_NOT_FOUND sin explicación.
   *
   * Hacen falta las DOS filas: el despliegue y el binding de runtime. El motor
   * resuelve por `decision_runtime_binding` (artefacto + ambiente -> despliegue
   * activo), así que un despliegue sin binding es invisible para él.
   */
  const compiledRow = await prisma.decisionCompiledArtifact.findFirstOrThrow({
    where: { artifactVersionId: version.id },
    select: { id: true },
  });
  const testEnvironment = await prisma.decisionEnvironment.findFirstOrThrow({
    where: { environmentType: 'TEST' },
    select: { id: true },
  });
  const deployment = await prisma.decisionDeployment.create({
    data: {
      artifactVersionId: version.id,
      compiledArtifactId: compiledRow.id,
      environmentId: testEnvironment.id,
      deploymentMode: 'FULL',
      deploymentStatus: 'ACTIVE',
      effectiveFrom: new Date(),
      isActive: true,
      deployedBy: 'seed.system',
    },
  });
  await prisma.decisionRuntimeBinding.upsert({
    where: {
      tenantId_artifactCode_environmentId_bindingKey: {
        tenantId: TENANT_ID,
        artifactCode: COLLECTIONS_DEMO_CODE,
        environmentId: testEnvironment.id,
        bindingKey: 'default',
      },
    },
    create: {
      tenantId: TENANT_ID,
      artifactCode: COLLECTIONS_DEMO_CODE,
      environmentId: testEnvironment.id,
      activeDeploymentId: deployment.id,
      bindingKey: 'default',
      updatedAt: new Date(),
    },
    update: { activeDeploymentId: deployment.id, updatedAt: new Date() },
  });
  await prisma.decisionArtifactVersion.update({
    where: { id: version.id },
    data: { status: VersionStatus.DEPLOYED_TO_TEST },
  });

  logger.log(
    `Sembrado ${COLLECTIONS_DEMO_CODE} ${COLLECTIONS_DEMO_VERSION} (condición + switch, ${COLLECTIONS_DEMO_CASES.length} casos, activo en TEST)`,
  );

  return {
    artifactCode: COLLECTIONS_DEMO_CODE,
    version: COLLECTIONS_DEMO_VERSION,
    artifactVersionId: version.id.toString(),
    compiledChecksum,
    cases: COLLECTIONS_DEMO_CASES.length,
  };
}

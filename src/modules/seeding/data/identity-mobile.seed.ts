/**
 * Persiste el artefacto de identidad para el front móvil: artefacto, variables,
 * intermedias, contrato de salida, filas del grafo, compilado y despliegue.
 *
 * El grafo vive en `identity-mobile.graph.ts` como datos puros y
 * `identity-mobile-seed.spec.ts` lo ejecuta contra el motor real. Aquí sólo se
 * escribe en la base: la corrección la garantiza la prueba, no este archivo.
 */
import { Logger } from '@nestjs/common';
import { VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import {
  buildIdentityMobileCompiled,
  IDENTITY_MOBILE_CODE,
  IDENTITY_MOBILE_VARIABLES as V,
  IDENTITY_MOBILE_VERSION,
  isIdentityMobileOutput,
  isIdentityMobilePrimaryOutput,
} from './identity-mobile.graph';
import type { VariableSeed } from './types';

const logger = new Logger('SeedIdentityMobile');

/**
 * Variables del artefacto.
 *
 * Las tres imágenes son `sensitive`, y ahí la marca hace trabajo de verdad: el
 * motor guarda su HMAC en vez del contenido y la traza de cada nodo las publica
 * como nulas. Sin ella, cada verificación dejaría el carnet y la cara de una
 * persona escritos en `decision_execution_variable`, y ahí se quedarían durante
 * toda la retención de la auditoría.
 */
const ARTIFACT_VARIABLES: VariableSeed[] = [
  {
    code: V.carnetFrente,
    name: 'Anverso del carnet (imagen en base64)',
    description:
      'Foto del frente del documento de identidad. La consume el nodo que llama al worker; nunca se persiste su valor, sólo su huella.',
    kind: 'INPUT',
    type: 'STRING',
    sensitive: true,
  },
  {
    code: V.carnetReverso,
    name: 'Reverso del carnet (imagen en base64)',
    description:
      'Opcional. Aporta la MRZ del carnet boliviano, que permite validar los dígitos de control; sin ella la verificación sigue siendo posible con el anverso.',
    kind: 'INPUT',
    type: 'STRING',
    sensitive: true,
  },
  {
    code: V.selfie,
    name: 'Selfie de la persona (imagen en base64)',
    description:
      'Foto en vivo con la que se compara el retrato del carnet. Nunca se persiste su valor.',
    kind: 'INPUT',
    type: 'STRING',
    sensitive: true,
  },
  {
    code: V.pais,
    name: 'País del documento',
    description: 'Código ISO de dos letras. Elige el analizador y el vocabulario de la lectura.',
    kind: 'INPUT',
    type: 'STRING',
    validation: { maxLength: 2 },
  },
  {
    code: V.decision,
    name: 'Resultado de la verificación de identidad',
    description: 'Decisión de negocio que el front móvil pinta.',
    kind: 'OUTPUT',
    type: 'STRING',
    validation: { allowedValues: ['VERIFICADO', 'REVISION_HUMANA', 'RECHAZADO'] },
  },
  {
    code: V.motivo,
    name: 'Motivo de la decisión',
    description:
      'Código explicable. Es lo que traduce el front a una instrucción concreta para quien está delante del móvil.',
    kind: 'OUTPUT',
    type: 'STRING',
  },
  {
    code: V.parecido,
    name: 'Parecido biométrico',
    description: 'Similitud entre el retrato del carnet y la selfie, en [0, 1].',
    kind: 'OUTPUT',
    type: 'DECIMAL',
  },
  {
    code: V.evidencia,
    name: 'Evidencia de documento',
    description: 'Cuánta evidencia hubo de que la imagen fuera un carnet, en [0, 1].',
    kind: 'OUTPUT',
    type: 'DECIMAL',
  },
];

export interface IdentityMobileSeedResult {
  artifactId: bigint;
  versionId: bigint;
  compiledChecksum: string;
}

/**
 * Siembra el artefacto. Re-ejecutable: si existe con otra versión se rehace.
 *
 * @param options.force rehace aunque la versión coincida. Lo usa el script de
 *   demostración: al iterar sobre el grafo la versión no cambia, y sin esto el
 *   seeder se saltaría el cambio en silencio.
 */
export async function seedIdentityMobileArtifact(
  prisma: PrismaClient,
  options: { force?: boolean } = {},
): Promise<IdentityMobileSeedResult | undefined> {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: IDENTITY_MOBILE_CODE } },
    include: { versions: { select: { id: true, semanticVersion: true } } },
  });
  const current = existing?.versions.find(
    (version) => version.semanticVersion === IDENTITY_MOBILE_VERSION,
  );
  if (current && !options.force) {
    logger.log(`Ya sembrado: ${IDENTITY_MOBILE_CODE} ${IDENTITY_MOBILE_VERSION}`);
    const compiled = await prisma.decisionCompiledArtifact.findFirst({
      where: { artifactVersionId: current.id },
      select: { compiledChecksum: true },
    });
    return {
      // `current` sale de `existing.versions`, así que `existing` no puede ser nulo aquí.
      artifactId: existing!.id,
      versionId: current.id,
      compiledChecksum: compiled?.compiledChecksum ?? '',
    };
  }
  if (existing) {
    logger.warn(`${IDENTITY_MOBILE_CODE} viene de un seeder anterior; se rehace.`);
    await deleteDemoArtifact(prisma, existing.id);
  }

  const seededVariables = Object.fromEntries(
    await Promise.all(
      ARTIFACT_VARIABLES.map(
        async (seed) => [seed.code, await ensureVariable(prisma, seed)] as const,
      ),
    ),
  );

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: IDENTITY_MOBILE_CODE,
      artifactType: 'IDENTITY_POLICY',
      name: 'Verificación de identidad con carnet para el front móvil',
      description:
        'Artefacto que el front móvil consume para verificar a una persona: llama al worker de identidad con el carnet y la selfie, y traduce su veredicto técnico a una decisión de negocio con motivo.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose:
        'Dar al front móvil una decisión de negocio versionada y auditable sobre la identidad de quien se registra, sin que el consumidor conozca umbrales biométricos ni códigos del worker.',
      riskDomain: 'IDENTITY_VERIFICATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: IDENTITY_MOBILE_VERSION,
      status: VersionStatus.COMPILED,
      changeSummary:
        'Verificación de identidad con carnet: llamada al worker, política de aceptación y derivación a revisión humana.',
      authoringNotes:
        'El nodo VERIFICAR_IDENTIDAD continúa ante un fallo del worker con los valores por defecto declarados. La arista por defecto va a REVISION_HUMANA y nunca a aprobar: en un flujo de identidad, un fallo del motor no puede abrir la puerta.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: ARTIFACT_VARIABLES.map((seed) => ({
      artifactVersionId: version.id,
      variableVersionId: seededVariables[seed.code].version.id,
      usageType: isIdentityMobileOutput(seed.code)
        ? isIdentityMobilePrimaryOutput(seed.code)
          ? 'OUTPUT_PRIMARY'
          : 'OUTPUT'
        : 'INPUT',
      // El reverso es el único opcional: el anverso basta para leer y comparar,
      // y exigirlo dejaría fuera capturas perfectamente válidas.
      isRequired: seed.code !== V.carnetReverso,
      fallbackPolicy: isIdentityMobileOutput(seed.code)
        ? 'NOT_APPLICABLE'
        : seed.code === V.carnetReverso
          ? 'DEFAULT_VALUE'
          : 'FAIL_CLOSED',
      dependencyPath: `${isIdentityMobileOutput(seed.code) ? 'output' : 'input'}.${seed.code}`,
    })),
  });

  const compiled = buildIdentityMobileCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
  );

  // El editor y la vista de grafo leen las tablas relacionales, no el compilado:
  // sin esto el artefacto decidiría perfectamente y el portal lo mostraría vacío.
  await writeGraphRows(prisma, version.id, compiled);

  await prisma.decisionIntermediateVariable.createMany({
    data: compiled.intermediates.map((entry) => ({
      tenantId: TENANT_ID,
      artifactVersionId: version.id,
      code: entry.code,
      name: entry.name,
      description: entry.description,
      dataType: entry.dataType,
      producerNodeKey: entry.producerNodeKey,
      consumerNodeKeys: entry.consumerNodeKeys,
      nullable: entry.nullable,
      updatePolicy: entry.updatePolicy,
      sensitivityClass: 'INTERNAL',
      tracePolicy: 'FULL',
    })),
  });

  await prisma.decisionOutputContractField.createMany({
    data: compiled.outputContract.map((field) => ({
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
  const compiledRow = await prisma.decisionCompiledArtifact.create({
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

  await deployToDev(prisma, version.id, compiledRow.id);

  logger.log(`Sembrado ${IDENTITY_MOBILE_CODE} ${IDENTITY_MOBILE_VERSION} (activo en DEV)`);
  return { artifactId: artifact.id, versionId: version.id, compiledChecksum };
}

/**
 * Deja el artefacto ejecutable en DEV.
 *
 * Hacen falta las DOS filas: el despliegue y el binding de runtime. El motor
 * resuelve por `decision_runtime_binding` (artefacto + ambiente → despliegue
 * activo), así que un despliegue sin binding es invisible para él.
 *
 * DEV y no PROD a propósito: promover a producción un artefacto que decide sobre
 * identidades es un acto de gobierno —con su aprobación y su gate económico— y
 * no algo que deba hacer un seeder por su cuenta.
 */
async function deployToDev(
  prisma: PrismaClient,
  versionId: bigint,
  compiledArtifactId: bigint,
): Promise<void> {
  const environment = await prisma.decisionEnvironment.findFirstOrThrow({
    where: { environmentType: 'DEV' },
    select: { id: true },
  });
  const deployment = await prisma.decisionDeployment.create({
    data: {
      artifactVersionId: versionId,
      compiledArtifactId,
      environmentId: environment.id,
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
        artifactCode: IDENTITY_MOBILE_CODE,
        environmentId: environment.id,
        bindingKey: 'default',
      },
    },
    create: {
      tenantId: TENANT_ID,
      artifactCode: IDENTITY_MOBILE_CODE,
      environmentId: environment.id,
      activeDeploymentId: deployment.id,
      bindingKey: 'default',
      updatedAt: new Date(),
    },
    update: { activeDeploymentId: deployment.id, updatedAt: new Date() },
  });
}

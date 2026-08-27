/**
 * Persiste el artefacto de verificación KYB del comercio: variables, versión, intermedias,
 * contrato de salida, compilado y suite de regresión.
 *
 * El grafo y los casos esperados viven en `partner-kyb.graph.ts` como datos puros, y
 * `partner-kyb-seed.spec.ts` los ejecuta contra el motor real. Aquí sólo se escriben en la base:
 * la corrección la garantiza la prueba, no este archivo.
 */
import { Logger } from '@nestjs/common';
import { VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import {
  buildPartnerKybCompiled,
  PARTNER_KYB_CASES,
  PARTNER_KYB_CODE,
  PARTNER_KYB_INVALID_CASES,
  PARTNER_KYB_VERSION,
} from './partner-kyb.graph';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import type { VariableSeed } from './types';

const logger = new Logger('SeedPartnerKyb');

/**
 * Variables del expediente.
 *
 * Son booleanas a propósito y no «el documento» en sí: lo que el motor decide es si el requisito
 * está cubierto, y quién guarda la evidencia —con su hash y su trazabilidad— es el expediente en
 * AtlasBackend. Meter aquí el número de matrícula o la cuenta bancaria sería copiar datos
 * personales del comercio a un segundo sitio para no usarlos.
 */
const KYB_VARIABLES: VariableSeed[] = [
  {
    code: 'kyb_tiene_matricula',
    name: 'Matrícula de comercio registrada',
    description: 'El expediente declara la matrícula con la que la empresa está inscrita.',
    kind: 'INPUT',
    type: 'BOOLEAN',
  },
  {
    code: 'kyb_representante_acreditado',
    name: 'Representante legal acreditado',
    description: 'Hay representante declarado Y su poder notarial está subido. Declarar no es acreditar.',
    kind: 'INPUT',
    type: 'BOOLEAN',
  },
  {
    code: 'kyb_qr_negocio',
    name: 'QR del negocio registrado',
    description: 'El comercio subió el QR de su negocio y el registro lo aceptó como código legible.',
    kind: 'INPUT',
    type: 'BOOLEAN',
  },
  {
    code: 'kyb_qr_bancario',
    name: 'QR bancario de cobro registrado',
    description: 'El QR que dice a qué cuenta va el dinero del cliente.',
    kind: 'INPUT',
    type: 'BOOLEAN',
  },
  {
    code: 'kyb_correo_verificado',
    name: 'Correo de contacto verificado',
    description: 'El correo del expediente respondió al código de verificación.',
    kind: 'INPUT',
    type: 'BOOLEAN',
  },
  {
    code: 'kyb_sucursales',
    name: 'Sucursales registradas',
    description: 'Cuántos locales declaró el comercio. Sin ninguno no se sabe dónde opera.',
    kind: 'INPUT',
    type: 'INTEGER',
    validation: { min: 0, max: 5_000 },
  },
  {
    code: 'kyb_antiguedad_dias',
    name: 'Antigüedad del expediente (días)',
    description: 'Días desde que se abrió. Un expediente viejo puede describir un negocio que ya cambió.',
    kind: 'INPUT',
    type: 'INTEGER',
    validation: { min: 0, max: 10_000 },
  },
  {
    code: 'kyb_decision',
    name: 'Decisión sobre el expediente',
    description: 'Resultado principal de la verificación KYB.',
    kind: 'OUTPUT',
    type: 'STRING',
    validation: { allowedValues: ['APROBADO', 'REVISION_MANUAL', 'RECHAZADO'] },
  },
  {
    code: 'kyb_motivo',
    name: 'Motivo de la decisión KYB',
    description: 'Código explicable del resultado.',
    kind: 'OUTPUT',
    type: 'STRING',
  },
  {
    code: 'kyb_requisitos_faltantes',
    name: 'Requisitos pendientes',
    description: 'Cuántos requisitos que impiden operar siguen sin cubrirse.',
    kind: 'OUTPUT',
    type: 'INTEGER',
    validation: { min: 0, max: 4 },
  },
  {
    code: 'kyb_senales_operativas',
    name: 'Señales operativas',
    description: 'Avisos que no bloquean pero exigen revisión humana.',
    kind: 'OUTPUT',
    type: 'INTEGER',
    validation: { min: 0, max: 3 },
  },
];

const PRIMARY_OUTPUT = 'kyb_decision';
const OUTPUT_CODES = new Set([
  'kyb_decision',
  'kyb_motivo',
  'kyb_requisitos_faltantes',
  'kyb_senales_operativas',
]);

export async function seedPartnerKybArtifact(prisma: PrismaClient, options: { force?: boolean } = {}) {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: PARTNER_KYB_CODE } },
    include: { versions: { select: { semanticVersion: true } } },
  });
  if (!options.force && existing?.versions.some((v) => v.semanticVersion === PARTNER_KYB_VERSION)) {
    logger.log(`Ya sembrado: ${PARTNER_KYB_CODE} ${PARTNER_KYB_VERSION}`);
    return undefined;
  }
  if (existing) {
    // Se rehace en vez de dejar la versión vieja para siempre, igual que los demás demos: una
    // base ya sembrada con un grafo anterior enseña una decisión que el código ya no toma.
    logger.warn(`${PARTNER_KYB_CODE} viene de una siembra anterior; se rehace.`);
    await deleteDemoArtifact(prisma, existing.id);
  }

  const seededVariables = Object.fromEntries(
    await Promise.all(
      KYB_VARIABLES.map(async (seed) => {
        const result = await ensureVariable(prisma, seed);
        return [seed.code, result] as const;
      }),
    ),
  );

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: PARTNER_KYB_CODE,
      artifactType: 'RISK_POLICY',
      name: 'Verificación del expediente del comercio (KYB)',
      description:
        'Decide si un comercio puede operar: aprueba el expediente completo y sin señales, manda a revisión manual el que exige criterio humano, y rechaza el que no cubre los requisitos que impiden cobrar.',
      ownerTeam: 'MERCHANT_RISK',
      businessPurpose:
        'Dar trazabilidad y versión a la verificación del expediente de un comercio, que hasta ahora se resolvía dentro del backend de altas sin ejecución que auditar.',
      riskDomain: 'MERCHANT_ONBOARDING',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: PARTNER_KYB_VERSION,
      status: VersionStatus.COMPILED,
      changeSummary: 'Verificación KYB: cuatro requisitos duros y tres señales operativas.',
      authoringNotes:
        'Los requisitos duros no se compensan entre sí: cualquiera que falte rechaza. Las señales nunca aprueban solas — mandan a una persona.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: KYB_VARIABLES.map((seed) => ({
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

  const compiled = buildPartnerKybCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
  );

  // Filas relacionales del grafo: sin ellas el artefacto se ejecuta y el portal lo enseña VACÍO,
  // sin un solo nodo que abrir en el editor.
  await writeGraphRows(prisma, version.id, compiled);

  await prisma.decisionIntermediateVariable.createMany({
    data: compiled.intermediates.map((intermediate) => ({
      tenantId: TENANT_ID,
      artifactVersionId: version.id,
      code: intermediate.code,
      name: intermediate.name,
      description: intermediate.description,
      dataType: intermediate.dataType,
      producerNodeKey: intermediate.producerNodeKey,
      consumerNodeKeys: intermediate.consumerNodeKeys,
      nullable: intermediate.nullable,
      updatePolicy: intermediate.updatePolicy,
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

  await seedRegressionSuite(prisma, version.id);
  const ambientes = await activarEnAmbientes(prisma, version.id);
  logger.log(
    `Sembrado ${PARTNER_KYB_CODE} ${PARTNER_KYB_VERSION} (activo en ${ambientes.join(', ') || 'ningún ambiente'})`,
  );

  return {
    artifactCode: PARTNER_KYB_CODE,
    version: PARTNER_KYB_VERSION,
    artifactVersionId: version.id.toString(),
    compiledChecksum,
    cases: PARTNER_KYB_CASES.length + PARTNER_KYB_INVALID_CASES.length,
  };
}

/**
 * Deja el artefacto EJECUTABLE, no sólo sembrado.
 *
 * Hacen falta las dos filas: el despliegue y el binding de runtime. El motor resuelve por
 * `decision_runtime_binding` (artefacto + ambiente → despliegue activo), así que un despliegue
 * sin binding es invisible para él y la ejecución falla con `ACTIVE_DEPLOYMENT_NOT_FOUND` — que
 * es exactamente lo que pasa cuando alguien siembra un artefacto y da por hecho que ya se puede
 * usar.
 */
async function activarEnAmbientes(prisma: PrismaClient, artifactVersionId: bigint) {
  const compiledRow = await prisma.decisionCompiledArtifact.findFirstOrThrow({
    where: { artifactVersionId },
    select: { id: true },
  });
  const ambientes = await prisma.decisionEnvironment.findMany({
    where: { environmentType: { in: ['DEV', 'TEST'] } },
    select: { id: true, code: true },
  });

  const activados: string[] = [];
  for (const ambiente of ambientes) {
    const deployment = await prisma.decisionDeployment.create({
      data: {
        artifactVersionId,
        compiledArtifactId: compiledRow.id,
        environmentId: ambiente.id,
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
          artifactCode: PARTNER_KYB_CODE,
          environmentId: ambiente.id,
          bindingKey: 'default',
        },
      },
      create: {
        tenantId: TENANT_ID,
        artifactCode: PARTNER_KYB_CODE,
        environmentId: ambiente.id,
        activeDeploymentId: deployment.id,
        bindingKey: 'default',
        updatedAt: new Date(),
      },
      update: { activeDeploymentId: deployment.id, updatedAt: new Date() },
    });
    activados.push(ambiente.code);
  }

  if (activados.length > 0) {
    await prisma.decisionArtifactVersion.update({
      where: { id: artifactVersionId },
      data: { status: VersionStatus.DEPLOYED_TO_TEST },
    });
  }
  return activados;
}

/** Suite de regresión con los casos positivos, de frontera y los que el contrato rechaza. */
async function seedRegressionSuite(prisma: PrismaClient, artifactVersionId: bigint) {
  const suite = await prisma.decisionTestSuite.create({
    data: {
      artifactVersionId,
      suiteCode: 'PARTNER_KYB_REGRESSION',
      name: 'Regresión de la verificación KYB',
      suiteType: 'REGRESSION',
      isBlocking: true,
    },
  });

  await prisma.decisionTestCase.createMany({
    data: [
      ...PARTNER_KYB_CASES.map((testCase, index) => ({
        testSuiteId: suite.id,
        caseCode: `POSITIVO_${index + 1}`,
        testName: testCase.name,
        inputJson: testCase.input as Prisma.InputJsonValue,
        expectedResultJson: {
          outcome: String(testCase.expectedOutput.kyb_decision),
          output: testCase.expectedOutput,
        } as Prisma.InputJsonValue,
        tagsJson: ['KYB', 'POSITIVO'] as unknown as Prisma.InputJsonValue,
      })),
      ...PARTNER_KYB_INVALID_CASES.map((testCase, index) => ({
        testSuiteId: suite.id,
        caseCode: `NEGATIVO_${index + 1}`,
        testName: testCase.name,
        inputJson: testCase.input as Prisma.InputJsonValue,
        expectedResultJson: {
          outcome: 'NO_DECISION',
          reasonCodes: [testCase.expectedError],
        } as Prisma.InputJsonValue,
        tagsJson: ['KYB', 'NEGATIVO'] as unknown as Prisma.InputJsonValue,
      })),
    ],
  });
  return suite;
}

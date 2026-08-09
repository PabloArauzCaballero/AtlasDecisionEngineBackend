/**
 * Persiste el demo de contratos (§11): artefacto, variables, intermedias, contrato de
 * salida, compilado y suite de regresión con casos positivos, negativos y de frontera.
 *
 * El grafo y los casos esperados viven en `contract-demo.graph.ts` como datos puros, y
 * `contract-demo-seed.spec.ts` los ejecuta contra el motor real. Aquí solo se escriben
 * en la base: la corrección la garantiza la prueba, no este archivo.
 */
import { Logger } from '@nestjs/common';
import { VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import {
  buildContractDemoCompiled,
  CONTRACT_DEMO_CASES,
  CONTRACT_DEMO_CODE,
  CONTRACT_DEMO_INVALID_CASES,
  CONTRACT_DEMO_VERSION,
} from './contract-demo.graph';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import type { VariableSeed } from './types';

const logger = new Logger('SeedContractDemo');

/** Variables propias del demo: no existen en el catálogo general. */
const DEMO_VARIABLES: VariableSeed[] = [
  {
    code: 'ingreso_mensual',
    name: 'Ingreso mensual',
    description: 'Ingreso neto mensual verificado del solicitante.',
    kind: 'INPUT',
    type: 'DECIMAL',
    validation: { exclusiveMin: 0, max: 1_000_000, scale: 2 },
  },
  {
    code: 'deuda_mensual',
    name: 'Deuda mensual',
    description: 'Suma de las cuotas mensuales vigentes.',
    kind: 'INPUT',
    type: 'DECIMAL',
    validation: { min: 0, max: 1_000_000, scale: 2 },
  },
  {
    code: 'cuota_solicitada',
    name: 'Cuota solicitada',
    description: 'Cuota mensual del crédito que se solicita.',
    kind: 'INPUT',
    type: 'DECIMAL',
    validation: { min: 0, max: 1_000_000, scale: 2 },
  },
  {
    code: 'decision_afordabilidad',
    name: 'Decisión de afordabilidad',
    description: 'Resultado principal del análisis de capacidad de pago.',
    kind: 'OUTPUT',
    type: 'STRING',
    validation: { allowedValues: ['APROBADO', 'REVISION_MANUAL', 'RECHAZADO'] },
  },
  {
    code: 'motivo_afordabilidad',
    name: 'Motivo de afordabilidad',
    description: 'Código explicable del resultado.',
    kind: 'OUTPUT',
    type: 'STRING',
  },
  {
    code: 'dti_publicado',
    name: 'DTI publicado',
    description: 'Relación deuda/ingreso publicada al consumidor.',
    kind: 'OUTPUT',
    type: 'DECIMAL',
    validation: { min: 0, max: 100 },
  },
];

const PRIMARY_OUTPUT = 'decision_afordabilidad';
const OUTPUT_CODES = new Set(['decision_afordabilidad', 'motivo_afordabilidad', 'dti_publicado']);

export async function seedContractDemoArtifact(
  prisma: PrismaClient,
  environments: { dev: { id: bigint }; test: { id: bigint } },
) {
  const existing = await prisma.decisionArtifact.findUnique({
    where: { tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: CONTRACT_DEMO_CODE } },
    include: { versions: { select: { semanticVersion: true } } },
  });
  if (existing?.versions.some((version) => version.semanticVersion === CONTRACT_DEMO_VERSION)) {
    logger.log(`Ya sembrado: ${CONTRACT_DEMO_CODE} ${CONTRACT_DEMO_VERSION}`);
    return undefined;
  }
  if (existing) {
    // El demo es material de demostración sin dependientes productivos: se rehace para
    // que una base ya sembrada no se quede con la versión antigua para siempre (el mismo
    // desfase que ya costó una ejecución rota en el demo BNPL).
    logger.warn(`${CONTRACT_DEMO_CODE} viene de un seeder anterior; se rehace.`);
    await deleteDemoArtifact(prisma, existing.id);
  }

  const seededVariables = Object.fromEntries(
    await Promise.all(
      DEMO_VARIABLES.map(async (seed) => {
        const result = await ensureVariable(prisma, seed);
        return [seed.code, result] as const;
      }),
    ),
  );

  const artifact = await prisma.decisionArtifact.create({
    data: {
      tenantId: TENANT_ID,
      artifactCode: CONTRACT_DEMO_CODE,
      artifactType: 'CREDIT_POLICY',
      name: 'Demostración de contratos y variables intermedias',
      description:
        'Ejemplo mínimo y completo de §1–§4: entradas con restricciones, dos variables intermedias con productor y consumidores declarados, y un contrato de salida con origen explícito.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose:
        'Servir de referencia ejecutable de cómo se gobierna un contrato de entrada, intermedio y de salida en ATLAS.',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: CONTRACT_DEMO_VERSION,
      status: VersionStatus.COMPILED,
      changeSummary: 'Demo de contratos: entradas restringidas, intermedias y contrato de salida.',
      authoringNotes:
        'Las intermedias `dti` y `carga_cuota` solo existen durante la ejecución; `dti_publicado` es la única que llega al consumidor, y lo hace por un mapeo explícito del contrato de salida.',
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

  // §5.1 — si el campo calculado `debt_to_income` ya está sembrado y aprobado, el demo
  // lo INVOCA en vez de repetir la fórmula. Así la demostración prueba la reutilización
  // real, no solo que la tabla existe.
  const calculatedField = await resolveDebtToIncome(prisma);
  const compiled = buildContractDemoCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
    calculatedField,
  );

  for (const node of Object.values(compiled.nodes)) {
    for (const call of node.calculatedFieldCalls ?? []) {
      await prisma.decisionArtifactCalculatedFieldUse.create({
        data: {
          tenantId: TENANT_ID,
          artifactVersionId: version.id,
          nodeKey: node.key,
          callKey: call.callKey,
          calculatedFieldVersionId: BigInt(call.calculatedFieldVersionId),
          inputMappingJson: call.inputMapping as unknown as Prisma.InputJsonValue,
          targetKind: call.target.kind,
          targetCode: call.target.code,
          definitionJson: call.definition as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  /*
   * Filas relacionales del grafo. Faltaban: el demo se sembraba sólo como
   * compilado, así que se ejecutaba bien y el portal lo mostraba VACÍO, sin un
   * solo nodo que abrir en el editor. No fallaba ni avisaba; simplemente no se
   * veía. El escritor es compartido para que no vuelva a olvidarse.
   */
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
  logger.log(`Sembrado ${CONTRACT_DEMO_CODE} ${CONTRACT_DEMO_VERSION} en DEV/TEST`);
  void environments;

  return {
    artifactCode: CONTRACT_DEMO_CODE,
    version: CONTRACT_DEMO_VERSION,
    artifactVersionId: version.id.toString(),
    compiledChecksum,
    cases: CONTRACT_DEMO_CASES.length + CONTRACT_DEMO_INVALID_CASES.length,
  };
}

/** Localiza la versión aprobada del campo calculado que el demo reutiliza. */
async function resolveDebtToIncome(prisma: PrismaClient) {
  const version = await prisma.calculatedFieldVersion.findFirst({
    where: {
      calculatedField: { tenantId: TENANT_ID, fieldCode: 'debt_to_income' },
      status: { in: ['APPROVED', 'PUBLISHED'] },
    },
    orderBy: { versionNumber: 'desc' },
    include: { libraries: { include: { library: { select: { packageName: true } } } } },
  });
  if (!version) return undefined;
  return {
    versionId: version.id.toString(),
    versionNumber: version.versionNumber,
    definition: {
      implementationKind: version.implementationKind,
      contract: { inputs: version.inputsJson, returns: version.returnJson },
      operation: version.operationJson ?? undefined,
      sourceCode: version.sourceCode ?? undefined,
      libraryPackages: version.libraries.map((link) => link.library.packageName),
      defaultValue: version.defaultValueJson ?? undefined,
      timeoutMs: version.timeoutMs,
    },
  } as const;
}

/** Suite con casos positivos, de frontera y negativos, tal como exige §11. */
async function seedRegressionSuite(prisma: PrismaClient, artifactVersionId: bigint) {
  const suite = await prisma.decisionTestSuite.create({
    data: {
      artifactVersionId,
      suiteCode: 'AFFORDABILITY_CONTRACT_REGRESSION',
      name: 'Regresión del contrato de afordabilidad',
      suiteType: 'REGRESSION',
      isBlocking: true,
    },
  });

  await prisma.decisionTestCase.createMany({
    data: [
      ...CONTRACT_DEMO_CASES.map((testCase, index) => ({
        testSuiteId: suite.id,
        caseCode: `POSITIVO_${index + 1}`,
        testName: testCase.name,
        inputJson: testCase.input as Prisma.InputJsonValue,
        expectedResultJson: {
          outcome: String(testCase.expectedOutput.decision_afordabilidad),
          output: testCase.expectedOutput,
        } as Prisma.InputJsonValue,
        tagsJson: ['CONTRATO', 'POSITIVO'] as unknown as Prisma.InputJsonValue,
      })),
      ...CONTRACT_DEMO_INVALID_CASES.map((testCase, index) => ({
        testSuiteId: suite.id,
        caseCode: `NEGATIVO_${index + 1}`,
        testName: testCase.name,
        inputJson: testCase.input as Prisma.InputJsonValue,
        expectedResultJson: {
          outcome: 'NO_DECISION',
          reasonCodes: [testCase.expectedError],
        } as Prisma.InputJsonValue,
        tagsJson: ['CONTRATO', 'NEGATIVO'] as unknown as Prisma.InputJsonValue,
      })),
    ],
  });
  return suite;
}

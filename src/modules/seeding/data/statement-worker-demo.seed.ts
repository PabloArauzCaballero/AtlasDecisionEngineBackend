/**
 * Persiste el demo de nodos que llaman a un servicio de worker: artefacto, variables,
 * intermedias, contrato de salida, filas del grafo y compilado.
 *
 * El grafo vive en `statement-worker-demo.graph.ts` como datos puros y
 * `statement-worker-demo-seed.spec.ts` lo ejecuta contra el motor real. Aquí sólo se
 * escribe en la base: la corrección la garantiza la prueba, no este archivo.
 */
import { Logger } from '@nestjs/common';
import { VersionStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { deleteDemoArtifact, writeGraphRows } from './graph-rows';
import { ensureVariable, sha256, TENANT_ID } from './helpers';
import {
  buildStatementWorkerDemoCompiled,
  isStatementDemoOutput,
  isStatementDemoPrimaryOutput,
  STATEMENT_WORKER_DEMO_CODE,
  STATEMENT_WORKER_DEMO_VARIABLES as V,
  STATEMENT_WORKER_DEMO_VERSION,
} from './statement-worker-demo.graph';
import type { VariableSeed } from './types';

const logger = new Logger('SeedStatementWorkerDemo');

/** Variables propias del demo: no existen en el catálogo general. */
const DEMO_VARIABLES: VariableSeed[] = [
  {
    code: V.documento,
    name: 'Extracto bancario (PDF en base64)',
    description:
      'Documento que la solicitud adjunta. Lo consume el nodo que llama al servicio de extractos; nunca se persiste su valor, sólo su huella.',
    kind: 'INPUT',
    type: 'STRING',
    // Sensible de verdad, no por precaución: es un documento financiero de una persona.
    // La marca hace que el motor guarde su HMAC en vez del contenido y que la traza de
    // cada nodo lo publique como nulo.
    sensitive: true,
  },
  {
    code: V.nombreArchivo,
    name: 'Nombre del archivo del extracto',
    description: 'Nombre original del PDF. Viaja al servicio sólo para la traza.',
    kind: 'INPUT',
    type: 'STRING',
  },
  {
    code: V.cuota,
    name: 'Cuota mensual solicitada',
    description: 'Cuota del crédito que se solicita, en la moneda de la cuenta.',
    kind: 'INPUT',
    type: 'DECIMAL',
    unit: 'BOB',
    validation: { exclusiveMin: 0, max: 1_000_000, scale: 2 },
  },
  {
    code: V.decision,
    name: 'Decisión sobre el extracto',
    description: 'Resultado principal del análisis de capacidad de pago sobre el extracto.',
    kind: 'OUTPUT',
    type: 'STRING',
    validation: {
      allowedValues: ['APROBADO', 'APROBADO_CON_CONDICIONES', 'REVISION_MANUAL', 'RECHAZADO'],
    },
  },
  {
    code: V.motivo,
    name: 'Motivo de la decisión',
    description: 'Código explicable del resultado.',
    kind: 'OUTPUT',
    type: 'STRING',
  },
  {
    code: V.ingreso,
    name: 'Ingreso verificado',
    description: 'Abonos del periodo leídos del extracto, publicados al consumidor.',
    kind: 'OUTPUT',
    type: 'DECIMAL',
    unit: 'BOB',
  },
  {
    code: V.confianza,
    name: 'Confianza del extracto',
    description: 'Confianza compuesta con la que el servicio leyó el documento.',
    kind: 'OUTPUT',
    type: 'DECIMAL',
  },
];

export interface StatementWorkerDemoSeedResult {
  artifactId: bigint;
  versionId: bigint;
  compiledChecksum: string;
}

/**
 * Siembra el demo. Re-ejecutable: si ya existe con otra versión se rehace, porque es
 * material de demostración sin dependientes productivos y dejar la versión vieja para
 * siempre es justo el desfase que ya costó una ejecución rota en otros demos.
 *
 * @param options.force rehace el artefacto aunque la versión coincida. Lo usa el script de
 *   demostración: al iterar sobre el grafo, la versión no cambia y sin esto el seeder se
 *   saltaría el cambio en silencio.
 */
export async function seedStatementWorkerDemoArtifact(
  prisma: PrismaClient,
  options: { force?: boolean } = {},
): Promise<StatementWorkerDemoSeedResult | undefined> {
  const existing = await prisma.decisionArtifact.findUnique({
    where: {
      tenantId_artifactCode: { tenantId: TENANT_ID, artifactCode: STATEMENT_WORKER_DEMO_CODE },
    },
    include: { versions: { select: { id: true, semanticVersion: true } } },
  });
  const current = existing?.versions.find(
    (version) => version.semanticVersion === STATEMENT_WORKER_DEMO_VERSION,
  );
  if (current && !options.force) {
    logger.log(`Ya sembrado: ${STATEMENT_WORKER_DEMO_CODE} ${STATEMENT_WORKER_DEMO_VERSION}`);
    const compiled = await prisma.decisionCompiledArtifact.findFirst({
      where: { artifactVersionId: current.id },
      select: { compiledChecksum: true },
    });
    return {
      artifactId: existing!.id,
      versionId: current.id,
      compiledChecksum: compiled?.compiledChecksum ?? '',
    };
  }
  if (existing) {
    logger.warn(`${STATEMENT_WORKER_DEMO_CODE} viene de un seeder anterior; se rehace.`);
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
      artifactCode: STATEMENT_WORKER_DEMO_CODE,
      artifactType: 'CREDIT_POLICY',
      name: 'Capacidad de pago verificada por extracto bancario',
      description:
        'Demostración de un nodo que LLAMA a un servicio de worker: convierte el extracto en PDF a movimientos normalizados, guarda el resultado en variables intermedias y decide con ellas.',
      ownerTeam: 'RISK_DECISIONING',
      businessPurpose:
        'Servir de referencia ejecutable de cómo un algoritmo consume los servicios de los workers absorbidos (ADR-0026) como variables del motor.',
      riskDomain: 'CREDIT_ORIGINATION',
    },
  });

  const version = await prisma.decisionArtifactVersion.create({
    data: {
      artifactId: artifact.id,
      versionNumber: 1,
      semanticVersion: STATEMENT_WORKER_DEMO_VERSION,
      status: VersionStatus.COMPILED,
      changeSummary:
        'Demo de llamada a servicio de worker: extracto bancario → variables intermedias → decisión.',
      authoringNotes:
        'El nodo ANALIZAR_EXTRACTO continúa ante un fallo del servicio con los valores por defecto declarados; la rama EXTRACTO_NO_CONFIABLE es la que recoge ese caso.',
      createdBy: 'seed.system',
    },
  });

  await prisma.decisionArtifactVariableDependency.createMany({
    data: DEMO_VARIABLES.map((seed) => ({
      artifactVersionId: version.id,
      variableVersionId: seededVariables[seed.code].version.id,
      usageType: isStatementDemoOutput(seed.code)
        ? isStatementDemoPrimaryOutput(seed.code)
          ? 'OUTPUT_PRIMARY'
          : 'OUTPUT'
        : 'INPUT',
      isRequired: true,
      fallbackPolicy: isStatementDemoOutput(seed.code) ? 'NOT_APPLICABLE' : 'FAIL_CLOSED',
      dependencyPath: `${isStatementDemoOutput(seed.code) ? 'output' : 'input'}.${seed.code}`,
    })),
  });

  const compiled = buildStatementWorkerDemoCompiled(
    { id: artifact.id.toString(), tenantId: TENANT_ID.toString() },
    { id: version.id.toString() },
    Object.fromEntries(
      Object.entries(seededVariables).map(([code, seeded]) => [code, seeded.version.id.toString()]),
    ),
  );

  // El editor y la vista de grafo leen las tablas relacionales, no el compilado: sin esto
  // el demo decidiría perfectamente y el portal lo mostraría vacío.
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

  logger.log(
    `Sembrado ${STATEMENT_WORKER_DEMO_CODE} ${STATEMENT_WORKER_DEMO_VERSION} (activo en DEV)`,
  );
  return { artifactId: artifact.id, versionId: version.id, compiledChecksum };
}

/**
 * Deja el demo ejecutable en DEV.
 *
 * Hacen falta las DOS filas: el despliegue y el binding de runtime. El motor resuelve por
 * `decision_runtime_binding` (artefacto + ambiente → despliegue activo), así que un
 * despliegue sin binding es invisible para él. DEV y no PROD porque el demo llama a un
 * servicio externo de verdad y no tiene por qué estar disponible en producción.
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
        artifactCode: STATEMENT_WORKER_DEMO_CODE,
        environmentId: environment.id,
        bindingKey: 'default',
      },
    },
    create: {
      tenantId: TENANT_ID,
      artifactCode: STATEMENT_WORKER_DEMO_CODE,
      environmentId: environment.id,
      activeDeploymentId: deployment.id,
      bindingKey: 'default',
      updatedAt: new Date(),
    },
    update: { activeDeploymentId: deployment.id, updatedAt: new Date() },
  });
}

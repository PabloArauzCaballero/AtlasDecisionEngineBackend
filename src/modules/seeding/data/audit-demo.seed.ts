/**
 * Siembra el CIRCUITO COMPLETO de una decisión: sujeto → decisión → crédito → ventana →
 * desenlace, más los atributos con los que se mide el sesgo.
 *
 * Es la pieza que le faltaba a las pantallas de auditoría del portal. El demo BNPL sembraba
 * el artefacto, su grafo, su aprobación y su despliegue en producción — y ni una sola
 * ejecución. Con eso `/executions` salía vacío, `/decision-quality` no tenía denominador,
 * `/model-monitoring` no tenía población que comparar y la matriz de cosechas era una
 * cuadrícula gris. Las siete vistas respondían 200 sobre listas vacías, que es
 * indistinguible de un sistema apagado — el fallo que este repositorio persigue en todas
 * partes, una capa más adentro.
 *
 * Sólo corre con las semillas de DEMOSTRACIÓN (`SEED_INCLUDE_MOCKUP`, ver
 * `mockup-policy.ts`): son decisiones inventadas sobre personas que no existen, y en una
 * base productiva serían evidencia regulatoria falsa.
 */
import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AUDIT_CAST, CARTERA_DEMO, VENTANAS_DEMO, type CasoDemo } from './audit-demo.data';
import { canSignAuditSeed, seedHmac } from './audit-hash';
import { sha256, TENANT_ID } from './helpers';

const logger = new Logger('SeedAuditDemo');

const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';

/**
 * Prefijo del `requestId` de todo lo que siembra este archivo.
 *
 * Es lo que hace la siembra idempotente sin una tabla de control, y —más importante— lo
 * que permite BORRARLA sin tocar las decisiones que alguien haya ejecutado a mano en su
 * máquina. Un `deleteMany` por artefacto se habría llevado por delante las pruebas del día.
 */
export const DEMO_REQUEST_PREFIX = 'bnpl-cartera-demo';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Las entradas que se guardan por ejecución. Un subconjunto del contrato, no el contrato. */
const VARIABLES_TRAZADAS = [
  'requested_amount',
  'requested_term_months',
  'bureau_score',
  'debt_to_income_ratio',
  'employment_status',
  'age',
] as const;

export interface AuditDemoSummary {
  ejecuciones: number;
  sujetos: number;
  creditos: number;
  ventanas: number;
  desenlaces: number;
  revisionesManuales: number;
}

interface Contexto {
  deploymentId: bigint;
  artifactVersionId: bigint;
  environmentId: bigint;
  /** Versión vigente de cada variable trazada, por código. */
  variableVersionByCode: Map<string, bigint>;
  /** Motivo → la acción del grafo que lo emite. Sin acción no hay fila de motivo. */
  motivoPorCodigo: Map<string, { reasonCodeId: bigint; actionId: bigint; mensaje: string }>;
}

/**
 * Siembra la cartera. Idempotente: si ya están las ejecuciones del demo, no hace nada.
 *
 * Devuelve `undefined` cuando no puede sembrar —sin despliegue activo en producción o sin
 * secreto para seudonimizar— y lo dice en la bitácora. No lanza: la siembra base tiene que
 * poder terminar aunque el demo no se pueda completar, o una instalación nueva se queda
 * sin catálogo por culpa de unos datos de ejemplo.
 */
export async function seedAuditDemo(prisma: PrismaClient): Promise<AuditDemoSummary | undefined> {
  if (!canSignAuditSeed()) {
    logger.warn('Sin AUDIT_HASH_SECRET no se puede seudonimizar al solicitante; cartera omitida');
    return undefined;
  }

  const yaSembradas = await prisma.decisionExecution.count({
    where: { tenantId: TENANT_ID, requestId: { startsWith: `${DEMO_REQUEST_PREFIX}-` } },
  });
  if (yaSembradas >= CARTERA_DEMO.length) {
    logger.log(`Cartera de auditoría ya sembrada (${yaSembradas} decisiones)`);
    return undefined;
  }

  const contexto = await resolverContexto(prisma);
  if (!contexto) return undefined;

  const resumen: AuditDemoSummary = {
    ejecuciones: 0,
    sujetos: 0,
    creditos: 0,
    ventanas: 0,
    desenlaces: 0,
    revisionesManuales: 0,
  };
  const ahora = Date.now();
  const sujetosVistos = new Set<string>();

  for (const caso of CARTERA_DEMO) {
    const escrito = await sembrarCaso(prisma, contexto, caso, ahora, sujetosVistos);
    if (!escrito) continue;
    resumen.ejecuciones += 1;
    resumen.creditos += escrito.credito ? 1 : 0;
    resumen.ventanas += escrito.ventanas;
    resumen.desenlaces += escrito.desenlaces;
    resumen.revisionesManuales += escrito.revisionManual ? 1 : 0;
  }
  resumen.sujetos = sujetosVistos.size;

  logger.log(
    `Cartera de auditoría sembrada: ${resumen.ejecuciones} decisiones, ${resumen.sujetos} sujetos, ` +
      `${resumen.creditos} créditos, ${resumen.ventanas} ventanas y ${resumen.desenlaces} desenlaces`,
  );
  return resumen;
}

async function resolverContexto(prisma: PrismaClient): Promise<Contexto | undefined> {
  // El despliegue ACTIVO en producción, que es donde de verdad se decide. Sembrar contra
  // el de DEV dejaría la vigilancia sin nada que medir: `MonitoringEvaluatorService` sólo
  // mira versiones con despliegue activo en un ambiente de producción, a propósito.
  const deployment = await prisma.decisionDeployment.findFirst({
    where: {
      isActive: true,
      environment: { isProduction: true },
      artifactVersion: { artifact: { tenantId: TENANT_ID, artifactCode: ARTIFACT_CODE } },
    },
    orderBy: { id: 'desc' },
  });
  if (!deployment) {
    logger.warn(`Sin despliegue activo en producción de ${ARTIFACT_CODE}; cartera omitida`);
    return undefined;
  }

  const definiciones = await prisma.decisionVariableDefinition.findMany({
    where: { tenantId: TENANT_ID, variableCode: { in: [...VARIABLES_TRAZADAS] } },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  const variableVersionByCode = new Map<string, bigint>();
  for (const definicion of definiciones) {
    const version = definicion.versions[0];
    if (version) variableVersionByCode.set(definicion.variableCode, version.id);
  }

  const mapeos = await prisma.decisionActionReasonMapping.findMany({
    where: { action: { artifactVersionId: deployment.artifactVersionId } },
    include: { reasonCode: true },
  });
  const motivoPorCodigo = new Map<
    string,
    { reasonCodeId: bigint; actionId: bigint; mensaje: string }
  >();
  for (const mapeo of mapeos) {
    motivoPorCodigo.set(mapeo.reasonCode.reasonCode, {
      reasonCodeId: mapeo.reasonCodeId,
      actionId: mapeo.actionId,
      // El mensaje PÚBLICO, que es el que se le comunicó a quien recibió la negativa. El
      // interno explica el porqué al analista y no puede acabar en una carta de rechazo.
      mensaje: mapeo.reasonCode.publicMessage,
    });
  }

  return {
    deploymentId: deployment.id,
    artifactVersionId: deployment.artifactVersionId,
    environmentId: deployment.environmentId,
    variableVersionByCode,
    motivoPorCodigo,
  };
}

interface CasoEscrito {
  credito: boolean;
  ventanas: number;
  desenlaces: number;
  revisionManual: boolean;
}

async function sembrarCaso(
  prisma: PrismaClient,
  contexto: Contexto,
  caso: CasoDemo,
  ahora: number,
  sujetosVistos: Set<string>,
): Promise<CasoEscrito | undefined> {
  const requestId = `${DEMO_REQUEST_PREFIX}-${caso.folio}`;
  const existente = await prisma.decisionExecution.findUnique({
    where: { tenantId_requestId: { tenantId: TENANT_ID, requestId } },
    select: { id: true },
  });
  if (existente) return undefined;

  const decididoEn = new Date(ahora - caso.diasAtras * DIA_MS);
  const subjectReferenceHash = seedHmac(caso.referencia);
  sujetosVistos.add(subjectReferenceHash);

  return prisma.$transaction(async (tx) => {
    const sujeto = await tx.decisionSubject.upsert({
      where: { tenantId_subjectReferenceHash: { tenantId: TENANT_ID, subjectReferenceHash } },
      create: {
        tenantId: TENANT_ID,
        subjectReferenceHash,
        firstSeenAt: decididoEn,
        lastSeenAt: decididoEn,
        decisionCount: 1,
      },
      update: { decisionCount: { increment: 1 }, lastSeenAt: decididoEn },
    });

    const ejecucion = await tx.decisionExecution.create({
      data: {
        tenantId: TENANT_ID,
        deploymentId: contexto.deploymentId,
        artifactVersionId: contexto.artifactVersionId,
        environmentId: contexto.environmentId,
        requestId,
        correlationId: `orig-${caso.folio}`,
        idempotencyKey: `${requestId}-1`,
        subjectReferenceHash,
        subjectId: sujeto.id,
        inputSnapshotJson: entradaDe(caso),
        outputJson: salidaDe(caso),
        decisionStatus: 'SUCCEEDED',
        businessOutcome: caso.desenlace,
        durationMs: caso.duracionMs,
        executedAt: decididoEn,
      },
    });

    await escribirVariables(tx, contexto, caso, ejecucion.id, decididoEn);
    await escribirMotivos(tx, contexto, caso, ejecucion.id);
    await escribirAtributos(tx, caso, ejecucion.id, decididoEn);

    const credito = await crearCredito(tx, caso, ejecucion.id, sujeto.id, decididoEn);
    const ventanas = await programarVentanas(tx, caso, ejecucion.id, credito?.id, decididoEn);
    const desenlaces = await registrarDesenlaces(tx, caso, ejecucion.id, credito?.id, decididoEn);
    const revisionManual = await abrirRevisionManual(tx, caso, ejecucion.id, decididoEn);

    return { credito: Boolean(credito), ventanas, desenlaces, revisionManual };
  });
}

/** La foto de entrada. Es lo que hace reproducible una decisión dos años después. */
function entradaDe(caso: CasoDemo): Prisma.InputJsonValue {
  return {
    requested_amount: caso.montoSolicitado,
    requested_term_months: caso.plazoMeses,
    currency_code: 'BOB',
    bureau_score: caso.puntaje,
    debt_to_income_ratio: Number((0.9 - caso.puntaje / 1200).toFixed(3)),
    employment_status: caso.bandaEdad === '18-25' ? 'SELF_EMPLOYED' : 'EMPLOYED',
    age: edadRepresentativa(caso.bandaEdad),
    channel: 'MOBILE_APP',
    branch_region: caso.regional,
  };
}

function salidaDe(caso: CasoDemo): Prisma.InputJsonValue {
  return {
    decision_outcome: caso.desenlace,
    credit_risk_score: caso.puntaje,
    probability_of_default: caso.probabilidadIncumplimiento,
    approved_amount: caso.montoAprobado ?? 0,
    approved_term_months: caso.montoAprobado ? caso.plazoMeses : 0,
    annual_percentage_rate: caso.tasaAnual,
    adverse_action_reason_codes: [...caso.motivos],
  };
}

/** Un valor concreto por banda: la banda es lo que se guarda, esto sólo alimenta la traza. */
function edadRepresentativa(banda: CasoDemo['bandaEdad']): number {
  const [desde, hasta] = banda.split('-').map(Number);
  return Math.floor((desde + hasta) / 2);
}

async function escribirVariables(
  tx: Prisma.TransactionClient,
  contexto: Contexto,
  caso: CasoDemo,
  executionId: bigint,
  decididoEn: Date,
): Promise<void> {
  const entrada = entradaDe(caso) as Record<string, unknown>;
  for (const codigo of VARIABLES_TRAZADAS) {
    const variableVersionId = contexto.variableVersionByCode.get(codigo);
    if (!variableVersionId) continue;
    const valor = entrada[codigo];
    // `observedAt` se separa de `fetchedAt` a propósito, y con una hora de diferencia: el
    // buró entrega una foto que ya tenía tomada. Con los dos sellos iguales, la antigüedad
    // real del dato al decidir sería siempre cero y la columna no mediría nada.
    const observedAt = new Date(decididoEn.getTime() - 60 * 60 * 1000);
    await tx.decisionExecutionVariable.create({
      data: {
        executionId,
        variableVersionId,
        valueJson: valor as Prisma.InputJsonValue,
        valueHash: sha256(valor),
        sourceCode: codigo === 'bureau_score' ? 'INFOCRED' : 'REQUEST',
        resolutionStatus: 'RESOLVED',
        observedAt,
        fetchedAt: decididoEn,
        sourceVersion: codigo === 'bureau_score' ? 'infocred-v3' : 'api-v1',
        ageSeconds: 3600,
      },
    });
  }
}

async function escribirMotivos(
  tx: Prisma.TransactionClient,
  contexto: Contexto,
  caso: CasoDemo,
  executionId: bigint,
): Promise<void> {
  let prioridad = 10;
  for (const codigo of caso.motivos) {
    const motivo = contexto.motivoPorCodigo.get(codigo);
    // Un motivo que el grafo desplegado no emite NO se inventa aquí: la fila exige la
    // acción que lo produjo, y sin ella la traza afirmaría que el algoritmo dijo algo que
    // no puede decir.
    if (!motivo) continue;
    await tx.decisionExecutionReason.create({
      data: {
        executionId,
        reasonCodeId: motivo.reasonCodeId,
        sourceActionId: motivo.actionId,
        priority: prioridad,
        renderedMessage: motivo.mensaje,
      },
    });
    prioridad += 10;
  }
}

async function escribirAtributos(
  tx: Prisma.TransactionClient,
  caso: CasoDemo,
  executionId: bigint,
  decididoEn: Date,
): Promise<void> {
  const atributos: Array<[string, string]> = [
    ['AGE_BAND', caso.bandaEdad],
    ['GENDER', caso.genero],
    ['REGION', caso.regional],
  ];
  for (const [atributo, grupo] of atributos) {
    await tx.decisionMonitoringAttribute.create({
      data: {
        tenantId: TENANT_ID,
        executionId,
        attribute: atributo,
        groupValue: grupo,
        // Se registra DESPUÉS de decidir y por su propio camino. La fecha lo dice.
        recordedAt: new Date(decididoEn.getTime() + 5 * 60 * 1000),
        recordedBy: AUDIT_CAST.cumplimiento,
      },
    });
  }
}

async function crearCredito(
  tx: Prisma.TransactionClient,
  caso: CasoDemo,
  executionId: bigint,
  subjectId: bigint,
  decididoEn: Date,
): Promise<{ id: bigint } | undefined> {
  if (caso.desenlace !== 'APPROVED' || !caso.montoAprobado) return undefined;
  // El desembolso no es el mismo día que la decisión: firma, verificación y abono llevan
  // dos días hábiles. Importa porque el análisis de cosechas agrupa por desembolso.
  const disbursedAt = new Date(decididoEn.getTime() + 2 * DIA_MS);
  const credito = await tx.creditFacility.create({
    data: {
      tenantId: TENANT_ID,
      subjectId,
      externalReference: caso.folio,
      originationExecutionId: executionId,
      principalAmount: new Prisma.Decimal(caso.montoAprobado),
      currencyCode: 'BOB',
      termMonths: caso.plazoMeses,
      annualRate: new Prisma.Decimal(caso.tasaAnual),
      disbursedAt,
      createdAt: disbursedAt,
    },
    select: { id: true },
  });
  return credito;
}

async function programarVentanas(
  tx: Prisma.TransactionClient,
  caso: CasoDemo,
  executionId: bigint,
  facilityId: bigint | undefined,
  decididoEn: Date,
): Promise<number> {
  // Se materializan AL DECIDIR, no al observar: es lo que le da denominador a la cobertura.
  // Una ventana que vence sin que nadie la cierre TIENE que poder verse, y por eso se
  // escriben también las de los casos que este demo deja sin observar a propósito.
  let escritas = 0;
  for (const dias of VENTANAS_DEMO) {
    const observacion = caso.observaciones.find((item) => item.ventanaDias === dias);
    await tx.outcomeWindowSchedule.create({
      data: {
        tenantId: TENANT_ID,
        executionId,
        facilityId: facilityId ?? null,
        windowDays: dias,
        dueAt: new Date(decididoEn.getTime() + dias * DIA_MS),
        observedAt: observacion ? new Date(decididoEn.getTime() + dias * DIA_MS) : null,
      },
    });
    escritas += 1;
  }
  return escritas;
}

async function registrarDesenlaces(
  tx: Prisma.TransactionClient,
  caso: CasoDemo,
  executionId: bigint,
  facilityId: bigint | undefined,
  decididoEn: Date,
): Promise<number> {
  let escritos = 0;
  for (const observacion of caso.observaciones) {
    await tx.decisionOutcomeObservation.create({
      data: {
        tenantId: TENANT_ID,
        executionId,
        facilityId: facilityId ?? null,
        windowDays: observacion.ventanaDias,
        label: observacion.etiqueta,
        amount: observacion.monto === undefined ? null : new Prisma.Decimal(observacion.monto),
        source: observacion.origen,
        // Nulo = observado. Ver el comentario del esquema: mezclar inferidos con observados
        // calibra el modelo contra la población ya aprobada y lo hace parecer perfecto.
        inferenceMethod: observacion.metodoInferencia ?? null,
        notes: observacion.nota ?? null,
        observedAt: new Date(decididoEn.getTime() + observacion.ventanaDias * DIA_MS),
        recordedBy: AUDIT_CAST.riesgoOps,
      },
    });
    escritos += 1;
  }
  return escritos;
}

async function abrirRevisionManual(
  tx: Prisma.TransactionClient,
  caso: CasoDemo,
  executionId: bigint,
  decididoEn: Date,
): Promise<boolean> {
  if (caso.desenlace !== 'MANUAL_REVIEW') return false;
  const resuelto = caso.observaciones.length > 0;
  await tx.decisionManualReviewCase.create({
    data: {
      executionId,
      tenantId: TENANT_ID,
      caseCode: `MR-${caso.folio}`,
      queueCode: caso.motivos.includes('LIVENESS_CHECK_FAILED') ? 'IDENTIDAD' : 'RIESGO',
      priority: caso.montoSolicitado >= 10000 ? 10 : 50,
      status: resuelto ? 'RESOLVED_APPROVED' : 'OPEN',
      assignedTo: resuelto ? AUDIT_CAST.operaciones : null,
      // 48 horas es el compromiso de servicio de la mesa. Un vencimiento en el pasado sobre
      // un caso ABIERTO es información, no un defecto de la siembra: es la cola atrasada.
      dueAt: new Date(decididoEn.getTime() + 2 * DIA_MS),
      evidenceJson: {
        motivos: [...caso.motivos],
        puntaje: caso.puntaje,
        montoSolicitado: caso.montoSolicitado,
        regional: caso.regional,
      },
      resolutionJson: resuelto
        ? {
            decision: 'APPROVED',
            resueltoPor: AUDIT_CAST.operaciones,
            nota: caso.observaciones[0]?.nota ?? 'Resuelto por la mesa.',
          }
        : Prisma.DbNull,
      createdAt: decididoEn,
      resolvedAt: resuelto ? new Date(decididoEn.getTime() + 3 * DIA_MS) : null,
    },
  });
  return true;
}

/**
 * La BITÁCORA: el ciclo de vida del artefacto demo escrito como cadena encadenada por hash.
 *
 * `/audit-events` es la pantalla que afirma «esto pasó y nadie lo tocó». Sin eventos, esa
 * afirmación se hace sobre una lista vacía y la comprobación de integridad sale en verde
 * porque no hay nada que verificar — el estado más engañoso de todos.
 *
 * ## Se APPENDA, nunca se reescribe
 *
 * Los eventos se enlazan tomando el `eventHash` del último evento del tenant como
 * `previousHash` del primero que se escribe aquí, exactamente igual que `AuditService`. Por
 * eso esta siembra puede convivir con lo que ya haya en la base: extiende la cadena, no la
 * sustituye. Y por eso mismo NO puede correr dos veces: se protege con un centinela.
 *
 * ## Firma de verdad
 *
 * Se firma con `AUDIT_HASH_SECRET` a través de `seedHmac`, que es literalmente lo que hace
 * `HashService`. La tentación —rellenar `event_hash` con cualquier cosa para que la tabla no
 * esté vacía— produce una cadena que la pantalla declara ROTA, y enseñar «integridad
 * comprometida» sobre datos de demostración entrena a ignorar precisamente esa alarma.
 *
 * ## La historia que cuenta
 *
 * Una versión que se diseña, se prueba, la aprueba alguien DISTINTO de quien la pidió, se
 * promueve, decide sobre veinticuatro personas, deriva, dispara una alarma de estabilidad,
 * atiende cuatro solicitudes de titular y termina con una auditoría interna verificando la
 * cadena. Cada evento tiene actor, agregado y carga: es lo que hace que la bitácora se pueda
 * FILTRAR, que es la diferencia entre un registro y un archivo de texto.
 */
import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AUDIT_CAST, CARTERA_DEMO } from './audit-demo.data';
import { canSignAuditSeed, seedHashKeyId, seedHmac } from './audit-hash';
import { TENANT_ID } from './helpers';
import { canonicalize } from '../../../common/crypto/canonical-json';

const logger = new Logger('SeedAuditChain');

const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';
const VERSION = '2.3.0';
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Centinela de la siembra. Va en `requestId` de todos los eventos que escribe este archivo,
 * así que también es lo que permite localizarlos después sin adivinar por el tipo de evento.
 */
export const DEMO_AUDIT_REQUEST = 'seed-bitacora-demo';

interface EventoDemo {
  tipo: string;
  agregadoTipo: string;
  agregadoId: string;
  actor: string;
  diasAtras: number;
  carga: Prisma.InputJsonValue;
}

export async function seedAuditChain(prisma: PrismaClient): Promise<number> {
  if (!canSignAuditSeed()) {
    logger.warn('Sin AUDIT_HASH_SECRET no se puede firmar la cadena; bitácora omitida');
    return 0;
  }
  const yaSembrada = await prisma.decisionAuditEvent.count({
    where: { tenantId: TENANT_ID, requestId: DEMO_AUDIT_REQUEST },
  });
  if (yaSembrada > 0) {
    logger.log(`Bitácora de demostración ya sembrada (${yaSembrada} eventos)`);
    return 0;
  }

  const eventos = construirNarrativa();
  const hashKeyId = seedHashKeyId();

  // Un solo `$transaction`: una cadena a medio escribir es peor que ninguna, porque el
  // último evento apunta a un hash que sí existe y la siguiente corrida engancharía detrás
  // sin que nada delate el corte.
  const escritos = await prisma.$transaction(async (tx) => {
    const cabeza = await tx.decisionAuditEvent.findFirst({
      where: { tenantId: TENANT_ID },
      orderBy: { id: 'desc' },
      select: { eventHash: true },
    });
    let previousHash: string | null = cabeza?.eventHash ?? null;
    let total = 0;

    for (const evento of eventos) {
      const payload = {
        tenantId: TENANT_ID.toString(),
        eventType: evento.tipo,
        aggregateType: evento.agregadoTipo,
        aggregateId: evento.agregadoId,
        actorId: evento.actor,
        requestId: DEMO_AUDIT_REQUEST,
        payload: evento.carga,
        previousHash,
      };
      // Se congela la cadena canónica EXACTA y se firma eso, igual que el motor: verificar
      // rehashea esta cadena en vez de reserializar el JSONB, que Postgres renormaliza y
      // convertiría un evento válido en un falso EVENT_HASH_MISMATCH.
      const canonicalPayload = canonicalize(payload);
      const eventHash = seedHmac(canonicalPayload);
      await tx.decisionAuditEvent.create({
        data: {
          tenantId: TENANT_ID,
          eventType: evento.tipo,
          aggregateType: evento.agregadoTipo,
          aggregateId: evento.agregadoId,
          actorId: evento.actor,
          requestId: DEMO_AUDIT_REQUEST,
          payloadJson: evento.carga,
          previousHash,
          eventHash,
          hashKeyId,
          canonicalPayload,
          occurredAt: new Date(Date.now() - evento.diasAtras * DIA_MS),
        },
      });
      previousHash = eventHash;
      total += 1;
    }
    return total;
  });

  logger.log(`Bitácora de demostración sembrada: ${escritos} eventos encadenados`);
  return escritos;
}

/** El relato completo, en orden cronológico. El orden ES la cadena. */
function construirNarrativa(): EventoDemo[] {
  const artefacto = `${ARTIFACT_CODE}@${VERSION}`;
  const eventos: EventoDemo[] = [
    {
      tipo: 'ARTIFACT_CREATED',
      agregadoTipo: 'DecisionArtifact',
      agregadoId: ARTIFACT_CODE,
      actor: AUDIT_CAST.autora,
      diasAtras: 470,
      carga: { artifactCode: ARTIFACT_CODE, riskDomain: 'CREDIT_ORIGINATION' },
    },
    {
      tipo: 'RULE_GRAPH_REPLACED',
      agregadoTipo: 'DecisionArtifactVersion',
      agregadoId: artefacto,
      actor: AUDIT_CAST.autora,
      diasAtras: 462,
      carga: {
        nodos: 32,
        aristas: 49,
        etapas: ['KYC', 'FRAUDE', 'ELEGIBILIDAD', 'RIESGO', 'CAPACIDAD', 'AML'],
      },
    },
    {
      tipo: 'VALIDATION_PASSED',
      agregadoTipo: 'DecisionArtifactVersion',
      agregadoId: artefacto,
      actor: AUDIT_CAST.autora,
      diasAtras: 461,
      carga: {
        validadores: ['ciclos', 'dominancia de intermedias', 'contrato de salida'],
        hallazgos: 0,
      },
    },
    {
      tipo: 'ARTIFACT_COMPILED',
      agregadoTipo: 'DecisionArtifactVersion',
      agregadoId: artefacto,
      actor: AUDIT_CAST.autora,
      diasAtras: 461,
      carga: { semanticVersion: VERSION },
    },
    {
      tipo: 'TEST_SUITE_CREATED',
      agregadoTipo: 'DecisionTestSuite',
      agregadoId: `${ARTIFACT_CODE}/regresion`,
      actor: AUDIT_CAST.calidad,
      diasAtras: 458,
      carga: { casos: 21, cobertura: 'una rama de rechazo por etapa' },
    },
    {
      tipo: 'TEST_RUN_PASSED',
      agregadoTipo: 'DecisionTestRun',
      agregadoId: `${ARTIFACT_CODE}/regresion#1`,
      actor: AUDIT_CAST.calidad,
      diasAtras: 457,
      carga: { casos: 21, aprobados: 21, nodosCubiertos: 32, aristasCubiertas: 49 },
    },
    {
      tipo: 'APPROVAL_REQUEST_CREATED',
      agregadoTipo: 'DecisionApprovalRequest',
      agregadoId: `${artefacto}/promocion-prod`,
      actor: AUDIT_CAST.autora,
      diasAtras: 456,
      carga: {
        ambienteDestino: 'PROD',
        justificacion: 'Estreno del producto BNPL en las seis regionales.',
      },
    },
    {
      tipo: 'APPROVAL_APPROVE',
      agregadoTipo: 'DecisionApprovalRequest',
      agregadoId: `${artefacto}/promocion-prod`,
      actor: AUDIT_CAST.aprobador,
      diasAtras: 455,
      // Quien aprueba NO es quien pidió, y por eso los dos correos están escritos: la
      // separación de funciones sólo es comprobable si se puede ver.
      carga: {
        solicitadoPor: AUDIT_CAST.autora,
        comentario: 'Cobertura de pruebas suficiente; se aprueba.',
      },
    },
    {
      tipo: 'DEPLOYMENT_ACTIVATED',
      agregadoTipo: 'DecisionDeployment',
      agregadoId: `${artefacto}@STAGING`,
      actor: AUDIT_CAST.operaciones,
      diasAtras: 454,
      carga: { environment: 'STAGING', mode: 'FULL' },
    },
    {
      tipo: 'DEPLOYMENT_ACTIVATED',
      agregadoTipo: 'DecisionDeployment',
      agregadoId: `${artefacto}@PROD`,
      actor: AUDIT_CAST.operaciones,
      diasAtras: 450,
      carga: { environment: 'PROD', mode: 'FULL', previousVersion: null },
    },
    {
      tipo: 'MONITORING_BASELINE_CAPTURED',
      agregadoTipo: 'MonitoringBaseline',
      agregadoId: artefacto,
      actor: AUDIT_CAST.vigilancia,
      diasAtras: 450,
      carga: {
        variables: ['bureau_score', 'requested_amount', 'debt_to_income_ratio'],
        muestra: 4820,
      },
    },
    {
      tipo: 'EXPOSURE_LIMIT_CREATED',
      agregadoTipo: 'ExposureLimit',
      agregadoId: 'SUBJECT_TOTAL',
      actor: AUDIT_CAST.aprobador,
      diasAtras: 449,
      carga: { maxValue: 25000, currencyCode: 'BOB', enforced: true },
    },
    {
      tipo: 'EXPOSURE_LIMIT_CREATED',
      agregadoTipo: 'ExposureLimit',
      agregadoId: 'SEGMENT_CONCENTRATION:ORURO',
      actor: AUDIT_CAST.aprobador,
      diasAtras: 120,
      carga: {
        maxValue: 200000,
        currencyCode: 'BOB',
        enforced: false,
        nota: 'Se estrena midiendo; se impondrá tras un mes de observación.',
      },
    },
  ];

  // Una decisión, un evento. Es lo que hace que «quién decidió sobre esta persona y cuándo»
  // se pueda responder sin recorrer la tabla de ejecuciones.
  for (const caso of CARTERA_DEMO) {
    eventos.push({
      tipo: 'DECISION_EXECUTED',
      agregadoTipo: 'DecisionExecution',
      agregadoId: caso.folio,
      actor: AUDIT_CAST.runtime,
      diasAtras: caso.diasAtras,
      carga: {
        artifactCode: ARTIFACT_CODE,
        version: VERSION,
        outcome: caso.desenlace,
        reasonCodes: [...caso.motivos],
        durationMs: caso.duracionMs,
      },
    });
  }

  for (const caso of CARTERA_DEMO) {
    if (caso.desenlace !== 'MANUAL_REVIEW' || caso.observaciones.length === 0) continue;
    eventos.push({
      tipo: 'MANUAL_REVIEW_RESOLVED',
      agregadoTipo: 'DecisionManualReviewCase',
      agregadoId: `MR-${caso.folio}`,
      actor: AUDIT_CAST.operaciones,
      diasAtras: caso.diasAtras - 3,
      carga: { decision: 'APPROVED', motivoOriginal: caso.motivos[0] ?? null },
    });
  }

  const desenlacesCargados = CARTERA_DEMO.reduce(
    (total, caso) => total + caso.observaciones.length,
    0,
  );
  eventos.push(
    {
      tipo: 'OUTCOME_BATCH_INGESTED',
      agregadoTipo: 'DecisionOutcomeObservation',
      agregadoId: 'carga-core-cartera',
      actor: AUDIT_CAST.riesgoOps,
      diasAtras: 30,
      carga: {
        filas: desenlacesCargados,
        origen: 'core-cartera',
        dryRunPrevio: true,
        // La validación completa ANTES de escribir no es ceremonia: descubrir en la fila
        // 4000 que una referencia no existía, con 3999 ya escritas sobre evidencia
        // regulatoria, obliga a un borrado manual sobre la tabla que no se debe borrar.
        rechazadas: 0,
      },
    },
    {
      tipo: 'MONITORING_BREACH_DETECTED',
      agregadoTipo: 'MonitoringEvaluation',
      agregadoId: `${artefacto}/PSI/bureau_score`,
      actor: AUDIT_CAST.vigilancia,
      diasAtras: 7,
      carga: {
        metricCode: 'PSI',
        scope: 'bureau_score',
        value: 0.187,
        threshold: 0.1,
        sampleSize: 1180,
      },
    },
    {
      tipo: 'REIDENTIFICATION_REQUESTED',
      agregadoTipo: 'ReidentificationRequest',
      agregadoId: 'reid-2026-0031',
      actor: AUDIT_CAST.cumplimiento,
      diasAtras: 40,
      carga: { motivo: 'Reclamo formal ante la ASFI' },
    },
    {
      tipo: 'REIDENTIFICATION_APPROVED',
      agregadoTipo: 'ReidentificationRequest',
      agregadoId: 'reid-2026-0031',
      actor: AUDIT_CAST.aprobador,
      diasAtras: 39,
      carga: { solicitadoPor: AUDIT_CAST.cumplimiento },
    },
    {
      tipo: 'REIDENTIFICATION_CONSUMED',
      agregadoTipo: 'ReidentificationRequest',
      agregadoId: 'reid-2026-0031',
      actor: AUDIT_CAST.cumplimiento,
      diasAtras: 38,
      carga: { nota: 'Autorización gastada; no vale para la siguiente consulta.' },
    },
    {
      tipo: 'DATA_SUBJECT_REQUEST_FULFILLED',
      agregadoTipo: 'DecisionDataSubjectRequest',
      agregadoId: 'TCK-2026-0417',
      actor: AUDIT_CAST.cumplimiento,
      diasAtras: 49,
      carga: { requestType: 'ACCESS', formato: 'PDF' },
    },
    {
      tipo: 'DATA_SUBJECT_REQUEST_REJECTED',
      agregadoTipo: 'DecisionDataSubjectRequest',
      agregadoId: 'TCK-2026-0588',
      actor: AUDIT_CAST.cumplimiento,
      diasAtras: 9,
      carga: {
        requestType: 'ERASURE',
        motivo: 'CONSERVACION_LEGAL',
        detalle: 'La bitácora es append-only y se conserva por obligación legal (LGPD art. 16 I).',
      },
    },
    {
      tipo: 'AUDIT_CHAIN_VERIFIED',
      agregadoTipo: 'DecisionAuditEvent',
      agregadoId: 'cadena-tenant',
      actor: AUDIT_CAST.auditoria,
      diasAtras: 2,
      carga: { valid: true, alcance: 'revisión trimestral de auditoría interna' },
    },
  );

  // El orden cronológico ES el orden de la cadena: un evento con fecha anterior insertado
  // después haría que la bitácora se leyera al revés en la vista por fecha, que ordena por
  // `occurredAt`, mientras la integridad se verifica por `id`.
  return eventos.sort((izquierda, derecha) => derecha.diasAtras - izquierda.diasAtras);
}

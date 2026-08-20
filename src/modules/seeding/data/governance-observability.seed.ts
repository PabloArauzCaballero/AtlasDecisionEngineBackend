/**
 * Lo que CONDICIONA una decisión sin tomarla, y lo que permite saber si el modelo sigue
 * mereciendo la confianza que se le dio: líneas base, mediciones de vigilancia, curva de
 * calibración, estado de la cartera, límites de exposición, licitud vigente,
 * reidentificaciones y solicitudes de titular.
 *
 * Estas ocho tablas tienen un rasgo común: el motor sabía escribirlas y nadie las escribía
 * nunca, así que las tres pantallas de medición del portal —`/decision-quality`,
 * `/model-monitoring` y `/risk-governance`— salían en verde sobre cero filas. Ése es
 * justamente el peor de los estados posibles: un tablero de degradación en verde sobre un
 * sistema de observación apagado no se distingue de un modelo sano.
 *
 * Cada bloque de aquí abajo está construido para que la pantalla que lo lee enseñe algo que
 * se pueda LEER MAL si se lee sin cuidado, porque para eso existen esas pantallas:
 *
 * - hay una medición en `WATCH` y otra en `BREACH`, no todo en verde;
 * - la calibración está sesgada en los deciles altos, que es como se tuerce de verdad;
 * - hay un límite que BLOQUEA y otro que sólo mide, que la pantalla distingue a propósito;
 * - hay un consentimiento VENCIDO y otro REVOCADO, no sólo vigentes;
 * - hay una reidentificación pedida y todavía sin decidir.
 *
 * Sólo corre con las semillas de DEMOSTRACIÓN (`SEED_INCLUDE_MOCKUP`).
 */
import { Logger } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AUDIT_CAST } from './audit-demo.data';
import { TENANT_ID } from './helpers';

const logger = new Logger('SeedGovernanceObservability');

const ARTIFACT_CODE = 'BNPL_CREDIT_DECISION';
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Trunca a las 00:00 UTC.
 *
 * Es lo que hace que dos corridas del mismo día converjan en la misma fila en vez de
 * apilarse. Las tablas de serie temporal de este archivo no llevan clave única sobre la
 * fecha —dos mediciones reales del mismo día son legítimas—, así que la única defensa
 * contra la siembra repetida es que la fecha que se escribe no dependa de a qué hora se
 * sembró.
 */
function aMedianoche(instante: number): Date {
  const fecha = new Date(instante);
  fecha.setUTCHours(0, 0, 0, 0);
  return fecha;
}

export interface GovernanceObservabilitySummary {
  lineasBase: number;
  mediciones: number;
  decilesCalibracion: number;
  estadosCartera: number;
  limites: number;
  consentimientos: number;
  reidentificaciones: number;
  solicitudesTitular: number;
}

export async function seedGovernanceObservability(
  prisma: PrismaClient,
): Promise<GovernanceObservabilitySummary | undefined> {
  const deployment = await prisma.decisionDeployment.findFirst({
    where: {
      isActive: true,
      environment: { isProduction: true },
      artifactVersion: { artifact: { tenantId: TENANT_ID, artifactCode: ARTIFACT_CODE } },
    },
    orderBy: { id: 'desc' },
  });
  if (!deployment) {
    logger.warn(`Sin despliegue activo en producción de ${ARTIFACT_CODE}; gobierno omitido`);
    return undefined;
  }
  const artifactVersionId = deployment.artifactVersionId;
  const ahora = Date.now();

  const resumen: GovernanceObservabilitySummary = {
    lineasBase: await sembrarLineasBase(prisma, artifactVersionId, deployment.deployedAt),
    mediciones: await sembrarMediciones(prisma, artifactVersionId, ahora),
    decilesCalibracion: await sembrarCalibracion(prisma, artifactVersionId, ahora),
    estadosCartera: await sembrarEstadoCartera(prisma, ahora),
    limites: await sembrarLimites(prisma),
    consentimientos: await sembrarConsentimientos(prisma, ahora),
    reidentificaciones: await sembrarReidentificaciones(prisma, ahora),
    solicitudesTitular: await sembrarSolicitudesTitular(prisma, ahora),
  };

  logger.log(
    `Gobierno y vigilancia sembrados: ${resumen.lineasBase} líneas base, ${resumen.mediciones} mediciones, ` +
      `${resumen.limites} límites, ${resumen.consentimientos} consentimientos y ` +
      `${resumen.solicitudesTitular} solicitudes de titular`,
  );
  return resumen;
}

/**
 * La distribución contra la que se compara la población de hoy, congelada al PROMOVER.
 *
 * Se sella con la fecha del despliegue y no con la de la siembra: una referencia tomada
 * «ahora» derivaría junto con la población y el índice de estabilidad se quedaría plano
 * mientras el modelo se aleja del mundo, que es el modo silencioso de fallar de este control.
 */
async function sembrarLineasBase(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  capturedAt: Date,
): Promise<number> {
  const lineas: Array<{
    variable: string;
    bordes: number[];
    frecuencias: number[];
    muestra: number;
  }> = [
    {
      variable: 'bureau_score',
      bordes: [300, 450, 550, 620, 680, 720, 760, 850],
      frecuencias: [0.04, 0.09, 0.16, 0.21, 0.22, 0.17, 0.11],
      muestra: 4820,
    },
    {
      variable: 'requested_amount',
      bordes: [500, 2000, 3500, 5000, 8000, 12000, 20000],
      frecuencias: [0.11, 0.24, 0.27, 0.19, 0.13, 0.06],
      muestra: 4820,
    },
    {
      variable: 'debt_to_income_ratio',
      bordes: [0, 0.15, 0.25, 0.35, 0.45, 0.6, 1],
      frecuencias: [0.13, 0.22, 0.28, 0.21, 0.11, 0.05],
      muestra: 4820,
    },
  ];

  let escritas = 0;
  for (const linea of lineas) {
    const resultado = await prisma.monitoringBaseline.upsert({
      where: {
        artifactVersionId_variableCode: { artifactVersionId, variableCode: linea.variable },
      },
      create: {
        tenantId: TENANT_ID,
        artifactVersionId,
        variableCode: linea.variable,
        bucketsJson: { edges: linea.bordes, frequencies: linea.frecuencias },
        sampleSize: linea.muestra,
        capturedAt,
        capturedBy: AUDIT_CAST.vigilancia,
      },
      // Recapturar NO puede pisar la referencia original: dejaría de ser la población
      // contra la que se validó el modelo, que es lo único que la hace significar algo.
      update: {},
      select: { id: true },
    });
    if (resultado) escritas += 1;
  }
  return escritas;
}

/**
 * Cuatro semanas de vigilancia con su umbral y su veredicto.
 *
 * Ojo a la DIRECCIÓN del umbral, que es el error fácil de este módulo: en PSI lo malo es un
 * valor ALTO; en impacto adverso, AUC y cobertura lo malo es un valor BAJO. Las filas de
 * aquí abajo lo respetan, y por eso el `BREACH` de estabilidad y el `WATCH` de impacto
 * adverso se pintan del mismo lado del umbral y en direcciones contrarias.
 */
async function sembrarMediciones(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  ahora: number,
): Promise<number> {
  interface Medicion {
    metrica: string;
    ambito: string;
    valor: number;
    umbral: number;
    veredicto: 'OK' | 'WATCH' | 'BREACH';
    muestra: number;
    diasAtras: number;
    detalle?: Prisma.InputJsonValue;
  }

  const semanas = [28, 21, 14, 7];
  const mediciones: Medicion[] = [];

  // La estabilidad de población se DEGRADA a lo largo del mes: es la serie que explica
  // cuándo empezó a torcerse, y una sola foto no puede contarla.
  const psi = [0.062, 0.084, 0.121, 0.187];
  semanas.forEach((diasAtras, indice) => {
    const valor = psi[indice];
    mediciones.push({
      metrica: 'PSI',
      ambito: 'bureau_score',
      valor,
      umbral: 0.1,
      veredicto: valor >= 0.15 ? 'BREACH' : valor >= 0.1 ? 'WATCH' : 'OK',
      muestra: 1180,
      diasAtras,
      detalle: { comparadoContra: 'línea base congelada al promover 2.3.0' },
    });
  });

  semanas.forEach((diasAtras, indice) => {
    mediciones.push(
      {
        metrica: 'BAD_RATE',
        ambito: '-',
        valor: [0.071, 0.078, 0.083, 0.091][indice],
        umbral: 0.12,
        veredicto: 'OK',
        muestra: 640,
        diasAtras,
      },
      {
        metrica: 'APPROVAL_RATE',
        ambito: '-',
        valor: [0.612, 0.598, 0.571, 0.549][indice],
        umbral: 0.45,
        veredicto: 'OK',
        muestra: 1180,
        diasAtras,
      },
      {
        // Cociente de tasas de aprobación entre el grupo bajo examen y el de referencia.
        // Por debajo de 0,8 (la regla de los cuatro quintos) hay que mirarlo de verdad.
        metrica: 'ADVERSE_IMPACT_RATIO',
        ambito: 'AGE_BAND:18-25',
        valor: [0.874, 0.851, 0.822, 0.793][indice],
        umbral: 0.8,
        veredicto: indice === 3 ? 'WATCH' : 'OK',
        muestra: 214,
        diasAtras,
        detalle: { grupoReferencia: 'AGE_BAND:36-50' },
      },
      {
        metrica: 'OUTCOME_COVERAGE',
        ambito: '-',
        valor: [0.68, 0.66, 0.63, 0.61][indice],
        umbral: 0.6,
        veredicto: 'OK',
        muestra: 24,
        diasAtras,
        detalle: { nota: 'Muestra pequeña: el veredicto no es una noticia por sí solo.' },
      },
      {
        // La métrica que vigila a la vigilancia. Es la única fila que puede existir sobre
        // una versión sin datos, y por eso se emite siempre.
        metrica: 'MONITORING_FRESHNESS_HOURS',
        ambito: '-',
        valor: 6,
        umbral: 48,
        veredicto: 'OK',
        muestra: 1,
        diasAtras,
      },
    );
  });

  let escritas = 0;
  for (const medicion of mediciones) {
    // Sellada a MEDIANOCHE, no a la hora de la corrida. `monitoring_evaluation` no tiene
    // clave única —a propósito: es una serie temporal y dos mediciones del mismo día son
    // legítimas—, así que la idempotencia depende de que la fecha sea estable. Con la hora
    // dentro, cada nueva siembra escribía la misma semana otra vez unos minutos más tarde y
    // la gráfica de estabilidad salía con los puntos duplicados: no un dato falso, pero sí
    // una serie que dice haber medido el doble de veces de las que se midió.
    const evaluatedAt = aMedianoche(ahora - medicion.diasAtras * DIA_MS);
    const existente = await prisma.monitoringEvaluation.findFirst({
      where: {
        tenantId: TENANT_ID,
        artifactVersionId,
        metricCode: medicion.metrica,
        scope: medicion.ambito,
        evaluatedAt,
      },
      select: { id: true },
    });
    if (existente) continue;
    await prisma.monitoringEvaluation.create({
      data: {
        tenantId: TENANT_ID,
        artifactVersionId,
        metricCode: medicion.metrica,
        scope: medicion.ambito,
        value: new Prisma.Decimal(medicion.valor),
        threshold: new Prisma.Decimal(medicion.umbral),
        verdict: medicion.veredicto,
        sampleSize: medicion.muestra,
        detailsJson: medicion.detalle ?? Prisma.DbNull,
        evaluatedAt,
      },
    });
    escritas += 1;
  }
  return escritas;
}

/**
 * La curva de calibración a 180 días, deliberadamente OPTIMISTA en los deciles altos.
 *
 * Una PD sin calibrar ordena igual de bien —el decil 10 sigue siendo peor que el 1— y su
 * nivel no significa nada. Con estos números el modelo predice 24 % de mora en el decil más
 * arriesgado y se observa 31 %: el orden es perfecto y el precio calculado con esa PD se
 * queda corto. Es el error que sólo se ve mirando la curva, no el poder de discriminación.
 */
async function sembrarCalibracion(
  prisma: PrismaClient,
  artifactVersionId: bigint,
  ahora: number,
): Promise<number> {
  const predichas = [0.008, 0.016, 0.027, 0.041, 0.058, 0.079, 0.108, 0.148, 0.19, 0.24];
  const observadas = [0.006, 0.014, 0.029, 0.038, 0.061, 0.088, 0.126, 0.181, 0.242, 0.312];
  const muestras = [96, 94, 95, 93, 92, 90, 88, 85, 81, 74];
  const computedAt = new Date(ahora - 7 * DIA_MS);

  let escritos = 0;
  for (let indice = 0; indice < predichas.length; indice += 1) {
    await prisma.calibrationBucket.upsert({
      where: {
        artifactVersionId_windowDays_decile: {
          artifactVersionId,
          windowDays: 180,
          decile: indice + 1,
        },
      },
      create: {
        tenantId: TENANT_ID,
        artifactVersionId,
        windowDays: 180,
        decile: indice + 1,
        predictedRate: new Prisma.Decimal(predichas[indice]),
        observedRate: new Prisma.Decimal(observadas[indice]),
        sampleSize: muestras[indice],
        computedAt,
      },
      update: {},
    });
    escritos += 1;
  }
  return escritos;
}

/** Doce meses de estado de cartera: el contexto que la decisión no tenía. */
async function sembrarEstadoCartera(prisma: PrismaClient, ahora: number): Promise<number> {
  const series: Array<{ metrica: string; segmento: string; valores: number[] }> = [
    {
      metrica: 'TOTAL_EXPOSURE',
      segmento: '',
      valores: [1_820_000, 1_940_000, 2_110_000, 2_265_000, 2_390_000, 2_512_000],
    },
    {
      metrica: 'TOTAL_EXPOSURE',
      segmento: 'SANTA_CRUZ',
      valores: [742_000, 803_000, 881_000, 946_000, 1_002_000, 1_058_000],
    },
    {
      metrica: 'TOTAL_EXPOSURE',
      segmento: 'ORURO',
      valores: [96_000, 108_000, 124_000, 141_000, 158_000, 172_000],
    },
    { metrica: 'PAR30', segmento: '', valores: [0.038, 0.041, 0.047, 0.052, 0.058, 0.063] },
    {
      metrica: 'ORIGINATION_BUDGET',
      segmento: '',
      valores: [400_000, 400_000, 450_000, 450_000, 450_000, 500_000],
    },
    {
      metrica: 'LIQUIDITY',
      segmento: '',
      valores: [1_120_000, 1_080_000, 990_000, 1_240_000, 1_190_000, 1_310_000],
    },
  ];

  let escritos = 0;
  for (const serie of series) {
    for (let mes = 0; mes < serie.valores.length; mes += 1) {
      // El estado de cartera es de un DÍA, no de un instante.
      const asOf = aMedianoche(ahora - (serie.valores.length - 1 - mes) * 30 * DIA_MS);
      await prisma.portfolioState.upsert({
        where: {
          tenantId_asOf_metricCode_segment: {
            tenantId: TENANT_ID,
            asOf,
            metricCode: serie.metrica,
            segment: serie.segmento,
          },
        },
        create: {
          tenantId: TENANT_ID,
          asOf,
          metricCode: serie.metrica,
          segment: serie.segmento,
          value: new Prisma.Decimal(serie.valores[mes]),
          recordedBy: AUDIT_CAST.riesgoOps,
        },
        update: {},
      });
      escritos += 1;
    }
  }
  return escritos;
}

/**
 * Cuatro límites, y sólo DOS bloquean.
 *
 * La distinción no es decorativa: un límite que sólo mide es un número guardado, y verlo
 * igual que uno que rechaza hace creer que la cartera está protegida cuando no lo está. Es
 * también la forma legítima de estrenar un límite —medir un mes antes de imponerlo— así que
 * el estado «no bloquea» tiene que ser visible y no un descuido.
 */
async function sembrarLimites(prisma: PrismaClient): Promise<number> {
  const limites = [
    {
      codigo: 'SUBJECT_TOTAL',
      segmento: '',
      maximo: 25_000,
      bloquea: true,
      nota: 'Exposición máxima por solicitante en toda la cartera.',
    },
    {
      codigo: 'SEGMENT_CONCENTRATION',
      segmento: 'SANTA_CRUZ',
      maximo: 1_200_000,
      bloquea: true,
      nota: 'Techo de concentración de la regional con más cartera.',
    },
    {
      codigo: 'SEGMENT_CONCENTRATION',
      segmento: 'ORURO',
      maximo: 200_000,
      bloquea: false,
      nota: 'En observación: se mide desde este mes y todavía no rechaza.',
    },
    {
      codigo: 'PERIOD_ORIGINATION_BUDGET',
      segmento: '',
      maximo: 500_000,
      bloquea: false,
      nota: 'Presupuesto mensual de originación; avisa al superarse.',
    },
  ];

  let escritos = 0;
  for (const limite of limites) {
    await prisma.exposureLimit.upsert({
      where: {
        tenantId_limitCode_segment: {
          tenantId: TENANT_ID,
          limitCode: limite.codigo,
          segment: limite.segmento,
        },
      },
      create: {
        tenantId: TENANT_ID,
        limitCode: limite.codigo,
        segment: limite.segmento,
        maxValue: new Prisma.Decimal(limite.maximo),
        currencyCode: 'BOB',
        enforced: limite.bloquea,
        isActive: true,
        createdBy: AUDIT_CAST.aprobador,
      },
      update: {},
    });
    escritos += 1;
  }
  return escritos;
}

/**
 * Licitud VIGENTE por finalidad y por persona, que es distinto de la base legal de la
 * versión del artefacto. Las dos son necesarias y ninguna sustituye a la otra: decidir con
 * un dato cuyo permiso venció es una infracción aunque el artefacto declare su amparo.
 *
 * Se siembra a los primeros sujetos de la cartera —uno vencido y uno revocado incluidos—
 * porque un panel donde todo está vigente no enseña la única lectura que importa.
 */
async function sembrarConsentimientos(prisma: PrismaClient, ahora: number): Promise<number> {
  const sujetos = await prisma.decisionSubject.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: { id: 'asc' },
    take: 8,
    select: { id: true },
  });
  if (!sujetos.length) return 0;

  const finalidades = [
    { proposito: 'BUREAU_QUERY', base: 'CREDIT_PROTECTION' as const, mesesVigencia: 24 },
    { proposito: 'BANK_STATEMENT_ANALYSIS', base: 'CONSENT' as const, mesesVigencia: 12 },
    { proposito: 'BIOMETRIC_VERIFICATION', base: 'CONSENT' as const, mesesVigencia: 6 },
  ];

  let escritos = 0;
  for (const [indice, sujeto] of sujetos.entries()) {
    for (const finalidad of finalidades) {
      const grantedAt = new Date(ahora - 400 * DIA_MS + indice * 12 * DIA_MS);
      const expiresAt = new Date(grantedAt.getTime() + finalidad.mesesVigencia * 30 * DIA_MS);
      // El tercer sujeto revoca su consentimiento biométrico. Es el caso que obliga a la
      // pantalla a distinguir «venció» de «lo retiró», que no son lo mismo ni ante un juez.
      const revokedAt =
        indice === 2 && finalidad.proposito === 'BIOMETRIC_VERIFICATION'
          ? new Date(ahora - 60 * DIA_MS)
          : null;
      await prisma.subjectConsent.upsert({
        where: {
          tenantId_subjectId_purpose: {
            tenantId: TENANT_ID,
            subjectId: sujeto.id,
            purpose: finalidad.proposito,
          },
        },
        create: {
          tenantId: TENANT_ID,
          subjectId: sujeto.id,
          purpose: finalidad.proposito,
          basis: finalidad.base,
          grantedAt,
          expiresAt,
          revokedAt,
          evidenceRef: `expediente/${finalidad.proposito.toLowerCase()}/${sujeto.id}`,
          recordedBy: AUDIT_CAST.cumplimiento,
        },
        update: {},
      });
      escritos += 1;
    }
  }
  return escritos;
}

/**
 * Tres reidentificaciones en los tres estados que importan: una pedida y sin decidir, una
 * aprobada y ya consumida, y una rechazada.
 *
 * Quien aprueba nunca es quien pide — lo comprueba el servicio, y aquí se respeta para que
 * la pantalla no enseñe un caso que el motor rechazaría.
 */
async function sembrarReidentificaciones(prisma: PrismaClient, ahora: number): Promise<number> {
  const sujetos = await prisma.decisionSubject.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: { id: 'asc' },
    take: 3,
    select: { id: true },
  });
  if (sujetos.length < 3) return 0;

  const yaHay = await prisma.reidentificationRequest.count({ where: { tenantId: TENANT_ID } });
  if (yaHay > 0) return 0;

  const casos = [
    {
      sujeto: sujetos[0].id,
      proposito:
        'Reclamo formal ante la ASFI por una negativa de crédito; hay que identificar al ' +
        'solicitante para poder responder por escrito dentro del plazo legal.',
      estado: 'CONSUMED' as const,
      diasAtras: 40,
      decidido: true,
    },
    {
      sujeto: sujetos[1].id,
      proposito:
        'Sospecha de suplantación en tres solicitudes con el mismo dispositivo; ' +
        'cumplimiento pide identificar al titular para contactarlo.',
      estado: 'REQUESTED' as const,
      diasAtras: 4,
      decidido: false,
    },
    {
      sujeto: sujetos[2].id,
      proposito: 'Consulta comercial para una campaña de recompra.',
      estado: 'REJECTED' as const,
      diasAtras: 18,
      decidido: true,
    },
  ];

  for (const caso of casos) {
    const requestedAt = new Date(ahora - caso.diasAtras * DIA_MS);
    await prisma.reidentificationRequest.create({
      data: {
        tenantId: TENANT_ID,
        subjectId: caso.sujeto,
        purpose: caso.proposito,
        status: caso.estado,
        requestedBy: AUDIT_CAST.cumplimiento,
        requestedAt,
        decidedBy: caso.decidido ? AUDIT_CAST.aprobador : null,
        decidedAt: caso.decidido ? new Date(requestedAt.getTime() + DIA_MS) : null,
        consumedAt:
          caso.estado === 'CONSUMED' ? new Date(requestedAt.getTime() + 2 * DIA_MS) : null,
      },
    });
  }
  return casos.length;
}

/**
 * Cinco solicitudes de titular, una de cada tipo y una todavía sin atender.
 *
 * La de ERASURE se resuelve dejando escrito lo que NO se borró: la cadena de auditoría es
 * append-only y se conserva por obligación legal. Una solicitud de eliminación marcada
 * «cumplida» sin esa constancia deja al operador creyendo que borró algo que sigue ahí —y
 * es correcto que siga ahí—.
 */
async function sembrarSolicitudesTitular(prisma: PrismaClient, ahora: number): Promise<number> {
  const sujetos = await prisma.decisionSubject.findMany({
    where: { tenantId: TENANT_ID },
    orderBy: { id: 'asc' },
    take: 5,
    select: { subjectReferenceHash: true },
  });
  if (!sujetos.length) return 0;

  const yaHay = await prisma.decisionDataSubjectRequest.count({ where: { tenantId: TENANT_ID } });
  if (yaHay > 0) return 0;

  const solicitudes = [
    {
      tipo: 'ACCESS' as const,
      estado: 'FULFILLED' as const,
      diasAtras: 52,
      referencia: 'TCK-2026-0417',
      resolucion: { entregado: ['decisiones', 'motivos', 'variables de entrada'], formato: 'PDF' },
    },
    {
      tipo: 'PORTABILITY' as const,
      estado: 'FULFILLED' as const,
      diasAtras: 34,
      referencia: 'TCK-2026-0503',
      resolucion: { entregado: ['decisiones', 'créditos'], formato: 'JSON' },
    },
    {
      tipo: 'REVIEW' as const,
      estado: 'FULFILLED' as const,
      diasAtras: 21,
      referencia: 'TCK-2026-0551',
      resolucion: { revisadoPor: AUDIT_CAST.operaciones, resultado: 'Se mantiene la decisión.' },
    },
    {
      tipo: 'ERASURE' as const,
      estado: 'REJECTED' as const,
      diasAtras: 12,
      referencia: 'TCK-2026-0588',
      resolucion: {
        motivo: 'CONSERVACION_LEGAL',
        detalle:
          'La bitácora de auditoría es append-only y se conserva por obligación legal ' +
          '(LGPD art. 16 I). Se eliminaron los datos de contacto; la evidencia de las ' +
          'decisiones permanece seudonimizada.',
      },
    },
    {
      tipo: 'ACCESS' as const,
      estado: 'RECEIVED' as const,
      diasAtras: 3,
      referencia: 'TCK-2026-0602',
      resolucion: null,
    },
  ];

  for (const [indice, solicitud] of solicitudes.entries()) {
    const createdAt = new Date(ahora - solicitud.diasAtras * DIA_MS);
    await prisma.decisionDataSubjectRequest.create({
      data: {
        tenantId: TENANT_ID,
        subjectReferenceHash: sujetos[indice % sujetos.length].subjectReferenceHash,
        requestType: solicitud.tipo,
        status: solicitud.estado,
        receivedBy: AUDIT_CAST.cumplimiento,
        reference: solicitud.referencia,
        resolutionJson: solicitud.resolucion ?? Prisma.DbNull,
        createdAt,
        resolvedAt: solicitud.resolucion ? new Date(createdAt.getTime() + 3 * DIA_MS) : null,
      },
    });
  }
  return solicitudes.length;
}

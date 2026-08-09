import { DomainException } from '../src/common/errors/domain-exception';
import { MetricsService } from '../src/common/observability/metrics.service';
import { ModelMonitoringService } from '../src/modules/model-monitoring/model-monitoring.service';
import type { AuditService } from '../src/common/audit/audit.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type {
  AdverseImpactQueryDto,
  MonitoringWindowQueryDto,
  RecordMonitoringAttributeBatchDto,
  RecordOutcomeBatchDto,
} from '../src/modules/model-monitoring/model-monitoring.dto';

/**
 * El servicio de monitoreo, por lo que rodea a la aritmética.
 *
 * El cálculo se verifica aparte (`monitoring-analytics.spec.ts`). Aquí importan tres cosas que
 * no son números:
 *
 *  1. **Vínculo coherente con el tenant.** La RLS comprueba la COLUMNA `tenant_id`, no que la
 *     ejecución referida sea nuestra. Sin la comprobación explícita, alguien podría cargar
 *     desenlaces con su propio tenant apuntando a decisiones ajenas y contaminar el análisis
 *     de otro cliente.
 *  2. **El motor no toca el atributo de sesgo.** Se escribe por su propio camino y solo lo lee
 *     el análisis; esa separación es lo que hace lícito el autoexamen.
 *  3. **La auditoría no guarda la composición demográfica.** Registra los nombres de atributo,
 *     nunca los valores: es un registro append-only y ahí no cabe rectificar.
 */
describe('ModelMonitoringService', () => {
  const TENANT = 7n;
  const principal = { id: 'riesgo', requestId: 'req-1' } as AuthenticatedPrincipal;
  const metrics = new MetricsService();

  function make(options: {
    executionsFound?: number;
    versionFound?: boolean;
    executions?: unknown[];
  }) {
    const audited: Array<Record<string, unknown>> = [];
    const upserts: Array<Record<string, unknown>> = [];
    const audit = {
      append: (input: Record<string, unknown>) => {
        audited.push(input);
        return Promise.resolve({});
      },
    } as unknown as AuditService;
    const tx = {
      decisionOutcomeObservation: {
        upsert: (args: { create: Record<string, unknown> }) => {
          upserts.push(args.create);
          return Promise.resolve({ id: 1n });
        },
      },
      decisionMonitoringAttribute: {
        upsert: (args: { create: Record<string, unknown> }) => {
          upserts.push(args.create);
          return Promise.resolve({ id: 1n });
        },
      },
    };
    const prisma = {
      decisionExecution: {
        // Por defecto responde «todas las pedidas existen», contando los ids del propio
        // filtro. Fijar un número aquí haría que el caso feliz fallara al crecer el lote.
        count: (args: { where: { id: { in: bigint[] } } }) =>
          Promise.resolve(options.executionsFound ?? args.where.id.in.length),
        findMany: () => Promise.resolve(options.executions ?? []),
      },
      decisionArtifactVersion: {
        findFirst: () => Promise.resolve(options.versionFound === false ? null : { id: 4001n }),
      },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    } as unknown as PrismaService;
    return {
      service: new ModelMonitoringService(prisma, audit, metrics),
      audited,
      upserts,
    };
  }

  const outcomes = (count: number): RecordOutcomeBatchDto => ({
    observations: Array.from({ length: count }, (_, i) => ({
      executionId: String(100 + i),
      windowDays: 90,
      label: 'GOOD' as const,
      source: 'COLLECTIONS_SYSTEM',
    })),
  });

  const attributes: RecordMonitoringAttributeBatchDto = {
    attributes: [{ executionId: '100', attribute: 'AGE_BAND', groupValue: '60+' }],
  };

  describe('carga de desenlaces', () => {
    it('registra el lote y deja evidencia en la misma transacción', async () => {
      const { service, audited, upserts } = make({});
      const result = await service.recordOutcomes(TENANT, outcomes(3), principal);
      expect(result.recorded).toBe(3);
      expect(upserts).toHaveLength(3);
      expect(upserts[0]).toMatchObject({ tenantId: TENANT, recordedBy: 'riesgo' });
      expect(audited[0].eventType).toBe('MODEL_OUTCOMES_RECORDED');
    });

    it('rechaza desenlaces sobre ejecuciones que no son de este tenant', async () => {
      // La RLS comprueba la columna, no la coherencia del vínculo: sin esto se podría
      // contaminar el análisis de otro cliente con desenlaces inventados.
      const { service, upserts } = make({ executionsFound: 0 });
      const error = await service
        .recordOutcomes(TENANT, outcomes(1), principal)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('EXECUTION_NOT_FOUND');
      expect(upserts).toEqual([]);
    });

    it('rechaza un lote vacío y uno desmesurado', async () => {
      const { service } = make({});
      const vacio = await service
        .recordOutcomes(TENANT, { observations: [] }, principal)
        .catch((caught: unknown) => caught);
      expect((vacio as DomainException).code).toBe('MONITORING_BATCH_EMPTY');

      const enorme = await service
        .recordOutcomes(TENANT, outcomes(1_001), principal)
        .catch((caught: unknown) => caught);
      // Un lote sin techo mantiene abierta una transacción tanto como quiera el llamante.
      expect((enorme as DomainException).code).toBe('MONITORING_BATCH_TOO_LARGE');
    });
  });

  describe('atributos solo-monitoreo', () => {
    it('se registran con su grupo, para poder medir sesgo', async () => {
      const { service, upserts } = make({});
      await service.recordAttributes(TENANT, attributes, principal);
      expect(upserts[0]).toMatchObject({ attribute: 'AGE_BAND', groupValue: '60+' });
    });

    it('la auditoría guarda el NOMBRE del atributo, nunca el valor del grupo', async () => {
      const { service, audited } = make({});
      await service.recordAttributes(TENANT, attributes, principal);
      const payload = audited[0].payload as Record<string, unknown>;
      expect(payload.attributes).toEqual(['AGE_BAND']);
      // La cadena de auditoría es append-only: la composición demográfica de una cartera no
      // puede quedar ahí, porque después no hay forma de rectificarla.
      expect(JSON.stringify(payload)).not.toContain('60+');
    });

    it('también exige que la ejecución sea del tenant', async () => {
      const { service } = make({ executionsFound: 0 });
      const error = await service
        .recordAttributes(TENANT, attributes, principal)
        .catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('EXECUTION_NOT_FOUND');
    });
  });

  describe('análisis', () => {
    const query = { artifactVersionId: '4001' } as MonitoringWindowQueryDto;

    it('no analiza una versión de otro tenant', async () => {
      const { service } = make({ versionFound: false });
      const error = await service.performance(TENANT, query).catch((caught: unknown) => caught);
      expect((error as DomainException).code).toBe('VERSION_NOT_FOUND');
    });

    it('el desempeño toma la observación de mayor ventana de cada ejecución', async () => {
      // Un caso observado a 30 y a 180 días cuenta UNA vez, con el desenlace más maduro.
      const { service } = make({
        executions: [
          {
            businessOutcome: 'APPROVED',
            outputJson: { score: 700 },
            outcomeObservations: [{ label: 'BAD' }],
          },
          {
            businessOutcome: 'APPROVED',
            outputJson: { score: 800 },
            outcomeObservations: [{ label: 'GOOD' }],
          },
        ],
      });
      const report = await service.performance(TENANT, query);
      expect(report.approved).toBe(2);
      expect(report.badRate).toBeCloseTo(0.5);
    });

    it('un artefacto sin puntaje publicado no impide el resto del informe', async () => {
      const { service } = make({
        executions: [
          { businessOutcome: 'APPROVED', outputJson: {}, outcomeObservations: [{ label: 'GOOD' }] },
        ],
      });
      const report = await service.performance(TENANT, query);
      expect(report.discrimination).toBeNull();
      expect(report.goodRate).toBe(1);
    });

    it('el impacto adverso agrupa por el valor del atributo y usa el resultado real', async () => {
      const rows = [
        ...Array.from({ length: 40 }, () => ({
          businessOutcome: 'APPROVED',
          monitoringAttributes: [{ groupValue: 'A' }],
        })),
        ...Array.from({ length: 20 }, () => ({
          businessOutcome: 'APPROVED',
          monitoringAttributes: [{ groupValue: 'B' }],
        })),
        ...Array.from({ length: 20 }, () => ({
          businessOutcome: 'DECLINED',
          monitoringAttributes: [{ groupValue: 'B' }],
        })),
      ];
      const { service } = make({ executions: rows });
      const report = await service.adverseImpact(TENANT, {
        artifactVersionId: '4001',
        attribute: 'AGE_BAND',
      } as AdverseImpactQueryDto);

      expect(report.analyzed).toBe(80);
      expect(report.referenceGroup).toBe('A');
      // B aprueba al 50% frente al 100% de A: razón 0.5, por debajo del umbral.
      expect(report.groups.find((g) => g.group === 'B')?.impactRatio).toBeCloseTo(0.5);
      expect(report.flagged).toBe(true);
    });
  });
});

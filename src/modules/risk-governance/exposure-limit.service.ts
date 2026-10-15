import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { checkLimit } from './exposure-rules';
import type { RecordPortfolioStateDto, UpsertExposureLimitDto } from './risk-governance.dto';

/** Apetito de cartera: los límites de exposición, el estado del negocio y el consumo de hoy. */
@Injectable()
export class ExposureLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async upsertLimit(
    tenantId: bigint,
    dto: UpsertExposureLimitDto,
    principal: AuthenticatedPrincipal,
  ) {
    const segment = dto.segment?.trim() ?? '';
    const limit = await this.prisma.exposureLimit.upsert({
      where: { tenantId_limitCode_segment: { tenantId, limitCode: dto.limitCode, segment } },
      create: {
        tenantId,
        limitCode: dto.limitCode,
        segment,
        maxValue: new Prisma.Decimal(dto.maxValue),
        currencyCode: dto.currencyCode.toUpperCase(),
        enforced: dto.enforced ?? false,
        createdBy: principal.id,
      },
      update: {
        maxValue: new Prisma.Decimal(dto.maxValue),
        currencyCode: dto.currencyCode.toUpperCase(),
        enforced: dto.enforced ?? false,
      },
    });
    await this.audit.append({
      tenantId,
      eventType: 'EXPOSURE_LIMIT_UPSERTED',
      aggregateType: 'ExposureLimit',
      aggregateId: limit.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {
        limitCode: dto.limitCode,
        segment,
        maxValue: dto.maxValue,
        enforced: limit.enforced,
      },
    });
    return this.serializeLimit(limit);
  }

  async listLimits(tenantId: bigint) {
    const limits = await this.prisma.exposureLimit.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ limitCode: 'asc' }, { segment: 'asc' }],
    });
    const states = await this.latestPortfolioState(tenantId);

    return {
      items: limits.map((limit) => {
        const currentValue = states.get(this.stateKey(limit.limitCode, limit.segment)) ?? 0;
        // `requestedValue: 0` porque aquí no se está decidiendo nada: se enseña el consumo de
        // hoy. La proyección con la operación encima la hace el camino de decisión.
        const verdict = checkLimit({
          limitCode: limit.limitCode,
          segment: limit.segment,
          maxValue: Number(limit.maxValue),
          enforced: limit.enforced,
          currentValue,
          requestedValue: 0,
        });
        return { ...this.serializeLimit(limit), currentValue, ...verdict };
      }),
    };
  }

  async recordPortfolioState(
    tenantId: bigint,
    dto: RecordPortfolioStateDto,
    principal: AuthenticatedPrincipal,
  ) {
    const segment = dto.segment?.trim() ?? '';
    const asOf = new Date(dto.asOf);
    const state = await this.prisma.portfolioState.upsert({
      where: {
        tenantId_asOf_metricCode_segment: { tenantId, asOf, metricCode: dto.metricCode, segment },
      },
      create: {
        tenantId,
        asOf,
        metricCode: dto.metricCode,
        segment,
        value: new Prisma.Decimal(dto.value),
        recordedBy: principal.id,
      },
      update: { value: new Prisma.Decimal(dto.value), recordedBy: principal.id },
    });
    return { id: state.id.toString(), asOf: state.asOf.toISOString(), value: Number(state.value) };
  }

  /** El valor más reciente de cada métrica y segmento. Es contra lo que se mide el apetito. */
  private async latestPortfolioState(tenantId: bigint): Promise<Map<string, number>> {
    // Dentro de `$transaction` para que se fije el GUC `app.tenant_id`: una consulta cruda
    // suelta contra una tabla con RLS forzada aborta con 22P02 (`''::bigint`) en cuanto le
    // toca una conexión del pool que ya sirvió a un tenant. Explicado en `tenant-rls.ts`.
    const rows = await this.prisma.$transaction(
      (tx) =>
        tx.$queryRaw<Array<{ metric_code: string; segment: string; value: Prisma.Decimal }>>`
          SELECT DISTINCT ON ("metric_code", "segment")
            "metric_code", "segment", "value"
          FROM "portfolio_state"
          WHERE "tenant_id" = ${tenantId}
          ORDER BY "metric_code", "segment", "as_of" DESC
        `,
    );
    return new Map(
      rows.map((row) => [this.stateKey(row.metric_code, row.segment), Number(row.value)]),
    );
  }

  private stateKey(code: string, segment: string): string {
    return `${code}::${segment}`;
  }

  private serializeLimit(limit: {
    id: bigint;
    limitCode: string;
    segment: string;
    maxValue: Prisma.Decimal;
    currencyCode: string;
    enforced: boolean;
  }) {
    return {
      id: limit.id.toString(),
      limitCode: limit.limitCode,
      segment: limit.segment,
      maxValue: Number(limit.maxValue),
      currencyCode: limit.currencyCode,
      enforced: limit.enforced,
    };
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { SEMANTIC_WORKER_CONFIG, TENANT_BUDGET_REPOSITORY, TenantBudgetRepository } from './ports';
import { SemanticWorkerConfig } from '../config/semantic-worker.config';
import { TracingService } from '../../../../../common/observability/tracing.service';
import {
  APP_ATTRIBUTES,
  SEMANTIC_ATTRIBUTES,
  SPAN_NAMES,
} from '../observability/telemetry.constants';

export type BudgetDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * Acota el gasto en el proveedor por tenant y ventana temporal.
 *
 * Sin este límite, un pico de tráfico o un bucle de reintentos en una integración mal configurada
 * se traduce directamente en factura. Al agotarse el presupuesto el análisis **no falla**: se
 * degrada a `UNKNOWN` sin invocar al modelo. Fallar habría hecho que la cola reintentara, gastando
 * exactamente lo que el límite pretende evitar.
 *
 * Sólo aplica a solicitudes con tenant. El tráfico global no tiene a quién imputarse y queda fuera
 * del control por diseño; limitarlo corresponde a la concurrencia del worker.
 */
@Injectable()
export class TenantBudgetGuard {
  private readonly logger = new Logger(TenantBudgetGuard.name);

  public constructor(
    @Inject(TENANT_BUDGET_REPOSITORY)
    private readonly repository: TenantBudgetRepository,
    @Inject(SEMANTIC_WORKER_CONFIG)
    private readonly config: SemanticWorkerConfig,
    private readonly tracing: TracingService,
  ) {}

  /**
   * El span explica por qué un análisis se degradó a `UNKNOWN` sin invocar al modelo. Sin él, esa
   * degradación es indistinguible en Jaeger de un análisis que sí llamó al proveedor y no encontró
   * nada, que es un problema completamente distinto.
   */
  public reserve(tenantId?: string): Promise<BudgetDecision> {
    if (!this.isEnabled || tenantId === undefined) {
      // Sin límite configurado no hay decisión que observar: un span aquí sería ruido en cada
      // análisis de todo despliegue que no use presupuestos.
      return Promise.resolve({ allowed: true });
    }
    return this.tracing.runInSpan(
      SPAN_NAMES.budgetReserve,
      {
        [APP_ATTRIBUTES.module]: 'tenant-budget',
        [APP_ATTRIBUTES.operation]: 'reserve',
        [APP_ATTRIBUTES.tenantId]: tenantId,
      },
      async (span) => {
        const decision = await this.consume(tenantId);
        span.setAttribute(SEMANTIC_ATTRIBUTES.budgetAllowed, decision.allowed);
        return decision;
      },
    );
  }

  private async consume(tenantId: string): Promise<BudgetDecision> {
    const consumed = await this.repository.tryConsume(
      tenantId,
      this.config.tenantBudgetWindowSeconds,
      this.config.tenantMaxAnalysesPerWindow,
    );
    if (consumed) {
      return { allowed: true };
    }

    this.logger.warn(
      `El tenant ${tenantId} agotó su presupuesto de ${String(this.config.tenantMaxAnalysesPerWindow)} análisis por ventana de ${String(this.config.tenantBudgetWindowSeconds)} s.`,
    );
    return { allowed: false, reason: 'TENANT_BUDGET_EXHAUSTED' };
  }

  /** Contabiliza el consumo real de llamadas al proveedor para poder auditar el coste. */
  public async recordProviderCalls(tenantId: string | undefined, calls: number): Promise<void> {
    if (!this.isEnabled || tenantId === undefined) {
      return;
    }
    await this.repository.recordProviderCalls(
      tenantId,
      this.config.tenantBudgetWindowSeconds,
      calls,
    );
  }

  public get isEnabled(): boolean {
    return this.config.tenantMaxAnalysesPerWindow > 0;
  }
}

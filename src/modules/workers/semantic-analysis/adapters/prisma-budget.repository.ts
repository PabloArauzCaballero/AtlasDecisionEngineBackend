import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  AuditRetentionRepository,
  RetentionOutcome,
  TenantBudgetRepository,
  TenantBudgetUsage,
} from '../core/application/ports';

/**
 * Presupuesto por tenant y retención de la auditoría, sobre Prisma.
 *
 * El presupuesto existe para que un tenant no pueda gastar la cuota del
 * proveedor de modelos sin límite. Vive en la base de datos y no en memoria
 * porque el límite debe respetarse entre **todas** las réplicas del worker: un
 * contador por proceso se multiplica por el número de réplicas, que es
 * exactamente no tener límite.
 */
@Injectable()
export class PrismaTenantBudgetRepository implements TenantBudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserva una unidad de consumo, o dice que no queda.
   *
   * Es **una sola sentencia**, y esa es toda la gracia. Leer el contador,
   * compararlo y escribirlo por separado deja una ventana entre la lectura y la
   * escritura en la que otra réplica hace lo mismo: con el límite al borde, las
   * dos leen «queda una» y las dos la consumen. Aquí el incremento y la
   * comprobación ocurren dentro del mismo `UPDATE`, y quien no cabe simplemente
   * no ve ninguna fila devuelta.
   *
   * El `INSERT … ON CONFLICT` crea la ventana si es la primera del periodo, y
   * se apoya en el índice único `(tenant_id, window_start)`.
   */
  async tryConsume(tenantId: string, windowSeconds: number, maxAnalyses: number): Promise<boolean> {
    const windowStart = this.windowStart(windowSeconds);
    // Sigue siendo UNA sentencia; la transacción de una sola operación no cambia su
    // atomicidad. Está aquí porque `decision_semantic_tenant_budget` tiene RLS FORZADA y
    // `$queryRaw` suelto no fija `app.tenant_id` (ver `outbox-relay.service.ts`): sobre una
    // conexión del pool que ya sirvió a un tenant la política evalúa `''::bigint` y aborta
    // con 22P02 — y aquí eso no degrada un trabajo de fondo, tumba la reserva de
    // presupuesto de un análisis en curso.
    const [rows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<Array<{ analyses: number }>>(Prisma.sql`
      INSERT INTO decision_semantic_tenant_budget (tenant_id, window_start, analyses, provider_calls)
      VALUES (${BigInt(tenantId)}, ${windowStart}, 1, 0)
      ON CONFLICT (tenant_id, window_start) DO UPDATE
        SET analyses = decision_semantic_tenant_budget.analyses + 1
        WHERE decision_semantic_tenant_budget.analyses < ${maxAnalyses}
      RETURNING analyses
    `),
    ]);
    return rows.length > 0;
  }

  async recordProviderCalls(tenantId: string, windowSeconds: number, calls: number): Promise<void> {
    if (calls <= 0) return;
    const windowStart = this.windowStart(windowSeconds);
    // Sin cota: esto CONTABILIZA lo ya gastado, no autoriza gasto. Rechazar
    // aquí no devolvería la llamada al proveedor, sólo perdería su registro.
    // `$transaction` por la RLS forzada de la tabla, igual que en `tryConsume`.
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO decision_semantic_tenant_budget (tenant_id, window_start, analyses, provider_calls)
      VALUES (${BigInt(tenantId)}, ${windowStart}, 0, ${calls})
      ON CONFLICT (tenant_id, window_start) DO UPDATE
        SET provider_calls = decision_semantic_tenant_budget.provider_calls + ${calls}
    `),
    ]);
  }

  async findUsage(tenantId: string, windowSeconds: number): Promise<TenantBudgetUsage | undefined> {
    const row = await this.prisma.semanticTenantBudget.findUnique({
      where: {
        tenantId_windowStart: {
          tenantId: BigInt(tenantId),
          windowStart: this.windowStart(windowSeconds),
        },
      },
    });
    if (!row) return undefined;
    return {
      tenantId,
      windowStart: row.windowStart,
      analyses: row.analyses,
      providerCalls: row.providerCalls,
    };
  }

  /**
   * Inicio de la ventana actual, truncado al múltiplo de `windowSeconds`.
   *
   * Ventanas fijas y no deslizantes: una ventana deslizante exigiría guardar
   * cada análisis por separado para poder restar los que salen, y eso convierte
   * un contador en una tabla de eventos que hay que purgar. Con ventana fija,
   * el peor caso es que un tenant gaste dos presupuestos completos a caballo
   * del corte; es un coste conocido y acotado.
   */
  private windowStart(windowSeconds: number): Date {
    const seconds = Math.max(1, windowSeconds);
    const nowMs = Date.now();
    return new Date(Math.floor(nowMs / (seconds * 1_000)) * seconds * 1_000);
  }
}

/**
 * Retención de la auditoría del worker semántico.
 *
 * Dos plazos distintos a propósito: primero se **minimiza** (el texto se
 * sustituye por su huella, conservando la trazabilidad) y más tarde se
 * **purga**. Guardar el texto analizado indefinidamente sería retener datos que
 * ya no hacen falta; borrarlo todo de golpe perdería la evidencia de que una
 * decisión se tomó.
 */
@Injectable()
export class PrismaAuditRetentionRepository implements AuditRetentionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async purgeOlderThan(days: number): Promise<number> {
    const result = await this.prisma.semanticAnalysisRun.deleteMany({
      where: { finishedAt: { lt: daysAgo(days) } },
    });
    return result.count;
  }

  async minimizeOlderThan(days: number): Promise<number> {
    // `md5` del propio Postgres: la huella se calcula donde está el dato, sin
    // traer a memoria del worker textos que precisamente se quieren dejar de
    // retener. `$transaction` por la RLS forzada de la tabla; ver
    // `outbox-relay.service.ts`.
    const [minimized] = await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_semantic_analysis_run
      SET input_text = 'minimizado:' || md5(input_text)
      WHERE finished_at < ${daysAgo(days)}
        AND input_text NOT LIKE 'minimizado:%'
    `),
    ]);
    return minimized;
  }
}

/** Resultado combinado de una pasada de retención. */
export type { RetentionOutcome };

function daysAgo(days: number): Date {
  return new Date(Date.now() - Math.max(0, days) * 86_400_000);
}

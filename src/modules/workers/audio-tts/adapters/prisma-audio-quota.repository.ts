/**
 * Contabilidad del gasto en locución, sobre Prisma y acotada a UN tenant.
 *
 * Todo lo que aquí decide «cabe / no cabe» se resuelve en UNA sentencia de la
 * base, con el `WHERE` haciendo de guardián. No es preferencia de estilo: leer
 * el contador, decidir en JavaScript y escribir después deja una ventana en la
 * que N peticiones simultáneas ven el mismo presupuesto libre, y el precio de
 * esa ventana es una factura del proveedor por encima del límite que alguien
 * fijó. Por eso la reserva ocurre ANTES de gastar y no después.
 *
 * **Cada sentencia cruda va envuelta en `$transaction`, y no es adorno.**
 * `applyTenantRls` del motor envuelve las operaciones de modelo y `$transaction`,
 * pero un `$executeRaw` suelto cae al cliente base sin fijar `app.tenant_id`; y
 * la política de estas tablas dice `current_setting('app.tenant_id', true) IS
 * NULL OR tenant_id = …::bigint`, así que sobre una conexión del pool que ya
 * sirvió a un tenant el GUC sigue DEFINIDO con cadena vacía —no es NULL— y
 * `''::bigint` revienta con 22P02. Falla o no según qué conexión toque, que es
 * la peor clase de fallo: aquí se vio como una locución que se quedaba «En cola»
 * para siempre mientras la anterior, idéntica, había funcionado. Es la misma
 * trampa que documenta `worker-metrics.service.ts`.
 */
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  AudioQuotaRepositoryPort,
  BudgetSnapshot,
  BudgetWindow,
} from '../core/domain/ports/audio-quota.repository';

export class PrismaAudioQuotaRepository implements AudioQuotaRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: bigint,
  ) {}

  /**
   * Reserva unidades si caben. `false` significa presupuesto agotado, no error.
   *
   * El `UPDATE … WHERE reservado + liquidado + n <= utilizable` es la
   * comprobación y la escritura a la vez: dos peticiones concurrentes se
   * serializan en la fila y la segunda ve el total que dejó la primera.
   */
  async reserveBudget(window: BudgetWindow, units: number, usableUnits: number): Promise<boolean> {
    await this.ensureWindow(window);
    const [updated] = await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_audio_budget_window
      SET reserved_units = reserved_units + ${units}, updated_at = now()
      WHERE tenant_id = ${this.tenantId}
        AND provider = ${window.provider}
        AND month_key = ${window.monthKey}
        AND reserved_units + settled_units + ${units} <= ${usableUnits}
    `),
    ]);
    return updated > 0;
  }

  /**
   * Convierte una reserva en consumo real.
   *
   * El consumo real puede diferir de lo reservado —el proveedor cobra por lo
   * que efectivamente sintetizó—, así que se descuenta lo reservado y se suma
   * lo gastado. `GREATEST(…, 0)` protege el invariante de la tabla frente a una
   * liquidación duplicada que llegue tarde.
   */
  async settleBudget(
    window: BudgetWindow,
    reservedUnits: number,
    actualUnits: number,
  ): Promise<void> {
    await this.ensureWindow(window);
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_audio_budget_window
      SET reserved_units = GREATEST(reserved_units - ${reservedUnits}, 0),
          settled_units = settled_units + ${actualUnits},
          updated_at = now()
      WHERE tenant_id = ${this.tenantId}
        AND provider = ${window.provider}
        AND month_key = ${window.monthKey}
    `),
    ]);
  }

  /** Devuelve unidades reservadas que nunca llegaron a gastarse. */
  async releaseBudget(window: BudgetWindow, units: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_audio_budget_window
      SET reserved_units = GREATEST(reserved_units - ${units}, 0), updated_at = now()
      WHERE tenant_id = ${this.tenantId}
        AND provider = ${window.provider}
        AND month_key = ${window.monthKey}
    `),
    ]);
  }

  async readBudget(window: BudgetWindow): Promise<BudgetSnapshot> {
    const row = await this.prisma.audioBudgetWindow.findFirst({
      where: { tenantId: this.tenantId, provider: window.provider, monthKey: window.monthKey },
      select: { reservedUnits: true, settledUnits: true },
    });
    return { reservedUnits: row?.reservedUnits ?? 0, settledUnits: row?.settledUnits ?? 0 };
  }

  /**
   * Toma una generación del cupo diario del actor. `false` = ya no le quedan.
   *
   * El techo por actor es lo que impide que una sola cuenta —o un formulario
   * pulsado en bucle— agote el presupuesto del mes de toda la organización.
   */
  async claimActorGeneration(actorId: string, dayKey: string, limit: number): Promise<boolean> {
    await this.ensureActorDay(actorId, dayKey);
    const [updated] = await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_audio_actor_generation_daily
      SET generation_count = generation_count + 1
      WHERE tenant_id = ${this.tenantId}
        AND actor_id = ${actorId}
        AND day_key = ${dayKey}
        AND generation_count < ${limit}
    `),
    ]);
    return updated > 0;
  }

  /** Compensa un cupo tomado por una generación que nunca llegó a ocurrir. */
  async releaseActorGeneration(actorId: string, dayKey: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`
      UPDATE decision_audio_actor_generation_daily
      SET generation_count = GREATEST(generation_count - 1, 0)
      WHERE tenant_id = ${this.tenantId} AND actor_id = ${actorId} AND day_key = ${dayKey}
    `),
    ]);
  }

  async actorGenerationCount(actorId: string, dayKey: string): Promise<number> {
    const row = await this.prisma.audioActorGenerationDaily.findFirst({
      where: { tenantId: this.tenantId, actorId, dayKey },
      select: { generationCount: true },
    });
    return row?.generationCount ?? 0;
  }

  /**
   * Registro de consumo por asset. Idempotente por `(tenant, asset)`: liquidar
   * dos veces la misma generación falsearía el mes.
   */
  async recordUsage(
    assetId: string,
    provider: string,
    units: number,
    monthKey: string,
  ): Promise<void> {
    await this.prisma.audioGenerationUsage.upsert({
      where: { tenantId_assetId: { tenantId: this.tenantId, assetId } },
      create: { tenantId: this.tenantId, assetId, provider, usageUnits: units, monthKey },
      update: {},
    });
  }

  /** Barre el contador diario vencido. Es un contador, no una traza: caduca. */
  async purgeActorDailyBefore(dayKey: string): Promise<number> {
    const deleted = await this.prisma.audioActorGenerationDaily.deleteMany({
      where: { tenantId: this.tenantId, dayKey: { lt: dayKey } },
    });
    return deleted.count;
  }

  /** La fila del mes tiene que existir para que el `UPDATE` condicional decida. */
  private async ensureWindow(window: BudgetWindow): Promise<void> {
    await this.prisma.audioBudgetWindow.upsert({
      where: {
        tenantId_provider_monthKey: {
          tenantId: this.tenantId,
          provider: window.provider,
          monthKey: window.monthKey,
        },
      },
      create: { tenantId: this.tenantId, provider: window.provider, monthKey: window.monthKey },
      update: {},
    });
  }

  private async ensureActorDay(actorId: string, dayKey: string): Promise<void> {
    await this.prisma.audioActorGenerationDaily.upsert({
      where: { tenantId_actorId_dayKey: { tenantId: this.tenantId, actorId, dayKey } },
      create: { tenantId: this.tenantId, actorId, dayKey },
      update: {},
    });
  }
}

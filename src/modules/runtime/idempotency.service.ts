import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyStatus, Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { HashService } from '../../common/crypto/hash.service';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** How many times a lost reclaim race may restart the resolution before giving up. */
const MAX_RECLAIM_ATTEMPTS = 2;

/**
 * Result of claiming or replaying an idempotency key.
 *
 * `lease` es el comprobante de propiedad de la reserva. Cada reclamación fija un
 * `leaseExpiresAt` nuevo, así que ese instante identifica a QUIÉN pertenece la fila ahora
 * mismo: quien lo tenga puede cerrarla, y quien traiga uno viejo ya no. Sin ese comprobante,
 * un titular cuya ejecución se pasó del lease volvía a `complete()`/`release()` con el `id` a
 * secas y pisaba —o borraba— la reserva que otra petición había reclamado legítimamente
 * mientras tanto. Sirve como token sin necesidad de una columna nueva porque el lease sólo
 * puede reclamarse DESPUÉS de haber vencido: dos titulares no pueden compartir instante.
 */
export type IdempotencyReservation =
  | { kind: 'reserved'; id: bigint; lease: Date }
  | { kind: 'completed'; response: unknown; status: IdempotencyStatus };

/**
 * Coordinates request idempotency for decision execution.
 *
 * The key is scoped by tenant and artifact, while the request hash protects against
 * replaying the key with different inputs.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlMs: number;
  private readonly leaseMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    config: ConfigService,
    /** Opcional por el mismo motivo que en `AuditService`: varias pruebas lo construyen a mano. */
    private readonly metrics?: MetricsService,
  ) {
    this.ttlMs = (config.get<number>('IDEMPOTENCY_TTL_HOURS') ?? 24) * 60 * 60 * 1_000;
    // Short lease a PROCESSING reservation holds the key for. 60s comfortably exceeds a
    // normal decision (bounded by REQUEST_TIMEOUT_MS, 15s by default) while freeing the key
    // quickly after a crash. Falls back to the default until the key is added to the schema.
    this.leaseMs = (config.get<number>('IDEMPOTENCY_LEASE_SECONDS') ?? 60) * 1_000;
  }

  /**
   * Claims a key for processing or returns the persisted terminal response.
   *
   * @throws DomainException when the key is still processing or was reused with a
   * different request hash.
   */
  async reserve(
    tenantId: bigint,
    artifactCode: string,
    key: string,
    requestHash: string,
    /**
     * Reclaim attempts already spent. Losing the race to reclaim an expired reservation
     * restarts the resolution from a re-read, and each restart must be bounded: without a
     * ceiling, a key under heavy contention could recurse until the stack gave out, and a
     * stack overflow in the decision path is a far worse outcome than a 409 the caller can
     * retry. Two retries is already generous — every restart means another request won.
     */
    attempt = 0,
  ): Promise<IdempotencyReservation> {
    const now = new Date();
    try {
      const record = await this.prisma.runtimeIdempotency.create({
        data: {
          tenantId,
          artifactCode,
          idempotencyKey: key,
          requestHash,
          leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
          expiresAt: new Date(now.getTime() + this.ttlMs),
        },
      });
      return { kind: 'reserved', id: record.id, lease: record.leaseExpiresAt };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.runtimeIdempotency.findUniqueOrThrow({
        where: {
          tenantId_artifactCode_idempotencyKey: {
            tenantId,
            artifactCode,
            idempotencyKey: key,
          },
        },
      });

      // A reservation is reclaimable when its terminal response TTL lapsed, OR when it is
      // still PROCESSING but its short lease expired — the previous holder crashed and must
      // not keep the key locked for the whole TTL.
      const responseExpired = existing.expiresAt <= now;
      const leaseExpired =
        existing.status === IdempotencyStatus.PROCESSING && existing.leaseExpiresAt <= now;
      if (responseExpired || leaseExpired) {
        // The guard in the WHERE clause makes the reclaim atomic: exactly one concurrent
        // request can flip an expired reservation back to a fresh PROCESSING lease.
        const lease = new Date(now.getTime() + this.leaseMs);
        const renewed = await this.prisma.runtimeIdempotency.updateMany({
          where: {
            id: existing.id,
            OR: [
              { expiresAt: { lte: now } },
              { status: IdempotencyStatus.PROCESSING, leaseExpiresAt: { lte: now } },
            ],
          },
          data: {
            requestHash,
            status: IdempotencyStatus.PROCESSING,
            responseJson: Prisma.DbNull,
            responseHash: null,
            leaseExpiresAt: lease,
            expiresAt: new Date(now.getTime() + this.ttlMs),
          },
        });
        if (renewed.count === 1) return { kind: 'reserved', id: existing.id, lease };
        // Another request won the reclaim; re-read and follow the normal path.
        if (attempt >= MAX_RECLAIM_ATTEMPTS) {
          throw new DomainException(
            'IDEMPOTENCY_CONTENDED',
            'The idempotency key is under contention; retry the request',
            HttpStatus.CONFLICT,
          );
        }
        return this.reserve(tenantId, artifactCode, key, requestHash, attempt + 1);
      }

      // The reservation is live (terminal within TTL, or PROCESSING with a valid lease).
      if (existing.requestHash !== requestHash) {
        throw new DomainException(
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'The idempotency key was already used with a different request payload',
          HttpStatus.CONFLICT,
        );
      }
      if (existing.status === IdempotencyStatus.PROCESSING) {
        throw new DomainException(
          'IDEMPOTENCY_IN_PROGRESS',
          'An identical request is still being processed',
          HttpStatus.CONFLICT,
        );
      }
      return {
        kind: 'completed',
        response: existing.responseJson,
        status: existing.status,
      };
    }
  }

  /**
   * Stores a successful terminal response for deterministic replay.
   *
   * @param lease Comprobante de propiedad devuelto por `reserve`; ver {@link settle}.
   * @param tx Optional execution transaction so evidence and idempotency commit together.
   */
  async complete(
    id: bigint,
    lease: Date,
    response: unknown,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.settle(id, lease, IdempotencyStatus.COMPLETED, response, tx);
  }

  /**
   * Stores a deterministic failed response for replay.
   *
   * @param lease Comprobante de propiedad devuelto por `reserve`; ver {@link settle}.
   * @param tx Optional execution transaction so evidence and idempotency commit together.
   */
  async fail(
    id: bigint,
    lease: Date,
    response: unknown,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    await this.settle(id, lease, IdempotencyStatus.FAILED, response, tx);
  }

  /**
   * Cierra la reserva **sólo si sigue siendo nuestra**.
   *
   * `where: { id, leaseExpiresAt: lease }` es lo que lo hace seguro: si la ejecución se pasó
   * del lease y otra petición reclamó la fila, su `leaseExpiresAt` ya es otro y este `update`
   * no encuentra nada. Antes se actualizaba por `id` a secas y el titular caducado
   * sobrescribía la respuesta del nuevo, de modo que un reintento posterior replicaba la
   * decisión equivocada.
   *
   * Cuando no encuentra la fila **no lanza**: hacerlo abortaría la transacción del llamante y
   * se llevaría por delante la ejecución y su evento de auditoría, es decir, borraría la
   * evidencia de una decisión que sí se tomó. Se registra para que sea observable, y la
   * situación se vuelve inalcanzable por configuración gracias a la validación cruzada de
   * `IDEMPOTENCY_LEASE_SECONDS` en el env schema.
   */
  private async settle(
    id: bigint,
    lease: Date,
    status: IdempotencyStatus,
    response: unknown,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const settled = await (tx ?? this.prisma).runtimeIdempotency.updateMany({
      where: { id, leaseExpiresAt: lease },
      data: {
        status,
        responseJson: response as Prisma.InputJsonValue,
        responseHash: this.hashes.sha256(response),
      },
    });
    if (settled.count === 0) {
      this.logger.warn(
        `La reserva de idempotencia ${id.toString()} fue reclamada por otra petición mientras ` +
          'ésta se ejecutaba (el lease venció antes de terminar); su resultado no se cachea. ' +
          'Revisa IDEMPOTENCY_LEASE_SECONDS frente a la duración real de la decisión.',
      );
      this.metrics?.recordIdempotencyLeaseLost();
    }
  }

  /**
   * Releases a reservation after a transient failure so an identical retry can re-claim
   * the key. El borrado va acotado por el comprobante de lease: si la fila ya se reclamó,
   * borrarla por `id` habría eliminado la reserva viva de OTRA petición, que después
   * fallaría al cerrarla.
   */
  async release(id: bigint, lease: Date): Promise<void> {
    await this.prisma.runtimeIdempotency.deleteMany({ where: { id, leaseExpiresAt: lease } });
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HashService } from '../../common/crypto/hash.service';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { AuditEventSearchQueryDto, ExecutionSearchQueryDto } from './audit-query.dto';

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
    private readonly config: ConfigService,
  ) {}

  async getExecution(tenantId: bigint, executionId: bigint) {
    const execution = await this.prisma.decisionExecution.findFirst({
      where: { id: executionId, tenantId },
      include: {
        deployment: { include: { environment: true, compiledArtifact: true } },
        artifactVersion: { include: { artifact: true } },
        variables: {
          include: { variableVersion: { include: { definition: true } } },
        },
        steps: { include: { node: true }, orderBy: { stepOrder: 'asc' } },
        reasons: {
          include: { reasonCode: true, sourceAction: true },
          orderBy: { priority: 'asc' },
        },
        errors: true,
        manualReview: true,
      },
    });
    if (!execution) {
      throw new DomainException('EXECUTION_NOT_FOUND', 'Decision execution not found', HttpStatus.NOT_FOUND);
    }
    return execution;
  }

  async searchExecutions(tenantId: bigint, filters: ExecutionSearchQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      filters,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = {
      tenantId,
      ...(filters.outcome ? { businessOutcome: filters.outcome } : {}),
      ...(filters.requestId ? { requestId: filters.requestId } : {}),
      ...(filters.artifactCode
        ? { artifactVersion: { artifact: { artifactCode: filters.artifactCode } } }
        : {}),
      ...(filters.from || filters.to
        ? {
            executedAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.decisionExecution.findMany({
        where,
        include: {
          artifactVersion: { include: { artifact: true } },
          deployment: { include: { environment: true } },
          reasons: { include: { reasonCode: true }, orderBy: { priority: 'asc' } },
        },
        orderBy: { executedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.decisionExecution.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async listAuditEvents(tenantId: bigint, filters: AuditEventSearchQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      filters,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = {
      tenantId,
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
      ...(filters.aggregateType ? { aggregateType: filters.aggregateType } : {}),
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.from || filters.to
        ? {
            // DecisionAuditEvent timestamps its rows with occurredAt; there is no
            // createdAt column, so filtering by from/to used to throw at query time.
            occurredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.decisionAuditEvent.findMany({ where, orderBy: { id: 'desc' }, skip, take }),
      this.prisma.decisionAuditEvent.count({ where }),
    ]);
    return pageResult(items, total, page, pageSize);
  }

  async verifyAuditChain(tenantId: bigint) {
    // Walk the chain in id-ordered batches with a cursor instead of loading every event into
    // memory at once. An audit chain grows unbounded, so `findMany` over the whole tenant
    // would exhaust memory on a large chain (and hands a caller a cheap DoS). Only the
    // running previousHash and the counters cross a batch boundary.
    const batchSize = this.config.get<number>('AUDIT_VERIFY_BATCH_SIZE') ?? 500;
    let cursorId = 0n;
    let previousHash: string | null = null;
    let eventCount = 0;
    const invalid: Array<{ id: string; reason: string }> = [];

    for (;;) {
      const events = await this.prisma.decisionAuditEvent.findMany({
        where: { tenantId, id: { gt: cursorId } },
        orderBy: { id: 'asc' },
        take: batchSize,
      });
      if (!events.length) break;

      for (const event of events) {
        if ((event.previousHash ?? null) !== previousHash) {
          invalid.push({ id: event.id.toString(), reason: 'PREVIOUS_HASH_MISMATCH' });
        }
        // Prefer the exact canonical string frozen at write time; hashing it is immune to
        // JSONB number normalization (D-9). Only events written before canonicalPayload
        // existed fall back to rebuilding the material from columns.
        const material: string | Record<string, unknown> = event.canonicalPayload ?? {
          tenantId: event.tenantId.toString(),
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          actorId: event.actorId,
          requestId: event.requestId ?? null,
          payload: event.payloadJson,
          previousHash: event.previousHash ?? null,
        };
        try {
          // Re-sign with the key that produced this event, not the active one: rotating
          // AUDIT_HASH_SECRET must not invalidate the historical chain.
          if (this.hashes.hmacWithKey(material, event.hashKeyId) !== event.eventHash) {
            invalid.push({ id: event.id.toString(), reason: 'EVENT_HASH_MISMATCH' });
          }
        } catch {
          // A retired secret that is no longer configured means the event cannot be
          // verified at all — never report that as valid.
          invalid.push({ id: event.id.toString(), reason: 'HASH_KEY_UNAVAILABLE' });
        }
        previousHash = event.eventHash;
        cursorId = event.id;
        eventCount += 1;
      }

      if (events.length < batchSize) break;
    }

    return {
      valid: invalid.length === 0,
      eventCount,
      headHash: previousHash,
      invalid,
    };
  }

  async metrics(tenantId: bigint, artifactCode?: string) {
    const where = {
      tenantId,
      ...(artifactCode
        ? { artifactVersion: { artifact: { artifactCode } } }
        : {}),
    };
    const [outcomes, statuses, latency, total] = await Promise.all([
      this.prisma.decisionExecution.groupBy({
        by: ['businessOutcome'],
        where,
        _count: { _all: true },
      }),
      this.prisma.decisionExecution.groupBy({
        by: ['decisionStatus'],
        where,
        _count: { _all: true },
      }),
      this.prisma.decisionExecution.aggregate({
        where,
        _avg: { durationMs: true },
        _max: { durationMs: true },
        _min: { durationMs: true },
      }),
      this.prisma.decisionExecution.count({ where }),
    ]);
    return {
      total,
      outcomes: outcomes.map((item) => ({ outcome: item.businessOutcome, count: item._count._all })),
      statuses: statuses.map((item) => ({ status: item.decisionStatus, count: item._count._all })),
      latencyMs: latency,
    };
  }
}

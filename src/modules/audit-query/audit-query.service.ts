import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { HashService } from '../../common/crypto/hash.service';
import { decodeCursor, keysetPage, pageResult, paginationArgs } from '../../common/http/pagination';
import {
  AuditEventKeysetQueryDto,
  AuditEventSearchQueryDto,
  ExecutionSearchQueryDto,
} from './audit-query.dto';
import {
  DECISION_AUDIT_READ_PORT,
  type AuditEventCriteria,
  type DecisionAuditReadPort,
} from './ports/decision-audit-read.port';
import { numeroDeConfig } from '../../common/config/config-coercion.util';

/**
 * Consultas de auditoría: el módulo piloto de la separación read/write.
 *
 * Ya no conoce Prisma. Habla con `DecisionAuditReadPort` y arma la forma de respuesta
 * (páginas por desplazamiento y por cursor) a partir de las filas que el puerto devuelve.
 * Qué conexión sirve cada consulta —el mismo pool que la escritura, un pool aparte con el
 * rol lector o una réplica— lo decide el router, y este archivo no cambia por ello.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(DECISION_AUDIT_READ_PORT)
    private readonly reads: DecisionAuditReadPort,
    private readonly hashes: HashService,
    private readonly config: ConfigService,
  ) {}

  private get maxPageSize(): number {
    return this.config.get<number>('MAX_PAGE_SIZE') ?? 100;
  }

  async getExecution(tenantId: bigint, executionId: bigint) {
    const execution = await this.reads.findExecutionById(tenantId, executionId);
    if (!execution) {
      throw new DomainException(
        'EXECUTION_NOT_FOUND',
        'Decision execution not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return execution;
  }

  async searchExecutions(tenantId: bigint, filters: ExecutionSearchQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(filters, this.maxPageSize);
    const { items, total } = await this.reads.searchExecutions({
      tenantId,
      outcome: filters.outcome,
      requestId: filters.requestId,
      artifactCode: filters.artifactCode,
      ...dateRange(filters),
      skip,
      take,
    });
    return pageResult(items, total, page, pageSize);
  }

  /** Filtro compartido por las dos vistas del registro de auditoría. */
  private auditEventCriteria(
    tenantId: bigint,
    filters: AuditEventSearchQueryDto | AuditEventKeysetQueryDto,
  ): AuditEventCriteria {
    return {
      tenantId,
      eventType: filters.eventType,
      aggregateType: filters.aggregateType,
      actorId: filters.actorId,
      ...dateRange(filters),
    };
  }

  async listAuditEvents(tenantId: bigint, filters: AuditEventSearchQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(filters, this.maxPageSize);
    const { items, total } = await this.reads.listAuditEvents({
      ...this.auditEventCriteria(tenantId, filters),
      skip,
      take,
    });
    return pageResult(items, total, page, pageSize);
  }

  /**
   * Vista por cursor del mismo registro. Busca por clave primaria en vez de contar y
   * descartar filas, así la latencia se mantiene plana por hondo que vaya el llamante —y
   * se ahorra el `count(*)` que la paginación por desplazamiento paga en cada página de
   * una tabla que crece sin cota.
   */
  async listAuditEventsByCursor(tenantId: bigint, filters: AuditEventKeysetQueryDto) {
    const pageSize = Math.min(Math.max(1, filters.pageSize || 25), this.maxPageSize);
    const rows = await this.reads.listAuditEventsByCursor({
      ...this.auditEventCriteria(tenantId, filters),
      ...(filters.cursor ? { beforeId: decodeCursor(filters.cursor) } : {}),
      // Una fila de más es lo que permite saber si existe página siguiente sin contar.
      take: pageSize + 1,
    });
    return keysetPage(rows, pageSize);
  }

  async verifyAuditChain(tenantId: bigint) {
    // La cadena se recorre en lotes ordenados por id con un cursor, en vez de cargar cada
    // evento en memoria. Una cadena de auditoría crece sin cota, así que leerla entera
    // agotaría la memoria en un tenant grande (y regalaría un DoS barato). Solo el
    // previousHash en curso y los contadores cruzan el límite de un lote.
    const batchSize = numeroDeConfig(this.config, 'AUDIT_VERIFY_BATCH_SIZE', 500);
    let cursorId = 0n;
    let previousHash: string | null = null;
    let eventCount = 0;
    const invalid: Array<{ id: string; reason: string }> = [];

    for (;;) {
      const events = await this.reads.readAuditChainBatch({
        tenantId,
        afterId: cursorId,
        batchSize,
      });
      if (!events.length) break;

      for (const event of events) {
        if ((event.previousHash ?? null) !== previousHash) {
          invalid.push({ id: event.id.toString(), reason: 'PREVIOUS_HASH_MISMATCH' });
        }
        // Se prefiere la cadena canónica exacta congelada al escribir; hashearla es inmune
        // a la normalización de números de JSONB (D-9). Solo los eventos escritos antes de
        // que existiera canonicalPayload reconstruyen el material desde las columnas.
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
          // Se refirma con la clave que produjo este evento, no con la activa: rotar
          // AUDIT_HASH_SECRET no puede invalidar la cadena histórica.
          if (this.hashes.hmacWithKey(material, event.hashKeyId) !== event.eventHash) {
            invalid.push({ id: event.id.toString(), reason: 'EVENT_HASH_MISMATCH' });
          }
        } catch {
          // Un secreto retirado que ya no está configurado significa que el evento no se
          // puede verificar en absoluto — eso jamás se reporta como válido.
          invalid.push({ id: event.id.toString(), reason: 'HASH_KEY_UNAVAILABLE' });
        }
        previousHash = event.eventHash;
        cursorId = event.id;
        eventCount += 1;
      }

      if (events.length < batchSize) break;
    }

    return { valid: invalid.length === 0, eventCount, headHash: previousHash, invalid };
  }

  async metrics(tenantId: bigint, artifactCode?: string) {
    return this.reads.executionMetrics(tenantId, artifactCode);
  }
}

/** Convierte el rango ISO del DTO en fechas, omitiendo lo que no venga. */
function dateRange(filters: { from?: string; to?: string }): { from?: Date; to?: Date } {
  return {
    ...(filters.from ? { from: new Date(filters.from) } : {}),
    ...(filters.to ? { to: new Date(filters.to) } : {}),
  };
}

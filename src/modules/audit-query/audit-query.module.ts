/** Publica modelos de lectura acotados de auditoría manteniendo privado el almacén append-only. */
import { Module } from '@nestjs/common';
import { AuditQueryController } from './audit-query.controller';
import { AuditQueryService } from './audit-query.service';
import { PostgresDecisionAuditReadAdapter } from './adapters/postgres-decision-audit-read.adapter';
import { DECISION_AUDIT_READ_PORT } from './ports/decision-audit-read.port';

// El puerto se liga aquí a su implementación PostgreSQL. Sustituirla por otro motor —un
// índice de búsqueda para los listados, por ejemplo— es cambiar esta línea; el servicio,
// el controlador y el contrato OpenAPI no se enteran.
@Module({
  controllers: [AuditQueryController],
  providers: [
    AuditQueryService,
    PostgresDecisionAuditReadAdapter,
    { provide: DECISION_AUDIT_READ_PORT, useExisting: PostgresDecisionAuditReadAdapter },
  ],
  exports: [AuditQueryService],
})
export class AuditQueryModule {}

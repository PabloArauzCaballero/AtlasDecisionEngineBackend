import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { consultaCrudaConTenant } from '../../../../common/prisma/tenant-scoped-raw';

@Injectable()
export class StatementReviewDocuments {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ¿Sigue estando el PDF? Se pregunta con `octet_length` y no seleccionando la
   * columna: `fileBytes` pesa hasta 10 MiB y traerlo al proceso para mirar si su
   * longitud es cero convierte abrir un caso en transferir el documento entero.
   *
   * Consulta cruda dentro de transacción porque la tabla tiene RLS FORZADA; ver
   * `consultaCrudaConTenant`.
   */
  async isAvailable(tenantId: bigint, requestId: string): Promise<boolean> {
    const rows = await consultaCrudaConTenant(this.prisma, (tx) =>
      tx.$queryRaw<Array<{ tiene: boolean }>>(Prisma.sql`
        SELECT coalesce(octet_length(file_bytes), 0) > 0 AS tiene
        FROM decision_bank_statement_run
        WHERE tenant_id = ${tenantId} AND request_id = ${requestId}
      `),
    );
    return rows[0]?.tiene ?? false;
  }
}

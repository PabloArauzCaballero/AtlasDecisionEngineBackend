import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { consultaCrudaConTenant } from '../../../../common/prisma/tenant-scoped-raw';
import { ObjectStorageService } from '../../../../common/storage/object-storage.service';

/** El PDF original de un caso, listo para servirlo a quien revisa. */
export interface StatementReviewPdf {
  readonly content: Buffer;
  readonly fileName: string;
}

@Injectable()
export class StatementReviewDocuments {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

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

  /**
   * El PDF que subió el cliente, para VERLO al revisar (2026-10-15).
   *
   * Pablo: «no me deja ver el PDF subido, para poder manualmente ponerle la entidad». No existía ningún
   * camino que lo sirviera: la cola decía «el PDF original sigue guardado» y no había forma de abrirlo.
   * Se lee primero la copia de trabajo (`file_bytes`, viva mientras el caso está abierto) y, si ya no
   * está, la copia duradera del almacén (`file_object_key`), que es la que sobrevive al cierre.
   */
  async read(tenantId: bigint, requestId: string): Promise<StatementReviewPdf> {
    const rows = await consultaCrudaConTenant(this.prisma, (tx) =>
      tx.$queryRaw<
        Array<{ file_bytes: Uint8Array | null; file_object_key: string | null; file_name: string }>
      >(Prisma.sql`
        SELECT file_bytes, file_object_key, file_name
        FROM decision_bank_statement_run
        WHERE tenant_id = ${tenantId} AND request_id = ${requestId}
      `),
    );
    const row = rows[0];
    if (!row) {
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_FOUND',
        'No existe ese extracto.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.file_bytes && row.file_bytes.length > 0) {
      return { content: Buffer.from(row.file_bytes), fileName: row.file_name };
    }
    if (row.file_object_key && this.objectStorage.isConfigured()) {
      const stored = await this.objectStorage.get(row.file_object_key);
      if (stored) return { content: stored.content, fileName: row.file_name };
    }
    throw new DomainException(
      'BANK_STATEMENT_DOCUMENT_UNAVAILABLE',
      'El PDF original ya no está guardado.',
      HttpStatus.GONE,
    );
  }
}

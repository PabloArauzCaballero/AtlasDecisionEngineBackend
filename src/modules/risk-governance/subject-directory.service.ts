import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HashService } from '../../common/crypto/hash.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Encuentra (o materializa) al titular a partir de su referencia, que nunca se guarda en claro. */
@Injectable()
export class SubjectDirectory {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: HashService,
  ) {}

  /**
   * El titular, creado si hace falta y BLOQUEADO hasta el final de la transacción.
   *
   * `INSERT … ON CONFLICT` y no `upsert`, por lo mismo que en el escritor de ejecuciones: dos
   * réplicas simultáneas del mismo titular no deben abortar una a la otra con P2002. El bloqueo
   * de la fila serializa alta y revocación del mismo titular, que es donde el orden importa.
   */
  async lockSubject(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    subjectReference: string,
  ): Promise<bigint> {
    const subjectReferenceHash = this.hashes.hmac(subjectReference);
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO "decision_subject" ("tenant_id", "subject_reference_hash", "decision_count")
      VALUES (${tenantId}, ${subjectReferenceHash}, 0)
      ON CONFLICT ("tenant_id", "subject_reference_hash") DO UPDATE
        SET "subject_reference_hash" = EXCLUDED."subject_reference_hash"
      RETURNING "id"
    `;
    const subjectId = rows[0].id;
    await tx.$queryRaw`SELECT "id" FROM "decision_subject" WHERE "id" = ${subjectId} FOR UPDATE`;
    return subjectId;
  }

  async requireSubject(tenantId: bigint, subjectReference: string): Promise<bigint> {
    const subjectReferenceHash = this.hashes.hmac(subjectReference);
    const subject = await this.prisma.decisionSubject.findFirst({
      where: { tenantId, subjectReferenceHash },
      select: { id: true },
    });
    if (!subject) {
      throw new DomainException(
        'SUBJECT_NOT_FOUND',
        'No hay ninguna decisión registrada sobre ese titular en este tenant.',
        HttpStatus.NOT_FOUND,
      );
    }
    return subject.id;
  }
}

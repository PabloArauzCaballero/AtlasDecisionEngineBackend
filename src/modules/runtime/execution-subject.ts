import { Prisma } from '@prisma/client';

/**
 * Devuelve el id del sujeto, creándolo si es su primera decisión.
 *
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` y no `prisma.upsert` por una razón que sólo
 * se ve bajo carga: dos decisiones simultáneas del mismo solicitante —un reintento del
 * integrador, una doble pulsación— compiten por la misma clave única. El `upsert` de Prisma
 * son dos sentencias, así que la perdedora recibe P2002 y ABORTA LA TRANSACCIÓN entera,
 * tirando una decisión ya calculada por un choque de contabilidad. `ON CONFLICT` lo resuelve
 * dentro de la misma sentencia y las dos decisiones sobreviven.
 *
 * El `DO UPDATE` no es decorativo: además de devolver la fila existente, adelanta
 * `last_seen_at` y suma al contador, que es justo lo que hace útil la tabla para ordenar por
 * actividad sin recorrer las ejecuciones.
 */
export async function resolveSubject(
  tx: Prisma.TransactionClient,
  tenantId: bigint,
  subjectReferenceHash: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "decision_subject" ("tenant_id", "subject_reference_hash", "decision_count")
    VALUES (${tenantId}, ${subjectReferenceHash}, 1)
    ON CONFLICT ("tenant_id", "subject_reference_hash") DO UPDATE
      SET "last_seen_at" = now(),
          "decision_count" = "decision_subject"."decision_count" + 1
    RETURNING "id"
  `;
  return rows[0].id;
}

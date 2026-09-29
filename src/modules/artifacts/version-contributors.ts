import type { Prisma } from '@prisma/client';

/** Lo mínimo de una versión para saber quién la escribió. */
export interface VersionAuthorship {
  id: bigint;
  createdBy: string;
}

/** Cualquier cliente de Prisma que pueda leer la bitácora de cambios (el servicio o una transacción). */
export type ChangeLogReader = Pick<Prisma.TransactionClient, 'decisionChangeLog'>;

/**
 * ¿Escribió esta persona la versión? Quien la CREÓ o quien guardó su grafo.
 *
 * La separación de funciones —el autor no aprueba ni despliega su propia versión— sólo miraba
 * `createdBy`. Mientras quien daba de alta el artefacto era también quien dibujaba el grafo, eso
 * bastaba. Desde que el alta es de `PLATFORM_ADMIN` y la autoría de `QA_ANALYST`/`FRAUD_ANALYST`
 * (docs/roles-y-autoria-de-artefactos.md), la versión 1 la crea un administrador y la regla la
 * escribe otra persona: con sólo `createdBy`, esa persona podría firmar el paso de QA de la
 * regla que ella misma escribió. La bitácora (`decision_change_log`) registra cada guardado del
 * grafo con su autor, y es la fuente de verdad de «quién tocó la regla».
 */
export async function isVersionContributor(
  db: ChangeLogReader,
  version: VersionAuthorship,
  principalId: string,
): Promise<boolean> {
  if (version.createdBy === principalId) return true;
  const edit = await db.decisionChangeLog.findFirst({
    where: { artifactVersionId: version.id, changedBy: principalId },
    select: { id: true },
  });
  return edit !== null;
}

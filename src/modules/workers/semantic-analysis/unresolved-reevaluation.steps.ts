import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MOTIVOS_DE_REVISION } from './core/domain/review-reason';
import { SemanticAnalysisPipeline } from './core/application/semantic-analysis.pipeline';

/**
 * Pasa el valor por el mismo análisis que usa el worker.
 *
 * Reutilizarlo —en vez de escribir aquí una comparación «parecida»— es lo que
 * garantiza que un pendiente cerrado por esta pasada se habría cerrado igual si
 * la glosa llegara hoy por la puerta normal. Un fallo del modelo no aborta la
 * pasada: se deja el pendiente como estaba y se sigue.
 */
export async function clasificar(
  pipeline: SemanticAnalysisPipeline,
  logger: Logger,
  tenantId: bigint,
  rawValue: string,
): Promise<{
  resuelto: boolean;
  categoryCode: string | null;
  confidence: number | null;
  /** El texto que el clasificador leyó DE VERDAD, ya sin los identificadores. */
  textoClasificado: string;
  candidatas: ReadonlyArray<{ categoryCode: string; confidence: number }>;
} | null> {
  try {
    const resultado = await pipeline.analyze({
      requestId: randomUUID(),
      idempotencyKey: `reevaluacion:${randomUUID()}`,
      text: rawValue,
      tenantId: tenantId.toString(),
    });
    const candidatas = resultado.matches.map((match) => ({
      categoryCode: match.categoryCode,
      confidence: match.confidence,
    }));
    const primera = candidatas[0];
    return {
      /*
       * Un MATCH que el propio pipeline degradó NO es una resolución: con la cuota del tenant
       * agotada (PROCESSING_ERROR) o el reloj vencido (TIMEOUT) decidió una regla de rescate y
       * marcó `requiresReview`. Cerrarlo «por el catálogo» lo sacaba de la bandeja humana por una
       * causa que no tiene que ver con su texto. La regla por INSTRUMENTO, en cambio, sí cierra
       * (ver `bastante`): es determinista y esa política está medida.
       */
      resuelto:
        resultado.status === 'MATCH' &&
        primera !== undefined &&
        !(
          resultado.requiresReview &&
          (resultado.reviewReason === MOTIVOS_DE_REVISION.PROCESSING_ERROR ||
            resultado.reviewReason === MOTIVOS_DE_REVISION.TIMEOUT)
        ),
      categoryCode: primera?.categoryCode ?? null,
      confidence: primera?.confidence ?? null,
      textoClasificado: resultado.normalizedText,
      candidatas,
    };
  } catch (error) {
    logger.warn(`No se pudo reevaluar «${rawValue.slice(0, 60)}»: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Cierra el pendiente dejando escrito QUIÉN lo cerró y con qué.
 *
 * `resolvedBy` dice «catálogo» y no un nombre de persona a propósito: quien
 * audite esta fila tiene que poder distinguir de un vistazo lo que decidió
 * alguien de lo que se cerró solo porque el catálogo mejoró.
 */
export async function cerrar(
  prisma: PrismaService,
  id: bigint,
  categoryCode: string,
  confidence: number | null,
): Promise<boolean> {
  /*
   * `updateMany` con `status: 'PENDING'` y no `update` por id: la pasada carga hasta 200 filas al
   * principio y tarda minutos (1,5 s por fila). Una persona pudo resolver ésta mientras tanto; el
   * `update` pisaba su decisión y su metadata de auditoría con `resolvedBy: 'catalogo'`.
   */
  const cerrado = await prisma.unresolvedClassification.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status: 'AUTO_RESOLVED',
      resolvedCategoryCode: categoryCode,
      resolvedBy: 'catalogo',
      resolvedAt: new Date(),
      resolutionType: 'USE_SUGGESTED',
      suggestedCategoryCode: categoryCode,
      confidence: confidence === null ? null : new Prisma.Decimal(confidence),
      metadata: {
        resueltoPor: 'reevaluacion',
        confianza: confidence,
      } as Prisma.InputJsonValue,
    },
  });
  return cerrado.count > 0;
}

/**
 * Pone al día un pendiente que sigue sin cerrarse: la mejor recomendación de
 * hoy y, sobre todo, el TEXTO que el clasificador lee ahora.
 *
 * Ese texto es lo que la bandeja enseña, y estaba congelado en la forma que
 * tenía el normalizador el día que se abrió el pendiente: se leían glosas con
 * `| MCC 8299 | CONTABILIZADA | TX -F` colgando, ruido que el motor ya
 * descarta y que sólo servía para hacer ilegible la lista.
 */
export async function refrescar(
  prisma: PrismaService,
  fila: { id: bigint; context: Prisma.JsonValue },
  veredicto: {
    textoClasificado: string;
    candidatas: ReadonlyArray<{ categoryCode: string; confidence: number }>;
  },
): Promise<boolean> {
  const contexto = {
    ...(typeof fila.context === 'object' && fila.context !== null && !Array.isArray(fila.context)
      ? fila.context
      : {}),
    textoClasificado: veredicto.textoClasificado,
  } as Prisma.InputJsonValue;

  const primera = veredicto.candidatas[0];
  // Sólo si sigue PENDING: refrescar una fila que una persona ya resolvió reescribiría su
  // recomendación y su contexto después del hecho.
  const refrescado = await prisma.unresolvedClassification.updateMany({
    where: { id: fila.id, status: 'PENDING' },
    data: {
      context: contexto,
      ...(primera === undefined
        ? {}
        : {
            suggestedCategoryCode: primera.categoryCode,
            confidence: new Prisma.Decimal(primera.confidence),
            alternatives: veredicto.candidatas.slice(1, 5) as unknown as Prisma.InputJsonValue,
          }),
    },
  });
  return refrescado.count > 0 && primera !== undefined;
}

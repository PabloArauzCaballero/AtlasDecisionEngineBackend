/**
 * Reposición de un documento ya emitido (§31).
 *
 * Lo que se devuelve es el documento de la PRIMERA vez, con su `documentId` y su checksum
 * originales, marcado `REPLAYED`. Volver a renderizar «porque saldría igual» no es
 * equivalente: la fecha de generación cambiaría, el pie la imprime, y el checksum dejaría de
 * coincidir con el que el consumidor ya archivó.
 *
 * El búfer sólo se recupera si el documento se guardó. Si no, se devuelve la ficha sin
 * contenido y se dice por qué: prometer bytes que no existen sería peor que no prometerlos.
 */
import { PDF_MIME_TYPE } from '../../../domain/enums/document.enums';
import type { TemplateRef } from '../../../domain/value-objects/template-ref';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import type { GeneratePdfResult } from '../../dto/generate-pdf.result';
import type { DocumentStoragePort } from '../../ports/document-storage.port';
import type { IdempotentOutcome } from '../../ports/idempotency-store.port';

export async function replayFrom(
  outcome: IdempotentOutcome,
  templateRef: TemplateRef,
  brandId: string,
  storage: DocumentStoragePort,
  command: GeneratePdfCommand,
): Promise<GeneratePdfResult> {
  const wantsContent = command.options?.returnContent !== false;
  const content =
    wantsContent && outcome.storageKey ? await storage.load(outcome.storageKey) : undefined;

  return {
    documentId: outcome.documentId,
    template: { id: templateRef.id, version: templateRef.version },
    filename: outcome.filename,
    mimeType: PDF_MIME_TYPE,
    sizeBytes: outcome.sizeBytes,
    checksum: outcome.checksum,
    createdAt: outcome.createdAt,
    status: 'REPLAYED',
    brandId,
    storage:
      outcome.storageKey && outcome.storageProvider
        ? { provider: outcome.storageProvider, key: outcome.storageKey }
        : undefined,
    trace: {
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      idempotencyKey: command.metadata?.idempotencyKey,
      // No se renderizó nada en esta invocación, y decirlo con un cero sería mentir sobre el
      // coste. `replay` es el valor honesto para el panel de latencia.
      renderer: 'replay',
      renderDurationMs: 0,
    },
    content,
  };
}

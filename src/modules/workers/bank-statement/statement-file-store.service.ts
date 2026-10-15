import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { WorkerInputSource } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { ObjectStorageService } from '../../../common/storage/object-storage.service';
import type { ValidatedStatementInput } from './bank-statement-input';

/** Dónde y cómo se conserva el PDF de un extracto: copia duradera con su huella, o ninguna en un escenario. */
@Injectable()
export class StatementFileStore {
  private readonly logger = new Logger(StatementFileStore.name);

  constructor(private readonly objectStorage: ObjectStorageService) {}

  /**
   * Copia el extracto al almacén y devuelve su clave.
   *
   * **Una subida real sin almacén se RECHAZA**, por lo mismo que en identidad: el aviso en el log
   * no lo lee nadie, la ejecución decidía y cerraba, y el extracto sobre el que se calculó una
   * capacidad de pago no existía al día siguiente para responder a una impugnación. Los ESCENARIOS
   * (`fixtureCode`) siguen pasando sin almacén: su PDF lo genera el motor y no es de nadie.
   *
   * Si el almacén SÍ está y rechaza la escritura, se propaga: «no hay almacén» y «hay almacén y no
   * me deja escribir» son dos cosas distintas, y tratarlas igual deja claves de objetos que nunca
   * existieron.
   */
  async store(
    tenantId: bigint,
    requestId: string,
    input: ValidatedStatementInput,
    source: WorkerInputSource,
  ): Promise<{ objectKey: string; sha256: string | null } | null> {
    if (!this.objectStorage.isConfigured()) {
      if (source === WorkerInputSource.UPLOAD) {
        throw new DomainException(
          'STATEMENT_FILE_STORAGE_NOT_CONFIGURED',
          'No se puede analizar un extracto sin un sitio donde conservarlo: declara ' +
            'STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID y ' +
            'STORAGE_S3_SECRET_ACCESS_KEY. Se rechaza la subida en vez de calcular una capacidad ' +
            'de pago y perder el documento que la sostiene.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.warn(
        `El escenario ${requestId} se encola sin copia persistente: no hay almacén configurado. ` +
          'Su PDF es generado, así que no hay documento de nadie que perder.',
      );
      return null;
    }

    // Siempre PDF: `validateStatementUpload` comprueba los bytes mágicos antes de llegar aquí, así
    // que el tipo no sale de lo que declare quien sube.
    const objectKey = this.objectStorage.buildStatementKey({
      tenantId,
      requestId,
      extension: 'pdf',
    });
    // El almacén ya calcula la huella al escribir. Se guarda con la clave: sin ella, la copia no
    // se puede contrastar con el PDF que subió el cliente.
    const guardado = await this.objectStorage.put(objectKey, input.bytes, 'application/pdf');
    return { objectKey, sha256: guardado?.sha256Hex ?? null };
  }

  /** Borra un objeto que quedó sin fila que lo referencie. */
  async discard(objectKey: string): Promise<void> {
    await this.objectStorage.remove(objectKey);
  }
}

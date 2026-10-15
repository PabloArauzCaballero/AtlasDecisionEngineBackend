import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { WorkerInputSource } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { ObjectStorageService } from '../../../common/storage/object-storage.service';
import type { ValidatedIdentityImage, ValidatedIdentityInput } from './identity-verification-input';

/** Lo que queda de una subida ya copiada al almacén: dónde está cada imagen y su huella. */
export interface GuardadoDeImagenes {
  readonly document: string;
  readonly documentBack: string | null;
  readonly selfie: string;
  readonly documentSha256: string | null;
  readonly documentBackSha256: string | null;
  readonly selfieSha256: string | null;
}

/** Dónde y cómo se conservan la cara y el carnet de una verificación. */
@Injectable()
export class IdentityImageStore {
  private readonly logger = new Logger(IdentityImageStore.name);

  constructor(private readonly objectStorage: ObjectStorageService) {}

  isConfigured(): boolean {
    return this.objectStorage.isConfigured();
  }

  /**
   * Copia las imágenes al almacén y devuelve sus claves.
   *
   * **Una subida real sin almacén se RECHAZA.** Antes se avisaba en el log y la ejecución seguía:
   * decidía, cerraba, borraba las columnas `Bytes` y la evidencia sobre la que se decidió no
   * existía al día siguiente. Ese aviso no lo lee nadie, y el daño sólo se descubre semanas
   * después, cuando alguien va a revisar el caso o a contestar una impugnación —y entonces ya no
   * hay nada que mirar—. Es incoherente además con el orden de escritura de arriba, que ya
   * prefiere no dar de alta antes que dar de alta sin evidencia: el fallo AL SUBIR cortaba el
   * alta, y no tener almacén no la cortaba.
   *
   * Los ESCENARIOS de prueba (`fixtureCode`) siguen pasando sin almacén: sus imágenes las genera
   * el propio motor, no son de nadie, y perderlas no cuesta nada. Esa es toda la degradación que
   * queda, y es la que permite correr el motor en local y en las pruebas sin MinIO.
   *
   * Si el almacén SÍ está y rechaza una escritura, se propaga: «no hay almacén» y «hay almacén y
   * no me deja escribir» son dos cosas distintas, y tratarlas igual fue exactamente lo que dejó al
   * VPS aceptando subidas contra credenciales que MinIO no conocía.
   */
  async store(
    tenantId: bigint,
    requestId: string,
    input: ValidatedIdentityInput,
    source: WorkerInputSource,
  ): Promise<GuardadoDeImagenes | null> {
    if (!this.objectStorage.isConfigured()) {
      if (source === WorkerInputSource.UPLOAD) {
        throw new DomainException(
          'IDENTITY_IMAGE_STORAGE_NOT_CONFIGURED',
          'No se puede verificar una identidad sin un sitio donde conservar las imágenes: ' +
            'declara STORAGE_S3_ENDPOINT, STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY_ID y ' +
            'STORAGE_S3_SECRET_ACCESS_KEY. Se rechaza la subida en vez de decidir sobre una ' +
            'persona y perder la evidencia al cerrar.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.warn(
        `El escenario ${requestId} se encola sin copia persistente: no hay almacén configurado. ` +
          'Sus imágenes son generadas, así que no hay evidencia de nadie que perder.',
      );
      return null;
    }

    const escrituras: Array<{
      campo: 'document' | 'documentBack' | 'selfie';
      clave: string;
      imagen: ValidatedIdentityImage;
    }> = [
      {
        campo: 'document',
        clave: this.buildKey(tenantId, requestId, 'document', input.document),
        imagen: input.document,
      },
      {
        campo: 'selfie',
        clave: this.buildKey(tenantId, requestId, 'selfie', input.selfie),
        imagen: input.selfie,
      },
      ...(input.documentBack
        ? [
            {
              campo: 'documentBack' as const,
              clave: this.buildKey(tenantId, requestId, 'document-back', input.documentBack),
              imagen: input.documentBack,
            },
          ]
        : []),
    ];

    // En paralelo: son dos o tres objetos pequeños contra el mismo servidor, y encadenarlos sólo
    // suma latencia a una petición que el cliente está esperando con el teléfono en la mano.
    const escritas: string[] = [];
    const huellas = new Map<string, string | null>();
    try {
      await Promise.all(
        escrituras.map(async ({ campo, clave, imagen }) => {
          const guardado = await this.objectStorage.put(clave, imagen.bytes, imagen.contentType);
          escritas.push(clave);
          // El almacén ya la calcula al escribir; tirarla obligaba a releer el objeto para saber
          // si seguía siendo el que se subió.
          huellas.set(campo, guardado?.sha256Hex ?? null);
        }),
      );
    } catch (error) {
      // Una escritura parcial deja objetos que ninguna fila va a referenciar nunca.
      await Promise.all(escritas.map((clave) => this.objectStorage.remove(clave)));
      throw error;
    }

    return {
      document: escrituras.find((e) => e.campo === 'document')!.clave,
      documentBack: escrituras.find((e) => e.campo === 'documentBack')?.clave ?? null,
      selfie: escrituras.find((e) => e.campo === 'selfie')!.clave,
      documentSha256: huellas.get('document') ?? null,
      documentBackSha256: huellas.get('documentBack') ?? null,
      selfieSha256: huellas.get('selfie') ?? null,
    };
  }

  private buildKey(
    tenantId: bigint,
    requestId: string,
    kind: 'document' | 'document-back' | 'selfie',
    imagen: ValidatedIdentityImage,
  ): string {
    // La extensión sale del tipo YA DETECTADO por bytes mágicos, no del nombre que mandó el
    // cliente: el nombre es dato de fuera y aquí decide una ruta.
    const extension =
      imagen.contentType === 'image/png'
        ? 'png'
        : imagen.contentType === 'image/webp'
          ? 'webp'
          : 'jpg';
    return this.objectStorage.buildIdentityKey({ tenantId, requestId, kind, extension });
  }

  /** Limpieza best-effort de lo que se subió para una fila que no llegó a existir. */
  async discardOrphans(objectKeys: GuardadoDeImagenes | null): Promise<void> {
    if (!objectKeys) return;
    const claves = [objectKeys.document, objectKeys.documentBack, objectKeys.selfie].filter(
      (clave): clave is string => clave !== null,
    );
    await Promise.all(claves.map((clave) => this.objectStorage.remove(clave)));
  }
}

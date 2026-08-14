/**
 * Los bytes del audio, en la propia base.
 *
 * Es el controlador de almacenamiento por omisión de este motor, y no una
 * variante exótica: los otros tres workers ya guardan su carga útil en la base
 * —el PDF del extracto, las tres imágenes de la verificación—, así que el audio
 * hereda la misma política de aislamiento por tenant, la misma copia de
 * seguridad y el mismo borrado. Un directorio en disco dentro de un contenedor
 * no tiene ninguna de las tres cosas y desaparece con el contenedor.
 *
 * El paquete traía además un adaptador S3. No se absorbe: arrastraría dos
 * paquetes del SDK de AWS a un motor que hoy no depende de ninguno. El puerto
 * sigue ahí, así que un despliegue que quiera objeto puede escribirlo sin tocar
 * el núcleo — que es exactamente para lo que el puerto existía.
 */
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import { createHash } from 'node:crypto';
import { AudioDomainError } from '../core/domain/errors';
import type {
  AudioStoragePort,
  StoreAudioInput,
  StoredAudio,
} from '../core/domain/ports/audio-storage.port';

/** Prefijo del URI que identifica a este controlador. */
const SCHEME = 'db://audio/';

export function audioAssetIdFromUri(storageUri: string): string {
  if (!storageUri.startsWith(SCHEME)) {
    throw new AudioDomainError(
      'URI de audio que no pertenece al almacenamiento de la base',
      'AUDIO_STORAGE_URI_INVALID',
    );
  }
  return storageUri.slice(SCHEME.length);
}

export class PrismaAudioStorageAdapter implements AudioStoragePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: bigint,
  ) {}

  /**
   * Escribe los bytes en la fila del asset que ya existe.
   *
   * El checksum se calcula sobre lo que se va a guardar, y se devuelve para que
   * quien lo lea después pueda comprobar que es lo mismo. Escribir sobre un
   * asset que ya tiene audio no puede pasar —`markReady` es idempotente y el
   * arrendamiento es exclusivo—, pero si pasara, el `updateMany` acotado por
   * tenant no tocaría la fila de nadie más.
   */
  async store(input: StoreAudioInput): Promise<StoredAudio> {
    const checksum = createHash('sha256').update(input.buffer).digest('hex');
    const updated = await this.prisma.audioAsset.updateMany({
      where: { tenantId: this.tenantId, id: input.assetId },
      data: {
        // `new Uint8Array(...)` y no un cast: Prisma tipa `Bytes` como
        // `Uint8Array<ArrayBuffer>` y un `Buffer` de Node declara
        // `ArrayBufferLike`. Copiar una vez, con el techo de tamaño de la
        // respuesta ya aplicado, es más honesto que esconder con un cast que
        // los dos tipos no son intercambiables.
        audioBytes: new Uint8Array(input.buffer),
        mimeType: input.mimeType,
      },
    });
    if (updated.count === 0) {
      throw new AudioDomainError(
        'No existe el audio al que guardar los bytes',
        'AUDIO_STORAGE_ASSET_MISSING',
      );
    }
    return {
      storageUri: `${SCHEME}${input.assetId}`,
      checksumSha256: checksum,
      sizeBytes: input.buffer.byteLength,
    };
  }

  async exists(storageUri: string): Promise<boolean> {
    const row = await this.prisma.audioAsset.findFirst({
      where: { tenantId: this.tenantId, id: audioAssetIdFromUri(storageUri) },
      select: { id: true, audioBytes: true },
    });
    return Boolean(row?.audioBytes?.byteLength);
  }

  async read(storageUri: string): Promise<Buffer> {
    const row = await this.prisma.audioAsset.findFirst({
      where: { tenantId: this.tenantId, id: audioAssetIdFromUri(storageUri) },
      select: { audioBytes: true },
    });
    if (!row?.audioBytes) {
      throw new AudioDomainError('El audio ya no está disponible', 'AUDIO_STORAGE_NOT_FOUND');
    }
    return Buffer.from(row.audioBytes);
  }

  /**
   * No hay URL firmada, y es deliberado.
   *
   * Una URL firmada es un enlace que reproduce el audio SIN pasar por el
   * guardián del motor durante todo su tiempo de vida; quien la comparte,
   * comparte la locución. Aquí el audio se sirve por la ruta autenticada del
   * worker (`GET …/runs/:requestId/audio`), donde el permiso se decide en cada
   * petición. Lo que se devuelve es el URI interno, que no es reproducible por
   * sí solo.
   */
  async publicUrl(storageUri: string): Promise<string> {
    audioAssetIdFromUri(storageUri);
    return storageUri;
  }

  async remove(storageUri: string): Promise<void> {
    await this.prisma.audioAsset.updateMany({
      where: { tenantId: this.tenantId, id: audioAssetIdFromUri(storageUri) },
      data: { audioBytes: null },
    });
  }
}

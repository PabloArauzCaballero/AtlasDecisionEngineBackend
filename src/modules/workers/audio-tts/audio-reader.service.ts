import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { AudioRunService } from './audio-run.service';
import { AudioTtsRuntimeFactory } from './audio-tts.runtime';

/** Los bytes del audio de una locución terminada, siempre por el URI que guardó el asset. */
@Injectable()
export class AudioReaderService {
  constructor(
    private readonly runs: AudioRunService,
    private readonly runtime: AudioTtsRuntimeFactory,
  ) {}

  /**
   * Los bytes del audio de una locución terminada.
   *
   * Se leen del almacenamiento por el URI que guardó el asset, y no se aceptan
   * URIs de fuera: el que se usa sale de la fila, nunca de la petición. Es lo
   * que impide convertir esta ruta en un lector de archivos del servidor.
   */
  async readAudio(
    tenantId: bigint,
    requestId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const run = await this.runs.getRun(tenantId, requestId);
    if (!run.assetId) {
      throw new DomainException(
        'AUDIO_RUN_WITHOUT_AUDIO',
        'Esta locución todavía no tiene audio.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }
    const { repository, storage } = this.runtime.forTenant(tenantId);
    const asset = await repository.findById(run.assetId);
    if (!asset?.storageUri) {
      throw new DomainException(
        'AUDIO_ASSET_NOT_READY',
        'El audio de esta locución ya no está disponible.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      bytes: await storage.read(asset.storageUri),
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileName: `locucion-${requestId}.${extensionOf(asset.mimeType)}`,
    };
  }
}

function extensionOf(mimeType: string | undefined): string {
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/opus') return 'opus';
  return 'bin';
}

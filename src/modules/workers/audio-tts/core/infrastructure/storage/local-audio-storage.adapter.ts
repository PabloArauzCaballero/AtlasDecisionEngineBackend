import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AudioTtsConfig } from '../../config/audio-tts.env';
import { AUDIO_TTS_CONFIG } from '../../domain/audio.tokens';
import { AudioDomainError } from '../../domain/errors';
import type {
  AudioStoragePort,
  StoreAudioInput,
  StoredAudio,
} from '../../domain/ports/audio-storage.port';
import { extensionFor } from './audio-format';

@Injectable()
export class LocalAudioStorageAdapter implements AudioStoragePort {
  private readonly baseDir: string;

  constructor(@Inject(AUDIO_TTS_CONFIG) config: AudioTtsConfig) {
    this.baseDir = resolve(config.AUDIO_LOCAL_STORAGE_PATH);
  }

  /**
   * Escritura atómica: fichero temporal, fsync implícito del rename y checksum
   * calculado sobre el contenido que queda realmente en disco.
   */
  async store(input: StoreAudioInput): Promise<StoredAudio> {
    const path = this.pathFor(input.assetId, input.outputFormat);
    await mkdir(dirname(path), { recursive: true });

    const existing = await this.readIfPresent(path);
    if (existing) {
      return this.describe(path, existing);
    }
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, input.buffer);
    await rename(temporary, path);
    const written = await readFile(path);
    return this.describe(path, written);
  }

  async exists(storageUri: string): Promise<boolean> {
    try {
      await stat(this.pathOf(storageUri));
      return true;
    } catch {
      return false;
    }
  }

  /** `async` para que un URI inválido rechace la promesa en vez de lanzar de forma síncrona. */
  async read(storageUri: string): Promise<Buffer> {
    return readFile(this.pathOf(storageUri));
  }

  /** El storage local no firma URLs: devuelve el propio URI de fichero. */
  async publicUrl(storageUri: string): Promise<string> {
    this.pathOf(storageUri);
    return storageUri;
  }

  async remove(storageUri: string): Promise<void> {
    await rm(this.pathOf(storageUri), { force: true });
  }

  private describe(path: string, content: Buffer): StoredAudio {
    return {
      storageUri: pathToFileURL(path).href,
      checksumSha256: createHash('sha256').update(content).digest('hex'),
      sizeBytes: content.length,
    };
  }

  private async readIfPresent(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  private pathFor(assetId: string, outputFormat: string): string {
    const shard = assetId.slice(0, 2);
    return join(this.baseDir, shard, `${assetId}.${extensionFor(outputFormat)}`);
  }

  /** Confina toda lectura al directorio base: el URI proviene de la base de datos. */
  private pathOf(uri: string): string {
    let path: string;
    try {
      path = resolve(fileURLToPath(uri));
    } catch {
      throw new AudioDomainError('URI de audio local inválido', 'AUDIO_STORAGE_URI_INVALID');
    }
    const inside = relative(this.baseDir, path);
    if (inside.startsWith('..') || inside.startsWith(sep) || inside === '') {
      throw new AudioDomainError(
        'URI de audio local fuera del directorio permitido',
        'AUDIO_STORAGE_PATH_ESCAPE',
      );
    }
    return path;
  }
}

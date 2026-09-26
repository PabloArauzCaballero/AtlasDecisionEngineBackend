export interface StoreAudioInput {
  assetId: string;
  buffer: Buffer;
  mimeType: string;
  outputFormat: string;
}

export interface StoredAudio {
  storageUri: string;
  /** Checksum del contenido efectivamente almacenado, no del buffer entrante. */
  checksumSha256: string;
  sizeBytes: number;
}

export interface AudioStoragePort {
  store(input: StoreAudioInput): Promise<StoredAudio>;
  exists(storageUri: string): Promise<boolean>;
  read(storageUri: string): Promise<Buffer>;
  /** URL consumible por un cliente HTTP. Firmada y con expiración cuando el backend lo permite. */
  publicUrl(storageUri: string, ttlSeconds: number): Promise<string>;
  remove(storageUri: string): Promise<void>;
}

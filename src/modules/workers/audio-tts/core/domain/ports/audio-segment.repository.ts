/**
 * Caché de segmentos de locución.
 *
 * Guarda el audio de cada TRAMO —fijo o variable— por su huella de identidad,
 * para que el tramo fijo de una plantilla se pague una vez y no una vez por
 * frase. Los bytes viven en la fila: un segmento pesa poco y así la caché
 * funciona igual con cualquier controlador de almacenamiento de assets.
 *
 * No hay arrendamiento: si dos réplicas sintetizan el mismo segmento a la vez,
 * el precio es pagarlo dos veces UNA vez —el índice único hace que la segunda
 * escritura no cree fila— y un candado costaría más de lo que protege.
 */

export interface AudioSegmentRecord {
  id: string;
  segmentKey: string;
  audio: Buffer;
  mimeType: string;
  usageUnits: number;
}

export interface NewAudioSegment {
  id: string;
  segmentKey: string;
  /** El texto del tramo, CIFRADO: un tramo variable lleva el nombre de una persona. */
  textEncrypted: string;
  audio: Buffer;
  mimeType: string;
  checksumSha256: string;
  usageUnits: number;
}

export interface AudioSegmentRepositoryPort {
  findByKey(segmentKey: string): Promise<AudioSegmentRecord | null>;
  /** Idempotente: un segmento repetido no crea fila nueva ni falla. */
  saveIfMissing(segment: NewAudioSegment): Promise<void>;
}

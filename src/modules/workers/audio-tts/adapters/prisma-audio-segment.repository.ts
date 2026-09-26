/**
 * Caché de segmentos sobre Prisma, acotada a UN tenant.
 *
 * La misma decisión de aislamiento que el repositorio de assets: el puerto no
 * lleva `tenantId` en ninguna firma, así que vive en la instancia y cada
 * `WHERE` lo lleva puesto. La política de RLS es la segunda línea.
 */
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  AudioSegmentRecord,
  AudioSegmentRepositoryPort,
  NewAudioSegment,
} from '../core/domain/ports/audio-segment.repository';

export class PrismaAudioSegmentRepository implements AudioSegmentRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: bigint,
  ) {}

  async findByKey(segmentKey: string): Promise<AudioSegmentRecord | null> {
    const row = await this.prisma.audioSegment.findFirst({
      where: { tenantId: this.tenantId, segmentKey },
    });
    if (!row) return null;
    return {
      id: row.id,
      segmentKey: row.segmentKey.trim(),
      audio: Buffer.from(row.audioBytes),
      mimeType: row.mimeType,
      usageUnits: row.usageUnits,
    };
  }

  /**
   * Idempotente por el índice único `(tenant_id, segment_key)`: si dos réplicas
   * sintetizan el mismo tramo a la vez, la segunda escritura no crea fila y no
   * falla. El precio de esa carrera es un tramo pagado dos veces UNA vez, y un
   * candado costaría más de lo que protege.
   */
  async saveIfMissing(segment: NewAudioSegment): Promise<void> {
    try {
      await this.prisma.audioSegment.create({
        data: {
          id: segment.id,
          tenantId: this.tenantId,
          segmentKey: segment.segmentKey,
          textEncrypted: segment.textEncrypted,
          audioBytes: new Uint8Array(segment.audio),
          mimeType: segment.mimeType,
          checksumSha256: segment.checksumSha256,
          bytes: BigInt(segment.audio.length),
          usageUnits: segment.usageUnits,
        },
      });
    } catch (error) {
      const duplicado =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (!duplicado) throw error;
    }
  }
}

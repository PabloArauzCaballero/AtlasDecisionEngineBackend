import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpsertTutorialProgressDto } from './tutorial.dto';

@Injectable()
export class TutorialService {
  constructor(private readonly prisma: PrismaService) {}

  async listProgress(tenantId: bigint, userId: string) {
    const rows = await this.prisma.userTutorialProgress.findMany({
      where: { tenantId, userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.present(row));
  }

  async upsertProgress(
    tenantId: bigint,
    userId: string,
    tutorialId: string,
    dto: UpsertTutorialProgressDto,
  ) {
    const completedAt = dto.status === 'COMPLETED' ? new Date() : null;
    const row = await this.prisma.userTutorialProgress.upsert({
      where: { tenantId_userId_tutorialId: { tenantId, userId, tutorialId } },
      create: {
        tenantId,
        userId,
        tutorialId,
        status: dto.status,
        lastStep: dto.lastStep ?? 0,
        version: dto.version ?? 1,
        autoShow: dto.autoShow ?? true,
        completedAt,
      },
      update: {
        status: dto.status,
        completedAt,
        ...(dto.lastStep !== undefined ? { lastStep: dto.lastStep } : {}),
        ...(dto.version !== undefined ? { version: dto.version } : {}),
        ...(dto.autoShow !== undefined ? { autoShow: dto.autoShow } : {}),
      },
    });
    return this.present(row);
  }

  private present(row: {
    tutorialId: string;
    status: string;
    lastStep: number;
    version: number;
    autoShow: boolean;
    completedAt: Date | null;
    updatedAt: Date;
  }) {
    return {
      tutorialId: row.tutorialId,
      status: row.status,
      lastStep: row.lastStep,
      version: row.version,
      autoShow: row.autoShow,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
    };
  }
}

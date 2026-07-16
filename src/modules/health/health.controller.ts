import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { CacheService } from '../../common/cache/cache.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public, SkipRateLimit } from '../../common/security/security.decorators';

@ApiTags('Health')
@Controller()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  @Get(['health', 'health/live'])
  @Public()
  @SkipRateLimit()
  live() {
    return {
      status: 'ok',
      service: 'atlas-decision-engine-backend',
      version: this.config.get<string>('BUILD_VERSION') ?? 'unknown',
      commit: this.config.get<string>('COMMIT_SHA') ?? 'unknown',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      timestamp: new Date().toISOString(),
    };
  }

  @Get(['ready', 'health/ready'])
  @Public()
  @SkipRateLimit()
  async ready() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
      checks.cache = await this.cache.ping();
      return {
        status: 'ready',
        checks,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new DomainException(
        'SERVICE_NOT_READY',
        'One or more required dependencies are unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
        {
          checks,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}

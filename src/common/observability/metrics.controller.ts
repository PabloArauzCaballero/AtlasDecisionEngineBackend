import { Controller, Get, Headers, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { HashService } from '../crypto/hash.service';
import { DomainException } from '../errors/domain-exception';
import { Public } from '../security/security.decorators';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller()
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  @Public()
  getMetrics(@Headers('x-metrics-token') token: string | undefined, @Res() response: Response): void {
    if (!(this.config.get<boolean>('METRICS_ENABLED') ?? true)) {
      throw new DomainException('METRICS_DISABLED', 'Metrics endpoint is disabled', HttpStatus.NOT_FOUND);
    }
    const expected = this.config.get<string>('METRICS_TOKEN') ?? '';
    if (expected && (!token || !this.hashes.equals(this.hashes.sha256(token), this.hashes.sha256(expected)))) {
      throw new DomainException('UNAUTHORIZED', 'Invalid metrics token', HttpStatus.UNAUTHORIZED);
    }
    response.type('text/plain; version=0.0.4; charset=utf-8').send(this.metrics.renderPrometheus());
  }
}

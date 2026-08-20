/** Protected Prometheus scrape boundary with a token independent from application auth. */
import { Controller, Get, Headers, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { HashService } from '../crypto/hash.service';
import { DomainException } from '../errors/domain-exception';
import { Public } from '../security/security.decorators';
import { extractMetricsToken, isAuthorizedMetricsRequest } from './metrics-token';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@ApiTags('Observability')
@Controller()
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    private readonly hashes: HashService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Expose Prometheus metrics to an authorized scraper' })
  @Public()
  async getMetrics(
    @Headers('x-metrics-token') token: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (!(this.config.get<boolean>('METRICS_ENABLED') ?? true)) {
      throw new DomainException(
        'METRICS_DISABLED',
        'Metrics endpoint is disabled',
        HttpStatus.NOT_FOUND,
      );
    }
    const expected = this.config.get<string>('METRICS_TOKEN') ?? '';
    const presented = extractMetricsToken({
      'x-metrics-token': token,
      authorization,
    });
    if (
      !isAuthorizedMetricsRequest(
        presented,
        expected,
        (a, b) => this.hashes.equals(a, b),
        (value) => this.hashes.sha256(value),
      )
    ) {
      throw new DomainException('UNAUTHORIZED', 'Invalid metrics token', HttpStatus.UNAUTHORIZED);
    }
    response
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(await this.metrics.renderPrometheus());
  }
}

import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audience, CurrentPrincipal, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ExecuteDecisionDto } from './runtime.dto';
import { RuntimeService } from './runtime.service';

@ApiTags('Decision Runtime')
@Controller('v1/decisions')
@Audience('runtime')
export class RuntimeController {
  constructor(private readonly runtime: RuntimeService) {}

  @Post(':artifactCode')
  async execute(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('artifactCode') artifactCode: string,
    @Body() dto: ExecuteDecisionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.runtime.execute(tenantId, artifactCode, dto, principal);
    response.status(result.httpStatus);
    return result.body;
  }
}

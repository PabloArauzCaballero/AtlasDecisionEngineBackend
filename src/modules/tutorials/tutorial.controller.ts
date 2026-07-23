import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PLATFORM_ROLES } from '../../common/security/platform-roles';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { UpsertTutorialProgressDto } from './tutorial.dto';
import { TutorialService } from './tutorial.service';

@ApiTags('Tutorials')
@Controller('v1')
export class TutorialController {
  constructor(private readonly tutorials: TutorialService) {}

  @Get('tutorial-progress')
  @Roles(...PLATFORM_ROLES)
  list(@TenantId() tenantId: bigint, @CurrentPrincipal() principal: AuthenticatedPrincipal) {
    return this.tutorials.listProgress(tenantId, principal.id);
  }

  @Put('tutorial-progress/:tutorialId')
  @Roles(...PLATFORM_ROLES)
  upsert(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('tutorialId') tutorialId: string,
    @Body() dto: UpsertTutorialProgressDto,
  ) {
    return this.tutorials.upsertProgress(tenantId, principal.id, tutorialId, dto);
  }
}
